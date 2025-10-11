import { Router } from 'express';
import { z } from 'zod';
import { Op } from 'sequelize';
import {
  Invoice,
  InvoiceLine,
  InvoicePayment,
  Product,
  StockLevel,
  StockMove,
  Bin,
  User,
  UserActivity,
  Organization,
  sequelize
} from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { recordActivity, presentActivity } from '../services/activityLog.js';
import { invalidateStockOverviewCache } from '../services/cache.js';

const InvoiceStatusEnum = z.enum(['draft', 'issued', 'payment_processing', 'paid', 'void']);

const InvoiceLineSchema = z.object({
  product_id: z.number().int().positive(),
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  gst_rate: z.number().nonnegative(),
  bin_id: z.number().int().positive().optional()
});

const BaseInvoiceSchema = z.object({
  invoice_number: z.string().min(1).optional(),
  issue_date: z.coerce.date().optional(),
  due_date: z.coerce.date().optional(),
  reference: z.string().max(128).optional(),
  customer_name: z.string().min(1),
  customer_email: z.string().email().optional(),
  customer_address: z.string().optional(),
  customer_abn: z.string().max(32).optional(),
  supplier_name: z.string().max(191).optional(),
  supplier_abn: z.string().max(32).optional(),
  supplier_address: z.string().optional(),
  payment_terms: z.string().max(191).optional(),
  currency: z.string().max(8).optional(),
  notes: z.string().optional(),
  status: InvoiceStatusEnum.default('draft'),
  lines: z.array(InvoiceLineSchema).min(1)
});

const StatusSchema = z.object({
  status: InvoiceStatusEnum,
  payment: z.object({
    amount: z.number().nonnegative(),
    method: z.string().max(64).optional(),
    reference: z.string().max(128).optional(),
    notes: z.string().optional(),
    paid_at: z.coerce.date().optional()
  }).optional()
});

function normaliseRate(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric < 0) return 0;
  if (numeric > 1 && numeric <= 100) {
    return numeric / 100;
  }
  return numeric;
}

function toAmount(value) {
  return Number.parseFloat(Number(value).toFixed(2));
}

async function resolveInvoicePrefix(organizationId, transaction) {
  const organization = await Organization.findByPk(organizationId, { transaction, skipOrganizationScope: true });
  const prefix = organization?.invoice_prefix;
  if (typeof prefix === 'string') {
    return prefix.trim();
  }
  return 'INV-';
}

async function generateInvoiceNumber(organizationId, transaction) {
  const prefix = await resolveInvoicePrefix(organizationId, transaction);
  const where = { organizationId };
  if (prefix) {
    where.invoice_number = { [Op.like]: `${prefix}%` };
  }
  const latest = await Invoice.findOne({
    where,
    order: [['createdAt', 'DESC']],
    transaction
  });
  const padLength = latest?.invoice_number?.match(/\d+/)?.[0]?.length ?? 4;
  if (!latest || !latest.invoice_number || (prefix && !latest.invoice_number.startsWith(prefix))) {
    const numeric = String(1).padStart(Math.max(padLength, 4), '0');
    return `${prefix || ''}${numeric}`;
  }
  const match = latest.invoice_number.match(/^(.*?)(\d{1,})$/);
  if (!match) {
    return `${latest.invoice_number}-1`;
  }
  const [, detectedPrefix, numeric] = match;
  const effectivePrefix = prefix ?? detectedPrefix;
  const next = String(Number.parseInt(numeric, 10) + 1).padStart(numeric.length, '0');
  return `${effectivePrefix}${next}`;
}

function presentLine(line) {
  return {
    id: line.id,
    product_id: line.productId,
    product: line.product ? {
      id: line.product.id,
      name: line.product.name,
      sku: line.product.sku,
      uom: line.product.uom
    } : null,
    bin_id: line.binId,
    bin: line.bin ? {
      id: line.bin.id,
      code: line.bin.code
    } : null,
    description: line.description,
    quantity: line.quantity,
    unit_price: Number(line.unit_price),
    gst_rate: Number(line.gst_rate),
    line_subtotal: Number(line.line_subtotal),
    line_gst: Number(line.line_gst),
    line_total: Number(line.line_total)
  };
}

function presentPayment(payment) {
  return {
    id: payment.id,
    amount: Number(payment.amount),
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    paid_at: payment.paid_at,
    recorded_by: payment.recordedBy ? {
      id: payment.recordedBy.id,
      name: payment.recordedBy.full_name
    } : null
  };
}

function presentInvoice(invoice) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    reference: invoice.reference,
    customer_name: invoice.customer_name,
    customer_email: invoice.customer_email,
    customer_address: invoice.customer_address,
    customer_abn: invoice.customer_abn,
    supplier_name: invoice.supplier_name,
    supplier_abn: invoice.supplier_abn,
    supplier_address: invoice.supplier_address,
    payment_terms: invoice.payment_terms,
    currency: invoice.currency,
    notes: invoice.notes,
    subtotal: Number(invoice.subtotal),
    gst_total: Number(invoice.gst_total),
    total: Number(invoice.total),
    balance_due: Number(invoice.balance_due),
    created_at: invoice.createdAt,
    updated_at: invoice.updatedAt,
    lines: invoice.lines ? invoice.lines.map(presentLine) : [],
    payments: invoice.payments ? invoice.payments.map(presentPayment) : []
  };
}

async function ensureProductExists(productId, transaction) {
  const product = await Product.findByPk(productId, { transaction });
  if (!product) {
    throw new HttpError(404, `Product ${productId} not found`);
  }
  return product;
}

async function ensureBinForProduct(productId, binId, transaction) {
  if (!binId) return null;
  const bin = await Bin.findByPk(binId, { transaction });
  if (!bin) {
    throw new HttpError(404, 'Bin not found');
  }
  const level = await StockLevel.findOne({ where: { productId, binId }, transaction });
  if (!level) {
    throw new HttpError(400, 'Selected bin is not linked to this product');
  }
  return bin;
}

async function calculateTotals(lines, transaction) {
  const totals = { subtotal: 0, gst: 0, total: 0 };
  const computedLines = [];
  for (const line of lines) {
    const product = await ensureProductExists(line.product_id, transaction);
    await ensureBinForProduct(product.id, line.bin_id, transaction);
    const gstRate = normaliseRate(line.gst_rate ?? 0);
    const lineSubtotal = toAmount(line.quantity * Number(line.unit_price));
    const lineGst = toAmount(lineSubtotal * gstRate);
    const lineTotal = toAmount(lineSubtotal + lineGst);
    totals.subtotal += lineSubtotal;
    totals.gst += lineGst;
    totals.total += lineTotal;
    computedLines.push({
      product,
      data: {
        productId: product.id,
        description: line.description,
        quantity: line.quantity,
        unit_price: toAmount(line.unit_price),
        gst_rate: gstRate,
        line_subtotal: lineSubtotal,
        line_gst: lineGst,
        line_total: lineTotal,
        binId: line.bin_id ?? null
      }
    });
  }
  totals.subtotal = toAmount(totals.subtotal);
  totals.gst = toAmount(totals.gst);
  totals.total = toAmount(totals.total);
  return { totals, computedLines };
}

async function fulfilInvoiceStock(invoice, transaction, userId, io) {
  const lines = await InvoiceLine.findAll({
    where: { invoiceId: invoice.id },
    include: [Product],
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  for (const line of lines) {
    let remaining = line.quantity;
    const levels = await StockLevel.findAll({
      where: {
        productId: line.productId,
        ...(line.binId ? { binId: line.binId } : {})
      },
      order: [['on_hand', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!levels.length) {
      throw new HttpError(400, `No stock levels configured for ${line.description}`);
    }
    const levelsToUse = line.binId ? levels : await StockLevel.findAll({
      where: { productId: line.productId },
      order: [['on_hand', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    remaining = line.quantity;
    for (const level of levelsToUse) {
      const available = Math.max(0, level.on_hand - level.reserved);
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      if (take > 0) {
        level.on_hand -= take;
        await level.save({ transaction });
        await StockMove.create({
          productId: line.productId,
          qty: take,
          from_bin_id: level.binId,
          to_bin_id: null,
          reason: 'invoice_sale',
          invoiceId: invoice.id,
          performed_by: userId ?? null
        }, { transaction });
        remaining -= take;
        if (remaining === 0) break;
      }
    }
    if (remaining > 0) {
      throw new HttpError(400, `Insufficient stock to fulfil ${line.description}`);
    }
  }
  io.emit('stock:update', { hint: 'invoice', invoice_id: invoice.id, organization_id: invoice.organizationId });
  await invalidateStockOverviewCache(invoice.organizationId);
}

export default function createInvoiceRoutes(io) {
  const router = Router();

  router.get('/', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const status = req.query.status;
    const where = {};
    if (status) {
      where.status = { [Op.eq]: status };
    }
    const invoices = await Invoice.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [
        { model: InvoiceLine, as: 'lines', include: [Product, { model: Bin, as: 'bin' }] },
        { model: InvoicePayment, as: 'payments', include: [{ model: User, as: 'recordedBy', attributes: ['id', 'full_name', 'email'] }] }
      ]
    });
    res.json(invoices.map(presentInvoice));
  }));

  router.post('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
    const parsed = BaseInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid invoice payload', parsed.error.flatten());
    }
    const data = parsed.data;
    await sequelize.transaction(async (transaction) => {
      const organization = await Organization.findByPk(req.user.organization_id, { transaction, skipOrganizationScope: true });
      const orgDefaults = {
        supplier_name: organization?.legal_name ?? organization?.name ?? null,
        supplier_abn: organization?.abn ?? null,
        supplier_address: organization?.address ?? null,
        payment_terms: organization?.default_payment_terms ?? null,
        currency: organization?.currency ?? 'AUD',
        notes: organization?.invoice_notes ?? null
      };
      const { totals, computedLines } = await calculateTotals(data.lines, transaction);
      const invoiceNumber = data.invoice_number || await generateInvoiceNumber(req.user.organization_id, transaction);
      const invoice = await Invoice.create({
        invoice_number: invoiceNumber,
        status: data.status,
        issue_date: data.issue_date ?? new Date(),
        due_date: data.due_date ?? null,
        reference: data.reference ?? null,
        customer_name: data.customer_name,
        customer_email: data.customer_email ?? null,
        customer_address: data.customer_address ?? null,
        customer_abn: data.customer_abn ?? null,
        supplier_name: data.supplier_name ?? orgDefaults.supplier_name,
        supplier_abn: data.supplier_abn ?? orgDefaults.supplier_abn,
        supplier_address: data.supplier_address ?? orgDefaults.supplier_address,
        payment_terms: data.payment_terms ?? orgDefaults.payment_terms,
        currency: data.currency ?? orgDefaults.currency,
        notes: data.notes ?? orgDefaults.notes,
        subtotal: totals.subtotal,
        gst_total: totals.gst,
        total: totals.total,
        balance_due: totals.total,
        created_by: req.user.id,
        updated_by: req.user.id
      }, { transaction });
      for (const line of computedLines) {
        await InvoiceLine.create({
          ...line.data,
          invoiceId: invoice.id,
          organizationId: req.user.organization_id
        }, { transaction });
      }
      await recordActivity({
        userId: req.user.id,
        organizationId: req.user.organization_id,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: invoice.id,
        description: `Created invoice ${invoice.invoice_number} for ${invoice.customer_name}`,
        metadata: {
          total: totals.total,
          status: invoice.status
        }
      }, { transaction });
      const created = await Invoice.findByPk(invoice.id, {
        include: [
          { model: InvoiceLine, as: 'lines', include: [Product, { model: Bin, as: 'bin' }] },
          { model: InvoicePayment, as: 'payments', include: [{ model: User, as: 'recordedBy', attributes: ['id', 'full_name', 'email'] }] }
        ],
        transaction
      });
      res.status(201).json(presentInvoice(created));
    });
  }));

  router.get('/:id', requireAuth(['admin', 'user']), asyncHandler(async (req, res) => {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [
        { model: InvoiceLine, as: 'lines', include: [Product, { model: Bin, as: 'bin' }] },
        { model: InvoicePayment, as: 'payments', include: [{ model: User, as: 'recordedBy', attributes: ['id', 'full_name', 'email'] }] }
      ]
    });
    if (!invoice) {
      throw new HttpError(404, 'Invoice not found');
    }
    res.json(presentInvoice(invoice));
  }));

  router.put('/:id', requireAuth(['admin']), asyncHandler(async (req, res) => {
    const parsed = BaseInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid invoice payload', parsed.error.flatten());
    }
    const data = parsed.data;
    await sequelize.transaction(async (transaction) => {
      const invoice = await Invoice.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!invoice) {
        throw new HttpError(404, 'Invoice not found');
      }
      const organization = await Organization.findByPk(req.user.organization_id, { transaction, skipOrganizationScope: true });
      const orgDefaults = {
        supplier_name: organization?.legal_name ?? organization?.name ?? null,
        supplier_abn: organization?.abn ?? null,
        supplier_address: organization?.address ?? null,
        payment_terms: organization?.default_payment_terms ?? null,
        currency: organization?.currency ?? 'AUD',
        notes: organization?.invoice_notes ?? null
      };
      const previousStatus = invoice.status;
      const { totals, computedLines } = await calculateTotals(data.lines, transaction);
      await InvoiceLine.destroy({ where: { invoiceId: invoice.id }, transaction });
      for (const line of computedLines) {
        await InvoiceLine.create({
          ...line.data,
          invoiceId: invoice.id,
          organizationId: req.user.organization_id
        }, { transaction });
      }
      const existingPayments = await InvoicePayment.findAll({ where: { invoiceId: invoice.id }, transaction });
      const paidTotal = existingPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);

      Object.assign(invoice, {
        status: data.status,
        issue_date: data.issue_date ?? invoice.issue_date,
        due_date: data.due_date ?? null,
        reference: data.reference ?? null,
        customer_name: data.customer_name,
        customer_email: data.customer_email ?? null,
        customer_address: data.customer_address ?? null,
        customer_abn: data.customer_abn ?? null,
        supplier_name: data.supplier_name ?? invoice.supplier_name ?? orgDefaults.supplier_name,
        supplier_abn: data.supplier_abn ?? invoice.supplier_abn ?? orgDefaults.supplier_abn,
        supplier_address: data.supplier_address ?? invoice.supplier_address ?? orgDefaults.supplier_address,
        payment_terms: data.payment_terms ?? invoice.payment_terms ?? orgDefaults.payment_terms,
        currency: data.currency ?? invoice.currency ?? orgDefaults.currency,
        notes: data.notes ?? invoice.notes ?? orgDefaults.notes,
        subtotal: totals.subtotal,
        gst_total: totals.gst,
        total: totals.total,
        balance_due: Math.max(0, toAmount(totals.total - paidTotal)),
        updated_by: req.user.id
      });
      await invoice.save({ transaction });
      if (previousStatus !== data.status) {
        await recordActivity({
          userId: req.user.id,
          organizationId: req.user.organization_id,
          action: 'invoice.status.updated',
          entityType: 'invoice',
          entityId: invoice.id,
          description: `Updated invoice ${invoice.invoice_number} status to ${data.status}`,
          metadata: { from: previousStatus, to: data.status }
        }, { transaction });
      } else {
        await recordActivity({
          userId: req.user.id,
          organizationId: req.user.organization_id,
          action: 'invoice.updated',
          entityType: 'invoice',
          entityId: invoice.id,
          description: `Updated invoice ${invoice.invoice_number}`
        }, { transaction });
      }
      const refreshed = await Invoice.findByPk(invoice.id, {
        include: [
          { model: InvoiceLine, as: 'lines', include: [Product, { model: Bin, as: 'bin' }] },
          { model: InvoicePayment, as: 'payments', include: [{ model: User, as: 'recordedBy', attributes: ['id', 'full_name', 'email'] }] }
        ],
        transaction
      });
      res.json(presentInvoice(refreshed));
    });
  }));

  router.patch('/:id/status', requireAuth(['admin']), asyncHandler(async (req, res) => {
    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid status payload', parsed.error.flatten());
    }
    await sequelize.transaction(async (transaction) => {
      const invoice = await Invoice.findByPk(req.params.id, {
        include: [{ model: InvoicePayment, as: 'payments' }, { model: InvoiceLine, as: 'lines' }],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!invoice) {
        throw new HttpError(404, 'Invoice not found');
      }
      const previousStatus = invoice.status;
      const { status, payment } = parsed.data;
      invoice.status = status;
      invoice.updated_by = req.user.id;
      if (payment) {
        const paymentRecord = await InvoicePayment.create({
          invoiceId: invoice.id,
          organizationId: req.user.organization_id,
          recorded_by: req.user.id,
          amount: toAmount(payment.amount),
          method: payment.method ?? null,
          reference: payment.reference ?? null,
          notes: payment.notes ?? null,
          paid_at: payment.paid_at ?? new Date()
        }, { transaction });
        invoice.payments = Array.isArray(invoice.payments) ? invoice.payments : [];
        invoice.payments.push(paymentRecord);
        invoice.balance_due = toAmount(Number(invoice.balance_due) - Number(paymentRecord.amount));
      }
      if (status === 'paid' && Number(invoice.balance_due) > 0 && !payment) {
        throw new HttpError(400, 'Payment details are required before marking an invoice as paid');
      }
      await invoice.save({ transaction });
      if (previousStatus !== status) {
        await recordActivity({
          userId: req.user.id,
          organizationId: req.user.organization_id,
          action: 'invoice.status.updated',
          entityType: 'invoice',
          entityId: invoice.id,
          description: `Invoice ${invoice.invoice_number} moved from ${previousStatus} to ${status}`,
          metadata: { from: previousStatus, to: status }
        }, { transaction });
      }
      if (status === 'paid' && previousStatus !== 'paid') {
        await fulfilInvoiceStock(invoice, transaction, req.user.id, io);
        invoice.balance_due = Math.max(0, toAmount(Number(invoice.total) - invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0)));
        await invoice.save({ transaction });
      }
      const refreshed = await Invoice.findByPk(invoice.id, {
        include: [
          { model: InvoiceLine, as: 'lines', include: [Product, { model: Bin, as: 'bin' }] },
          { model: InvoicePayment, as: 'payments', include: [{ model: User, as: 'recordedBy', attributes: ['id', 'full_name', 'email'] }] }
        ],
        transaction
      });
      res.json(presentInvoice(refreshed));
    });
  }));

  router.get('/:id/activity', requireAuth(['admin']), asyncHandler(async (req, res) => {
    const activities = await UserActivity.findAll({
      where: { entity_type: 'invoice', entity_id: String(req.params.id) },
      order: [['createdAt', 'DESC']],
      limit: 50,
      include: [{ model: User, attributes: ['id', 'full_name', 'email'] }]
    });
    res.json(activities.map(presentActivity));
  }));

  return router;
}
