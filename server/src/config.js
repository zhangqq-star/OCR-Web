const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'ocr-shelf-secret-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ocrshelf.db'),
  STATIC_ROOT: process.env.STATIC_ROOT || path.join(__dirname, '..', '..'),
};
