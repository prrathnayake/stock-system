import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import multer from 'multer';
import { config } from '../config.js';

function ensureUploadDirectory() {
  if (!existsSync(config.uploads.directory)) {
    mkdirSync(config.uploads.directory, { recursive: true });
  }
}

ensureUploadDirectory();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDirectory();
    cb(null, config.uploads.directory);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg'].includes(ext) ? ext : '.png';
    const name = `${Date.now()}-${randomBytes(8).toString('hex')}${safeExt}`;
    cb(null, name);
  }
});

const allowedMimeTypes = new Set(['image/png', 'image/jpeg']);

function logoFileFilter(_req, file, cb) {
  if (!allowedMimeTypes.has(file.mimetype)) {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname);
    error.message = 'Only PNG or JPEG images are allowed for logos.';
    return cb(error);
  }
  cb(null, true);
}

export const logoUpload = multer({
  storage,
  fileFilter: logoFileFilter,
  limits: { fileSize: config.uploads.maxLogoFileSize }
});
