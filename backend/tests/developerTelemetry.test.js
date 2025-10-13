import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_SECRETS = 'test-secret';
process.env.DEVELOPER_API_KEY = 'test-developer-key';

vi.mock('../src/services/readiness.js', () => ({
  getReadinessReport: vi.fn().mockResolvedValue({
    generated_at: new Date().toISOString(),
    summary: {},
    checks: []
  })
}));

vi.mock('../src/services/errorLogBuffer.js', () => ({
  getRecentErrorLogs: vi.fn().mockReturnValue([])
}));

vi.mock('../src/services/terminalAuditLog.js', () => ({
  getTerminalEvents: vi.fn().mockReturnValue([])
}));

describe('developer telemetry snapshots', () => {
  let models;
  let getDeveloperTelemetry;
  let organizationId;

  beforeAll(async () => {
    models = await import('../src/db.js');
    ({ getDeveloperTelemetry } = await import('../src/services/developerTelemetry.js'));

    await models.sequelize.sync({ force: true });

    const organization = await models.Organization.create(
      { name: 'Snapshot Org', slug: 'snapshot-org' },
      { skipOrganizationScope: true }
    );
    organizationId = organization.id;
  });

  afterAll(async () => {
    if (models?.sequelize) {
      await models.sequelize.close();
    }
  });

  it('persists snapshots and exposes database-backed history', async () => {
    const { TelemetrySnapshot } = models;

    await TelemetrySnapshot.destroy({ where: {}, truncate: true });

    const first = await getDeveloperTelemetry({ organizationId });
    expect(first.performance).toBeDefined();
    expect(first.history.length).toBeGreaterThanOrEqual(1);

    let stored = await TelemetrySnapshot.count({ where: { organizationId } });
    expect(stored).toBe(1);

    const second = await getDeveloperTelemetry({ organizationId });
    stored = await TelemetrySnapshot.count({ where: { organizationId } });
    expect(stored).toBeGreaterThanOrEqual(2);

    expect(second.history.length).toBeGreaterThanOrEqual(2);
    const latestHistory = second.history[second.history.length - 1];
    expect(latestHistory.captured_at).toBe(second.performance.captured_at);
    expect(latestHistory.load_one).toBe(second.performance.load_average.one);
  });
});
