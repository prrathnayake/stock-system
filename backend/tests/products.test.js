import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

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

vi.mock('../src/services/notificationService.js', () => ({
  notifyProductArchived: vi.fn().mockResolvedValue(undefined),
  notifyProductCreated: vi.fn().mockResolvedValue(undefined),
  notifyProductUpdated: vi.fn().mockResolvedValue(undefined)
}));

describe('Product deletion', () => {
  let app;
  let models;
  let runAsOrganization;
  let organizationId;
  let productId;
  let authToken;

  beforeAll(async () => {
    const { createApp, registerRoutes } = await import('../src/app.js');
    models = await import('../src/db.js');
    ({ runAsOrganization } = await import('../src/services/requestContext.js'));

    const io = { emit: vi.fn() };
    app = createApp();
    registerRoutes(app, io);

    await models.sequelize.sync({ force: true });

    const organization = await models.Organization.create({ name: 'Test Org', slug: 'test-org' }, { skipOrganizationScope: true });
    organizationId = organization.id;

    await runAsOrganization(organizationId, async () => {
      const passwordHash = await bcrypt.hash('AdminPass123!', 10);
      await models.User.create({
        full_name: 'Admin User',
        email: 'admin@test.com',
        password_hash: passwordHash,
        role: 'admin',
        must_change_password: false
      });

      const bin = await models.Bin.create({ code: 'BIN-A1' });
      const product = await models.Product.create({ sku: 'WIDGET-DEL', name: 'Disposable Widget' });
      productId = product.id;
      await models.StockLevel.create({ productId: product.id, binId: bin.id, on_hand: 7, reserved: 2 });
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ organization: 'test-org', email: 'admin@test.com', password: 'AdminPass123!' });

    expect(login.status).toBe(200);
    authToken = login.body.access;
  });

  afterAll(async () => {
    await models.sequelize.close();
  });

  it('removes stock levels when a product is archived', async () => {
    const response = await request(app)
      .delete(`/products/${productId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(204);

    await runAsOrganization(organizationId, async () => {
      const remaining = await models.StockLevel.count({ where: { productId } });
      expect(remaining).toBe(0);
    });
  });
});
