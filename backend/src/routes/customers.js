import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { Customer, Sale } from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { normalizePhone } from '../utils/phone.js';

const CustomerSchema = z.object({
  name: z.string().min(1).max(191),
  email: z.string().email().max(191).optional(),
  phone: z.string().max(64).optional(),
  company: z.string().max(191).optional(),
  address: z.string().max(2000).optional(),
  notes: z.string().max(4000).optional()
});

const UpdateSchema = CustomerSchema.partial().refine((payload) => Object.keys(payload).length > 0, {
  message: 'At least one field must be provided for an update.'
});

function sanitizeCustomerPayload(payload) {
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'undefined') continue;
    if (value === null) {
      result[key] = null;
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      result[key] = trimmed.length ? trimmed : null;
    } else {
      result[key] = value;
    }
  }
  if (typeof result.email === 'string') {
    result.email = result.email.toLowerCase();
  }
  if (typeof result.phone === 'string') {
    result.phone = normalizePhone(result.phone);
  }
  return result;
}

export default function createCustomerRoutes() {
  const router = Router();

  router.get('/', requireAuth(['admin', 'user', 'developer']), asyncHandler(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const customers = await Customer.findAll({
      order: [['name', 'ASC']],
      limit: 250
    });
    if (!search) {
      res.json(customers);
      return;
    }
    const filtered = customers.filter((customer) => {
      const name = (customer.name || '').toLowerCase();
      const company = (customer.company || '').toLowerCase();
      const email = (customer.email || '').toLowerCase();
      const phone = (customer.phone || '').toLowerCase();
      return name.includes(search) || company.includes(search) || email.includes(search) || phone.includes(search);
    });
    res.json(filtered);
  }));

  router.post('/', requireAuth(['admin', 'user', 'developer']), asyncHandler(async (req, res) => {
    const parsed = CustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const payload = sanitizeCustomerPayload(parsed.data);
    if (payload.email) {
      const existingEmail = await Customer.findOne({ where: { email: payload.email } });
      if (existingEmail) {
        throw new HttpError(409, 'A customer with that email already exists');
      }
    }
    if (payload.phone) {
      const existingPhone = await Customer.findOne({ where: { phone: payload.phone } });
      if (existingPhone) {
        throw new HttpError(409, 'A customer with that phone number already exists');
      }
    }
    const customer = await Customer.create(payload);
    res.status(201).json(customer);
  }));

  router.put('/:id', requireAuth(['admin', 'user', 'developer']), asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid customer id');
    }
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid request payload', parsed.error.flatten());
    }
    const customer = await Customer.findByPk(id);
    if (!customer) {
      throw new HttpError(404, 'Customer not found');
    }
    const payload = sanitizeCustomerPayload(parsed.data);
    if (payload.email) {
      const existingEmail = await Customer.findOne({ where: { email: payload.email } });
      if (existingEmail && existingEmail.id !== customer.id) {
        throw new HttpError(409, 'Another customer is already using that email');
      }
    }
    if (payload.phone) {
      const existingPhone = await Customer.findOne({ where: { phone: payload.phone } });
      if (existingPhone && existingPhone.id !== customer.id) {
        throw new HttpError(409, 'Another customer is already using that phone number');
      }
    }
    Object.assign(customer, payload);
    await customer.save();
    res.json(customer);
  }));

  router.delete('/:id', requireAuth(['admin', 'user', 'developer']), asyncHandler(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Invalid customer id');
    }
    const customer = await Customer.findByPk(id);
    if (!customer) {
      throw new HttpError(404, 'Customer not found');
    }
    const saleCount = await Sale.count({ where: { customerId: customer.id } });
    if (saleCount > 0) {
      throw new HttpError(409, 'Cannot delete a customer with existing sales');
    }
    await customer.destroy();
    res.status(204).send();
  }));

  return router;
}
