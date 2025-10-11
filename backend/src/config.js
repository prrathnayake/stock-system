import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parseSecrets = (value, fallback) => {
  const secrets = value
    ? value.split(',').map(s => s.trim()).filter(Boolean)
    : fallback;
  if (!secrets.length) {
    throw new Error('At least one secret must be configured');
  }
  return secrets;
};

const parseOrigins = (value) => {
  if (!value) return ['http://localhost:5173'];
  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
};

const buildKeyIds = (value, secrets) => {
  const ids = value
    ? value.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  if (ids.length && ids.length !== secrets.length) {
    throw new Error('Number of key IDs must match number of secrets');
  }
  return ids.length ? ids : secrets.map((_, idx) => `v${idx}`);
};

const jwtSecrets = parseSecrets(process.env.JWT_SECRETS, [process.env.JWT_SECRET || 'dev']);
const refreshSecrets = parseSecrets(process.env.REFRESH_SECRETS, [process.env.REFRESH_SECRET || 'devrefresh']);

const jwtKeyIds = buildKeyIds(process.env.JWT_SECRET_IDS, jwtSecrets);
const refreshKeyIds = buildKeyIds(process.env.REFRESH_SECRET_IDS, refreshSecrets);
const corsOrigins = parseOrigins(process.env.CORS_ORIGIN);

const resolveFrontendPath = () => {
  const configured = process.env.FRONTEND_DIST_PATH;
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(__dirname, '../../frontend/dist');
};

const resolveUploadsPath = () => {
  const configured = process.env.UPLOADS_DIRECTORY;
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(__dirname, '../../uploads');
};

const parseFileSize = (value, fallback) => {
  if (!value) return fallback;
  const trimmed = String(value).trim().toLowerCase();
  const directNumber = Number(trimmed);
  if (!Number.isNaN(directNumber) && directNumber > 0) {
    return directNumber;
  }
  const match = trimmed.match(/^(\d+)(kb|mb|gb)$/);
  if (!match) return fallback;
  const size = Number(match[1]);
  const unit = match[2];
  const multipliers = { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return size > 0 ? size * multipliers[unit] : fallback;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 8080,
  db: {
    dialect: process.env.DB_DIALECT || 'mysql',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || 'repair_center',
    user: process.env.DB_USER || 'root',
    pass: process.env.DB_PASS || '',
    storage: process.env.DB_STORAGE || ''
  },
  auth: {
    jwtSecret: jwtSecrets[0],
    jwtSecrets,
    jwtKeyId: jwtKeyIds[0],
    jwtKeyIds,
    jwtExpires: process.env.JWT_EXPIRES || '15m',
    refreshSecret: refreshSecrets[0],
    refreshSecrets,
    refreshKeyId: refreshKeyIds[0],
    refreshKeyIds,
    refreshExpires: process.env.REFRESH_EXPIRES || '7d'
  },
  cors: {
    origins: corsOrigins,
    allowAll: corsOrigins.includes('*')
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  },
  cache: {
    stockOverviewTtl: Number(process.env.STOCK_OVERVIEW_CACHE_TTL || 30)
  },
  tls: {
    enabled: process.env.TLS_ENABLED === 'true',
    keyPath: process.env.TLS_KEY_PATH || '',
    certPath: process.env.TLS_CERT_PATH || '',
    caPath: process.env.TLS_CA_PATH || ''
  },
  backup: {
    enabled: process.env.BACKUP_ENABLED === 'true',
    schedule: process.env.BACKUP_SCHEDULE || '0 3 * * *',
    directory: process.env.BACKUP_DIRECTORY || 'backups',
    retainDays: Number(process.env.BACKUP_RETAIN_DAYS || 14)
  },
  mail: {
    enabled: process.env.MAIL_ENABLED === 'true',
    host: process.env.MAIL_HOST || '',
    port: Number(process.env.MAIL_PORT || 587),
    secure: process.env.MAIL_SECURE === 'true',
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || 'no-reply@stock-system.local',
    url: process.env.MAIL_URL || '',
    rejectUnauthorized: process.env.MAIL_TLS_REJECT_UNAUTHORIZED !== 'false'
  },
  frontend: {
    serve: process.env.SERVE_FRONTEND !== 'false',
    distPath: resolveFrontendPath()
  },
  uploads: {
    directory: resolveUploadsPath(),
    publicPath: process.env.UPLOADS_PUBLIC_PATH || '/uploads',
    maxLogoFileSize: parseFileSize(process.env.UPLOAD_MAX_FILE_SIZE, 2 * 1024 * 1024)
  }
};

if (config.env === 'production') {
  const insecureSecrets = ['dev', 'devrefresh'];
  if (!config.auth.jwtSecret || insecureSecrets.includes(config.auth.jwtSecret)) {
    throw new Error('JWT_SECRET must be provided in production');
  }
  if (!config.auth.refreshSecret || insecureSecrets.includes(config.auth.refreshSecret)) {
    throw new Error('REFRESH_SECRET must be provided in production');
  }
  if (config.tls.enabled && (!config.tls.keyPath || !config.tls.certPath)) {
    throw new Error('TLS is enabled but TLS_KEY_PATH or TLS_CERT_PATH is missing');
  }
  if (config.backup.enabled && !config.backup.directory) {
    throw new Error('BACKUP_DIRECTORY must be provided when BACKUP_ENABLED=true');
  }
  if (config.mail.enabled) {
    if (!config.mail.url && !config.mail.host) {
      throw new Error('MAIL_HOST or MAIL_URL must be provided when MAIL_ENABLED=true');
    }
    if (!config.mail.from) {
      throw new Error('MAIL_FROM must be provided when MAIL_ENABLED=true');
    }
  }
}
