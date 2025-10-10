import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 8080,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || 'repair_center',
    user: process.env.DB_USER || 'root',
    pass: process.env.DB_PASS || ''
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev',
    jwtExpires: process.env.JWT_EXPIRES || '15m',
    refreshSecret: process.env.REFRESH_SECRET || 'devrefresh',
    refreshExpires: process.env.REFRESH_EXPIRES || '7d'
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  },
  cache: {
    stockOverviewTtl: Number(process.env.STOCK_OVERVIEW_CACHE_TTL || 30)
  }
};

if (config.env === 'production') {
  const insecureSecrets = ['dev', 'devrefresh'];
  if (!process.env.JWT_SECRET || insecureSecrets.includes(config.auth.jwtSecret)) {
    throw new Error('JWT_SECRET must be provided in production');
  }
  if (!process.env.REFRESH_SECRET || insecureSecrets.includes(config.auth.refreshSecret)) {
    throw new Error('REFRESH_SECRET must be provided in production');
  }
}
