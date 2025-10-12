import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs/promises';
import { normalizePhone } from '../src/utils/phone.js';

process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_SECRETS = 'test-secret';
process.env.REFRESH_SECRET = 'test-refresh';
process.env.REFRESH_SECRETS = 'test-refresh';
process.env.CORS_ORIGIN = '*';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

vi.mock('../src/queues/lowStock.js', () => ({
  enqueueLowStockScan: vi.fn().mockResolvedValue(undefined),
  initLowStockQueue: vi.fn().mockResolvedValue({})
}));

vi.mock('../src/services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../src/services/cache.js', () => ({
  getCachedStockOverview: vi.fn().mockResolvedValue(null),
  cacheStockOverview: vi.fn().mockResolvedValue(undefined),
  invalidateStockOverviewCache: vi.fn().mockResolvedValue(undefined),
  stockCacheKeys: { overview: 'cache:stock:overview:v1' }
}));

vi.mock('../src/services/backup.js', () => ({
  scheduleBackups: vi.fn(),
  runBackup: vi.fn().mockResolvedValue('/tmp/fake-backup.sql'),
  listBackups: vi.fn().mockResolvedValue([
    { file: 'fake-backup.sql', size: 123, createdAt: new Date().toISOString() }
  ]),
  ensureBackupDir: vi.fn().mockResolvedValue('/tmp'),
  getBackupOptions: vi.fn().mockReturnValue({ enabled: false, schedule: '0 3 * * *', retainDays: 14 })
}));

vi.mock('multer', () => {
  class MulterError extends Error {}
  const multerMock = () => (req, _res, next) => next();
  multerMock.MulterError = MulterError;
  multerMock.memoryStorage = () => ({ storage: 'memory' });
  multerMock.diskStorage = () => ({ storage: 'disk' });
  return {
    default: multerMock,
    MulterError,
    memoryStorage: multerMock.memoryStorage,
    diskStorage: multerMock.diskStorage
  };
});

describe('End-to-end system workflow', () => {
  const report = [];
  const io = { emit: vi.fn() };
  let app;
  let authToken;
  let refreshToken;
  let organizationId;
  let binA;
  let binB;
  let stockProduct;
  let serialProduct;
  let workOrderPartId;
  let serialRecord;
  let purchaseOrderId;
  let supplierId;
  let models;
  let runAsOrganizationFn;
  let sendEmailMock;
  let customerId;
  let saleId;
  let backorderSaleId;
  let saleStartingOnHand;

  const step = async (name, fn) => {
    try {
      const value = await fn();
      report.push({ name, status: 'passed' });
      return value;
    } catch (error) {
      report.push({ name, status: 'failed', error: error?.message || String(error) });
      throw error;
    }
  };

  beforeAll(async () => {
    const { createApp, registerRoutes } = await import('../src/app.js');
    const db = await import('../src/db.js');
    const { runAsOrganization } = await import('../src/services/requestContext.js');
    sendEmailMock = (await import('../src/services/email.js')).sendEmail;

    models = db;
    runAsOrganizationFn = runAsOrganization;

    app = createApp();
    registerRoutes(app, io);

    const { sequelize, Organization, User, Location, Bin, Product, StockLevel } = models;

    await sequelize.sync({ force: true });

    const organization = await Organization.create({ name: 'Test Org', slug: 'test-org' }, { skipOrganizationScope: true });
    organizationId = organization.id;

    await runAsOrganization(organizationId, async () => {
      const passwordHash = await bcrypt.hash('AdminPass123!', 10);
      await User.create({
        full_name: 'Admin User',
        email: 'admin@test.com',
        password_hash: passwordHash,
        role: 'admin',
        must_change_password: false
      });

      const location = await Location.create({ site: 'Main Facility', room: 'A1' });
      binA = await Bin.create({ code: 'BIN-A1', locationId: location.id });
      binB = await Bin.create({ code: 'BIN-B1', locationId: location.id });
      stockProduct = await Product.create({ sku: 'WIDGET-01', name: 'Widget', reorder_point: 2, lead_time_days: 5 });
      serialProduct = await Product.create({ sku: 'TRACK-01', name: 'Tracked Widget', track_serial: true, reorder_point: 1 });
      await StockLevel.create({ productId: stockProduct.id, binId: binA.id, on_hand: 10, reserved: 0 });
      await StockLevel.create({ productId: serialProduct.id, binId: binA.id, on_hand: 5, reserved: 0 });
    });
  });

  afterAll(async () => {
    if (models?.sequelize) {
      await models.sequelize.close();
    }

    const outputDir = path.resolve(process.cwd(), '../reports');
    await fs.mkdir(outputDir, { recursive: true });
    const file = path.join(outputDir, 'system-test-report.json');
    const payload = {
      generatedAt: new Date().toISOString(),
      steps: report
    };
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
  });

  it('covers core platform flows', async () => {
    await step('Health check', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });

    const login = await step('Authenticate admin', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ organization: 'test-org', email: 'admin@test.com', password: 'AdminPass123!' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access');
      expect(res.body).toHaveProperty('refresh');
      return res.body;
    });
    authToken = login.access;
    refreshToken = login.refresh;

    await step('Update organization profile with identity data', async () => {
      const res = await request(app)
        .put('/organization')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Org',
          legal_name: 'Test Org Pty Ltd',
          contact_email: 'ops@test.org',
          timezone: 'Australia/Sydney',
          abn: '98 765 432 109',
          tax_id: 'TAX-123',
          address: '1 Example Road\nSydney NSW 2000',
          phone: '+61 2 1234 5678',
          website: 'https://example.org',
          logo_url: 'https://cdn.example.org/logo.png',
          invoice_prefix: 'TO-',
          default_payment_terms: 'Net 14',
          invoice_notes: 'Thanks for your business.',
          currency: 'AUD'
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Test Org',
        legal_name: 'Test Org Pty Ltd',
        abn: '98 765 432 109',
        invoice_prefix: 'TO-',
        default_payment_terms: 'Net 14',
        currency: 'AUD'
      });
    });

    await step('Refresh access token', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refresh: refreshToken });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access');
    });

    await step('Create additional user', async () => {
      const res = await request(app)
        .post('/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          full_name: 'Technician Jane',
          email: 'tech@example.com',
          password: 'TechPass123!',
          role: 'user',
          must_change_password: true
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: 'tech@example.com', role: 'user' });
      expect(res.body.must_change_password).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 50));
      const userEmailCalls = sendEmailMock.mock.calls.filter(([options]) => options?.to === 'tech@example.com');
      expect(userEmailCalls.some(([options]) => options.text?.includes('Temporary password: TechPass123!'))).toBe(true);
      expect(userEmailCalls.some(([options]) => options.text?.includes('Organization: test-org'))).toBe(true);
    });

    await step('List users', async () => {
      const res = await request(app)
        .get('/users')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const [firstUser] = res.body;
      expect(firstUser).toHaveProperty('online');
      expect(firstUser).toHaveProperty('last_seen_at');
    });

    await step('Create new product', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ sku: 'NEW-100', name: 'New Gadget', reorder_point: 3, lead_time_days: 7, unit_price: 199.99 });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
    });

    await step('List products', async () => {
      const res = await request(app)
        .get('/products')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    await step('View stock summary', async () => {
      const res = await request(app)
        .get('/stock')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    await step('Move stock between bins', async () => {
      const res = await request(app)
        .post('/stock/move')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          product_id: stockProduct.id,
          qty: 2,
          from_bin_id: binA.id,
          to_bin_id: binB.id,
          reason: 'transfer'
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('ok', true);
    });

    await step('Fetch stock overview dashboard', async () => {
      const res = await request(app)
        .get('/stock/overview')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('productCount');
    });

    serialRecord = await step('Register tracked serial number', async () => {
      const res = await request(app)
        .post('/serials')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ product_id: serialProduct.id, serial: 'SN-1001', bin_id: binA.id });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('serial', 'SN-1001');
      return res.body;
    });

    supplierId = await step('Create supplier', async () => {
      const res = await request(app)
        .post('/purchasing/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Best Parts Co', contact_email: 'sales@bestparts.test' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      return res.body.id;
    });

    await step('List suppliers', async () => {
      const res = await request(app)
        .get('/purchasing/suppliers')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    purchaseOrderId = await step('Create purchase order', async () => {
      const res = await request(app)
        .post('/purchasing/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reference: 'PO-001',
          supplier_id: supplierId,
          lines: [
            { product_id: stockProduct.id, qty_ordered: 3, unit_cost: 12 },
            { product_id: serialProduct.id, qty_ordered: 1, unit_cost: 45 }
          ]
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      return res.body.id;
    });

    const purchaseOrders = await step('List purchase orders', async () => {
      const res = await request(app)
        .get('/purchasing/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      return res.body;
    });

    const serialLine = purchaseOrders[0].lines.find(line => line.productId === serialProduct.id);
    const stockLine = purchaseOrders[0].lines.find(line => line.productId === stockProduct.id);

    await step('Receive purchase order items', async () => {
      const res = await request(app)
        .post(`/purchasing/purchase-orders/${purchaseOrderId}/receive`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          receipts: [
            { line_id: stockLine.id, qty: 3, bin_id: binA.id },
            { line_id: serialLine.id, qty: 1, bin_id: binA.id, serials: ['SN-2001'] }
          ]
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
    });

    customerId = await step('Create customer record', async () => {
      const res = await request(app)
        .post('/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Retail Client',
          email: 'retail@example.com',
          phone: '+61 2 5555 0000',
          company: 'Retail Co',
          address: '45 Example Street, Sydney NSW',
          notes: 'Priority account'
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Retail Client');
      return res.body.id;
    });

    await step('Search customers by keyword', async () => {
      const res = await request(app)
        .get('/customers')
        .query({ q: 'Retail' })
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((customer) => customer.id);
      expect(ids).toContain(customerId);
    });

    await step('Update customer contact details', async () => {
      const updatePayload = { phone: '+61 2 5555 1234' };
      const res = await request(app)
        .put(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updatePayload);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('phone', normalizePhone(updatePayload.phone));
    });

    saleStartingOnHand = await step('Inspect available stock before sale', async () => {
      return await runAsOrganizationFn(organizationId, async () => {
        const level = await models.StockLevel.findOne({ where: { productId: stockProduct.id, binId: binA.id } });
        expect(level).toBeTruthy();
        return level.on_hand;
      });
    });

    saleId = await step('Create sale and reserve stock', async () => {
      const res = await request(app)
        .post('/sales')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customer_id: customerId,
          reference: 'SALE-1001',
          items: [{ product_id: stockProduct.id, quantity: 2 }]
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('status', 'reserved');
      expect(res.body.items[0]).toHaveProperty('qty_reserved', 2);
      return res.body.id;
    });

    await step('Complete sale and deduct inventory', async () => {
      const res = await request(app)
        .post(`/sales/${saleId}/complete`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'complete');
      expect(res.body.items[0]).toMatchObject({ qty_reserved: 0, qty_shipped: 2 });
    });

    await step('Verify stock level decreased after sale', async () => {
      await runAsOrganizationFn(organizationId, async () => {
        const level = await models.StockLevel.findOne({ where: { productId: stockProduct.id, binId: binA.id } });
        expect(level).toBeTruthy();
        expect(level.on_hand).toBe(saleStartingOnHand - 2);
        expect(level.reserved).toBe(0);
      });
    });

    backorderSaleId = await step('Create sale resulting in backorder', async () => {
      const res = await request(app)
        .post('/sales')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customer_id: customerId,
          reference: 'SALE-1002',
          items: [{ product_id: stockProduct.id, quantity: 20 }]
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('status', 'backorder');
      expect(res.body.items[0].qty_reserved).toBeLessThan(20);
      return res.body.id;
    });

    await step('Top up inventory for backorder sale', async () => {
      await runAsOrganizationFn(organizationId, async () => {
        const level = await models.StockLevel.findOne({ where: { productId: stockProduct.id, binId: binA.id } });
        expect(level).toBeTruthy();
        level.on_hand += 15;
        await level.save();
      });
    });

    await step('Retry reservation after replenishment', async () => {
      const res = await request(app)
        .post(`/sales/${backorderSaleId}/reserve`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'reserved');
      expect(res.body.items[0]).toHaveProperty('qty_reserved', 20);
    });

    await step('Complete backordered sale', async () => {
      const res = await request(app)
        .post(`/sales/${backorderSaleId}/complete`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'complete');
      expect(res.body.items[0]).toMatchObject({ qty_reserved: 0, qty_shipped: 20 });
    });

    await step('Prevent deleting customer with sale history', async () => {
      const res = await request(app)
        .delete(`/customers/${customerId}`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(409);
    });

    const disposableCustomerId = await step('Create disposable customer', async () => {
      const res = await request(app)
        .post('/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'One-time Client', email: 'one-time@example.com' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      return res.body.id;
    });

    await step('Delete disposable customer', async () => {
      const res = await request(app)
        .delete(`/customers/${disposableCustomerId}`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(204);
    });

    const workOrderId = await step('Create work order', async () => {
      const res = await request(app)
        .post('/work-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customer_name: 'John Doe',
          device_info: 'iPhone 12',
          priority: 'high',
          parts: [{ product_id: stockProduct.id, qty: 2 }]
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      return res.body.id;
    });

    await step('Prepare work order part id', async () => {
      await runAsOrganizationFn(organizationId, async () => {
        const part = await models.WorkOrderPart.findOne({ where: { productId: stockProduct.id } });
        expect(part).toBeTruthy();
        workOrderPartId = part.id;
      });
    });

    await step('Reserve parts for work order', async () => {
      const res = await request(app)
        .post(`/work-orders/${workOrderId}/reserve`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ items: [{ part_id: workOrderPartId, qty: 2 }] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
    });

    await step('Pick reserved parts', async () => {
      const res = await request(app)
        .post(`/work-orders/${workOrderId}/pick`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ part_id: workOrderPartId, bin_id: binA.id, qty: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
    });

    await step('Return picked part to stock', async () => {
      const res = await request(app)
        .post(`/work-orders/${workOrderId}/return`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ part_id: workOrderPartId, bin_id: binA.id, qty: 1, source: 'picked' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
    });

    await step('Update work order status', async () => {
      const res = await request(app)
        .patch(`/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'completed', status_note: 'Device repaired' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'completed');
    });

    const serialsList = await step('List serial numbers', async () => {
      const res = await request(app)
        .get('/serials')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      return res.body;
    });

    const serialForRma = serialsList.find(serial => serial.serial === 'SN-2001');

    const rmaId = await step('Create RMA case', async () => {
      const res = await request(app)
        .post('/rma')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reference: 'RMA-001', supplier_id: supplierId, reason: 'Defective part' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      return res.body.id;
    });

    await step('Add item to RMA case', async () => {
      const res = await request(app)
        .post(`/rma/${rmaId}/items`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ product_id: serialProduct.id, qty: 1, serial_id: serialForRma?.id });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('qty', 1);
    });

    await step('Advance RMA status', async () => {
      const res = await request(app)
        .patch(`/rma/${rmaId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'submitted', notes: 'Sent to supplier' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'submitted');
    });

    await step('Read application settings', async () => {
      const res = await request(app)
        .get('/settings')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('backup_schedule');
    });

    await step('Update application settings', async () => {
      const res = await request(app)
        .put('/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ low_stock_alerts_enabled: true, default_sla_hours: 12, notification_emails: ['alerts@test.com'] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('default_sla_hours', 12);
    });

    await step('List backups', async () => {
      const res = await request(app)
        .get('/backups')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('backups');
    });

    await step('Trigger manual backup', async () => {
      const res = await request(app)
        .post('/backups/run')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('file');
    });

    await step('Fetch work order list', async () => {
      const res = await request(app)
        .get('/work-orders')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
