const winston = require('winston');

/**
 * App-wide logger. JSON in production, pretty console in dev.
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    process.env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}] ${message}${rest}`;
        })
  ),
  transports: [new winston.transports.Console()]
});

module.exports = logger;
