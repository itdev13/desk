require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
const database = require('./config/database');
const slaMonitor = require('./jobs/slaMonitor');

/**
 * HelmDesk API
 * GoHighLevel marketplace app: helpdesk & ticketing on top of Conversations.
 */
class HelmDeskApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3020;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    this.app.set('trust proxy', 1);

    // Allow embedding the UI as an iframe inside GHL.
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            'frame-ancestors': ["'self'", 'https://*.gohighlevel.com', 'https://*.leadconnectorhq.com']
          }
        }
      })
    );

    this.app.use(
      cors({
        origin(origin, callback) {
          if (!origin) return callback(null, true);
          const trusted =
            origin.includes('gohighlevel.com') ||
            origin.includes('leadconnectorhq.com') ||
            origin.includes('trycloudflare.com') ||
            origin.includes('ngrok') ||
            origin.includes('localhost') ||
            origin.includes('127.0.0.1') ||
            origin.includes('vercel.app') ||
            origin.includes('vaultsuite.store');
          return trusted ? callback(null, true) : callback(new Error('Not allowed by CORS'));
        },
        credentials: true
      })
    );

    this.app.use(express.json({ limit: '2mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path === '/health') return;
        logger.info(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
      });
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        app: 'HelmDesk',
        db: database.isConnected() ? 'connected' : 'disabled',
        timestamp: new Date().toISOString()
      });
    });

    this.app.use('/oauth', require('./routes/oauth'));
    this.app.use('/api/auth', require('./routes/auth'));
    this.app.use('/api/webhooks', require('./routes/webhooks'));
    this.app.use('/api/tickets', require('./routes/tickets'));
    this.app.use('/api/settings', require('./routes/settings'));
    this.app.use('/api/agents', require('./routes/agents'));
    this.app.use('/api/dashboard', require('./routes/dashboard'));
    this.app.use('/api/subscription', require('./routes/subscription'));
    this.app.use('/portal', require('./routes/portal')); // public, unauthenticated intake

    // Serve the built Custom Page UI (if present) at /app, same-origin for the GHL iframe.
    const uiDist = path.resolve(__dirname, '../../helmdesk-ui/dist');
    if (fs.existsSync(uiDist)) {
      this.app.use('/app', express.static(uiDist));
      this.app.get('/app/*', (req, res) => res.sendFile(path.join(uiDist, 'index.html')));
      logger.info('   UI: serving /app from helmdesk-ui/dist');
    }

    this.app.get('/', (req, res) => {
      res.json({ app: 'HelmDesk', version: require('../package.json').version });
    });
  }

  setupErrorHandling() {
    this.app.use((req, res) => res.status(404).json({ success: false, error: 'Not Found' }));
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', { message: err.message });
      res.status(err.status || 500).json({ success: false, error: err.message || 'Internal Server Error' });
    });
  }

  async start() {
    await database.connect();
    if (String(process.env.SLA_MONITOR ?? 'true').toLowerCase() !== 'false') {
      slaMonitor.start();
    }
    this.app.listen(this.port, () => {
      logger.info('='.repeat(48));
      logger.info('🚀 HelmDesk API started');
      logger.info(`   Port:        ${this.port}`);
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   Base URL:    ${process.env.BASE_URL || `http://localhost:${this.port}`}`);
      logger.info('='.repeat(48));
    });
  }
}

new HelmDeskApp().start();
