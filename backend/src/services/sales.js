import { Op } from 'sequelize';
import {
  Customer,
  Product,
  Sale,
  SaleItem,
  StockLevel,
  StockMove,
  withTransaction
} from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { notifySaleStatusChanged } from './notificationService.js';
import { recordActivity } from './activityLog.js';

const saleInclude = [
  {
    model: Customer,
    attributes: ['id', 'name', 'email', 'phone', 'company', 'address']
  },
  {
    model: SaleItem,
    as: 'items',
    include: [
      {
        model: Product,
        attributes: ['id', 'sku', 'name', 'unit_price']
      }
    ]
  }
];

const saleOrder = [
  ['createdAt', 'DESC'],
  [{ model: SaleItem, as: 'items' }, 'id', 'ASC']
];

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toPlainSale(sale) {
  if (!sale) return null;
  const plain = sale.get({ plain: true });
  if (Array.isArray(plain.items)) {
    plain.items = plain.items.map((item) => ({
      ...item,
      product: item.product || null
    }));
  }
  return plain;
}

async function loadSale(id, options = {}) {
  const sale = await Sale.findByPk(id, {
    ...options,
    include: saleInclude,
    order: saleOrder
  });
  return sale;
}

async function reserveFromStock(productId, quantity, { transaction, saleId, performedBy }) {
  if (quantity <= 0) return 0;
  const levels = await StockLevel.findAll({
    where: { productId },
    transaction,
    lock: transaction?.LOCK?.UPDATE
  });
  levels.sort((a, b) => (b.on_hand - b.reserved) - (a.on_hand - a.reserved));
  let remaining = quantity;
  for (const level of levels) {
    const available = Math.max(0, level.on_hand - level.reserved);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    level.reserved += take;
    await level.save({ transaction });
    await StockMove.create({
      productId,
      qty: take,
      from_bin_id: level.binId,
      reason: 'reserve',
      saleId,
      performed_by: performedBy ?? null
    }, { transaction });
    remaining -= take;
    if (remaining === 0) break;
  }
  return quantity - remaining;
}

async function consumeReservedStock(productId, quantity, { transaction, saleId, performedBy }) {
  if (quantity <= 0) return;
  const levels = await StockLevel.findAll({
    where: { productId },
    transaction,
    lock: transaction?.LOCK?.UPDATE
  });
  levels.sort((a, b) => b.reserved - a.reserved);
  let remaining = quantity;
  for (const level of levels) {
    if (remaining <= 0) break;
    const releasable = Math.min(level.reserved, remaining);
    if (releasable <= 0) continue;
    if (level.on_hand < releasable) {
      throw new HttpError(409, 'Reserved stock is inconsistent for this product');
    }
    level.reserved -= releasable;
    level.on_hand -= releasable;
    await level.save({ transaction });
    await StockMove.create({
      productId,
      qty: releasable,
      from_bin_id: level.binId,
      reason: 'invoice_sale',
      saleId,
      performed_by: performedBy ?? null
    }, { transaction });
    remaining -= releasable;
  }
  if (remaining > 0) {
    throw new HttpError(409, 'Unable to consume reserved stock for this product');
  }
}

async function releaseReservedStock(productId, quantity, { transaction, saleId, performedBy }) {
  if (quantity <= 0) return;
  const levels = await StockLevel.findAll({
    where: { productId },
    transaction,
    lock: transaction?.LOCK?.UPDATE
  });
  levels.sort((a, b) => b.reserved - a.reserved);
  let remaining = quantity;
  for (const level of levels) {
    if (remaining <= 0) break;
    const releasable = Math.min(level.reserved, remaining);
    if (releasable <= 0) continue;
    level.reserved -= releasable;
    await level.save({ transaction });
    await StockMove.create({
      productId,
      qty: releasable,
      from_bin_id: level.binId,
      reason: 'release',
      saleId,
      performed_by: performedBy ?? null
    }, { transaction });
    remaining -= releasable;
  }
  if (remaining > 0) {
    throw new HttpError(409, 'Unable to release reserved stock for this product');
  }
}

export async function listSales({ status, search } = {}) {
  const where = {};
  if (status) {
    where.status = status;
  }
  if (search) {
    const likeOperator = Op.iLike ?? Op.like;
    const likeValue = `%${search}%`;
    where[Op.or] = [
      { reference: { [likeOperator]: likeValue } },
      { '$customer.name$': { [likeOperator]: likeValue } },
      { '$customer.company$': { [likeOperator]: likeValue } }
    ];
  }
  const sales = await Sale.findAll({
    where,
    include: saleInclude,
    order: saleOrder
  });
  return sales.map(toPlainSale);
}

export async function getSaleById(id) {
  const sale = await loadSale(id);
  if (!sale) {
    throw new HttpError(404, 'Sale not found');
  }
  return toPlainSale(sale);
}

export async function createSale(payload, actor) {
  return withTransaction(async (transaction) => {
    const customer = await Customer.findByPk(payload.customer_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!customer) {
      throw new HttpError(404, 'Customer not found');
    }

    const sale = await Sale.create({
      customerId: customer.id,
      reference: normalizeText(payload.reference),
      notes: normalizeText(payload.notes),
      status: 'reserved',
      reserved_at: null,
      backordered_at: null,
      created_by: actor?.id ?? null
    }, { transaction });

    let allFulfilled = true;
    let anyReserved = false;

    for (const item of payload.items) {
      const product = await Product.findByPk(item.product_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!product) {
        throw new HttpError(404, `Product ${item.product_id} not found`);
      }

      const unitPrice = typeof item.unit_price === 'number' ? item.unit_price : Number(product.unit_price || 0);
      const saleItem = await SaleItem.create({
        saleId: sale.id,
        productId: product.id,
        quantity: item.quantity,
        qty_reserved: 0,
        unit_price: unitPrice,
        qty_shipped: 0
      }, { transaction });

      const reserved = await reserveFromStock(product.id, item.quantity, {
        transaction,
        saleId: sale.id,
        performedBy: actor?.id ?? null
      });
      saleItem.qty_reserved = reserved;
      if (reserved > 0) {
        anyReserved = true;
      }
      if (reserved < item.quantity) {
        allFulfilled = false;
      }
      await saleItem.save({ transaction });
    }

    if (allFulfilled) {
      sale.status = 'reserved';
      sale.reserved_at = new Date();
      sale.backordered_at = null;
    } else {
      sale.status = 'backorder';
      sale.backordered_at = new Date();
      sale.reserved_at = anyReserved ? new Date() : null;
    }

    await sale.save({ transaction });
    const fresh = await loadSale(sale.id, { transaction });
    const plain = toPlainSale(fresh);

    await recordActivity({
      organizationId: plain.organizationId ?? actor?.organization_id,
      userId: actor?.id,
      action: 'sale.created',
      entityType: 'sale',
      entityId: sale.id,
      description: `Sale #${sale.id} created for ${customer.name || customer.company || 'customer'}.`,
      metadata: { status: sale.status }
    }, { transaction });

    transaction.afterCommit(() => {
      notifySaleStatusChanged({
        organizationId: plain.organizationId ?? actor?.organization_id,
        actor,
        sale: plain,
        previousStatus: null
      }).catch((error) => {
        console.error('[notify] failed to send sale creation email', error);
      });
    });

    return plain;
  });
}

export async function attemptReserveSale(id, actor) {
  return withTransaction(async (transaction) => {
    const sale = await Sale.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      include: [{ model: SaleItem, as: 'items' }]
    });
    if (!sale) {
      throw new HttpError(404, 'Sale not found');
    }
    if (sale.status === 'complete') {
      throw new HttpError(400, 'Completed sales cannot be modified');
    }

    const previousStatus = sale.status;

    let allFulfilled = true;
    let anyReserved = false;

    for (const item of sale.items) {
      if (item.qty_reserved >= item.quantity) {
        if (item.qty_reserved > 0) anyReserved = true;
        continue;
      }
      const needed = item.quantity - item.qty_reserved;
      const reserved = await reserveFromStock(item.productId, needed, {
        transaction,
        saleId: sale.id,
        performedBy: actor?.id ?? null
      });
      if (reserved > 0) {
        item.qty_reserved += reserved;
        anyReserved = true;
      }
      if (item.qty_reserved < item.quantity) {
        allFulfilled = false;
      }
      await item.save({ transaction });
    }

    if (allFulfilled) {
      sale.status = 'reserved';
      if (!sale.reserved_at) {
        sale.reserved_at = new Date();
      }
      sale.backordered_at = null;
    } else {
      sale.status = 'backorder';
      sale.backordered_at = new Date();
      if (anyReserved && !sale.reserved_at) {
        sale.reserved_at = new Date();
      }
    }

    await sale.save({ transaction });
    const fresh = await loadSale(sale.id, { transaction });
    const plain = toPlainSale(fresh);

    if (plain.status !== previousStatus) {
      await recordActivity({
        organizationId: plain.organizationId ?? actor?.organization_id,
        userId: actor?.id,
        action: 'sale.status_change',
        entityType: 'sale',
        entityId: sale.id,
        description: `Sale #${sale.id} status changed from ${previousStatus} to ${plain.status}.`,
        metadata: { previousStatus, status: plain.status }
      }, { transaction });

      transaction.afterCommit(() => {
        notifySaleStatusChanged({
          organizationId: plain.organizationId ?? actor?.organization_id,
          actor,
          sale: plain,
          previousStatus
        }).catch((error) => {
          console.error('[notify] failed to send sale status email', error);
        });
      });
    }

    return plain;
  });
}

export async function completeSale(id, actor) {
  return withTransaction(async (transaction) => {
    const sale = await Sale.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      include: [{ model: SaleItem, as: 'items' }]
    });
    if (!sale) {
      throw new HttpError(404, 'Sale not found');
    }
    if (sale.status === 'complete') {
      return toPlainSale(await loadSale(sale.id, { transaction }));
    }

    const previousStatus = sale.status;

    for (const item of sale.items) {
      if (item.qty_reserved < item.quantity) {
        throw new HttpError(409, 'Sale has outstanding backordered items');
      }
    }

    for (const item of sale.items) {
      await consumeReservedStock(item.productId, item.quantity, {
        transaction,
        saleId: sale.id,
        performedBy: actor?.id ?? null
      });
      item.qty_reserved = Math.max(0, item.qty_reserved - item.quantity);
      const shippedTotal = item.qty_shipped + item.quantity;
      if (shippedTotal > item.quantity) {
        throw new HttpError(409, 'Shipped quantity exceeds ordered quantity');
      }
      item.qty_shipped = shippedTotal;
      await item.save({ transaction });
    }

    sale.status = 'complete';
    sale.completed_at = new Date();
    sale.completed_by = actor?.id ?? null;
    await sale.save({ transaction });

    const fresh = await loadSale(sale.id, { transaction });
    const plain = toPlainSale(fresh);

    await recordActivity({
      organizationId: plain.organizationId ?? actor?.organization_id,
      userId: actor?.id,
      action: 'sale.completed',
      entityType: 'sale',
      entityId: sale.id,
      description: `Sale #${sale.id} marked as complete.`,
      metadata: { previousStatus, status: plain.status }
    }, { transaction });

    transaction.afterCommit(() => {
      notifySaleStatusChanged({
        organizationId: plain.organizationId ?? actor?.organization_id,
        actor,
        sale: plain,
        previousStatus
      }).catch((error) => {
        console.error('[notify] failed to send sale completion email', error);
      });
    });

    return plain;
  });
}

export async function cancelSale(id, actor) {
  return withTransaction(async (transaction) => {
    const sale = await Sale.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      include: [{ model: SaleItem, as: 'items' }]
    });
    if (!sale) {
      throw new HttpError(404, 'Sale not found');
    }
    if (sale.status === 'complete') {
      throw new HttpError(400, 'Completed sales cannot be canceled');
    }
    if (sale.status === 'canceled') {
      return toPlainSale(await loadSale(sale.id, { transaction }));
    }

    const previousStatus = sale.status;

    for (const item of sale.items) {
      if (item.qty_reserved > 0) {
        await releaseReservedStock(item.productId, item.qty_reserved, {
          transaction,
          saleId: sale.id,
          performedBy: actor?.id ?? null
        });
        item.qty_reserved = 0;
      }
      await item.save({ transaction });
    }

    sale.status = 'canceled';
    sale.backordered_at = null;
    sale.reserved_at = null;
    sale.completed_at = null;
    sale.completed_by = null;
    await sale.save({ transaction });

    const fresh = await loadSale(sale.id, { transaction });
    const plain = toPlainSale(fresh);

    await recordActivity({
      organizationId: plain.organizationId ?? actor?.organization_id,
      userId: actor?.id,
      action: 'sale.canceled',
      entityType: 'sale',
      entityId: sale.id,
      description: `Sale #${sale.id} was canceled.`,
      metadata: { previousStatus, status: plain.status }
    }, { transaction });

    transaction.afterCommit(() => {
      notifySaleStatusChanged({
        organizationId: plain.organizationId ?? actor?.organization_id,
        actor,
        sale: plain,
        previousStatus
      }).catch((error) => {
        console.error('[notify] failed to send sale cancellation email', error);
      });
    });

    return plain;
  });
}

export async function updateSaleDetails(id, updates, actor) {
  return withTransaction(async (transaction) => {
    const sale = await loadSale(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!sale) {
      throw new HttpError(404, 'Sale not found');
    }

    if (['complete', 'canceled'].includes(sale.status)) {
      throw new HttpError(409, 'Completed or canceled sales cannot be updated');
    }

    const changes = {};

    if (Object.prototype.hasOwnProperty.call(updates, 'reference')) {
      const nextReference = normalizeText(updates.reference);
      if (nextReference !== sale.reference) {
        sale.reference = nextReference;
        changes.reference = nextReference ?? null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'notes')) {
      const nextNotes = normalizeText(updates.notes);
      if (nextNotes !== sale.notes) {
        sale.notes = nextNotes;
        changes.notes = nextNotes ?? null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'customer_id')) {
      const nextCustomer = await Customer.findByPk(updates.customer_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!nextCustomer) {
        throw new HttpError(404, 'Customer not found');
      }
      if (sale.customerId !== nextCustomer.id) {
        sale.customerId = nextCustomer.id;
        changes.customer_id = nextCustomer.id;
      }
    }

    if (Object.keys(changes).length === 0) {
      return toPlainSale(sale);
    }

    await sale.save({ transaction });
    const fresh = await loadSale(sale.id, { transaction });
    const plain = toPlainSale(fresh);

    await recordActivity({
      organizationId: plain.organizationId ?? actor?.organization_id,
      userId: actor?.id,
      action: 'sale.updated',
      entityType: 'sale',
      entityId: sale.id,
      description: `Sale #${sale.id} details updated`,
      metadata: { updates: changes }
    }, { transaction }).catch(() => {});

    return plain;
  });
}
