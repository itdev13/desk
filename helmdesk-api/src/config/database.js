const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * MongoDB connection. The app requires a database — unlike a stateless tool,
 * HelmDesk's whole product (tickets, SLAs, comments) lives here.
 */
class Database {
  constructor() {
    this.connected = false;
  }

  async connect() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      logger.error('MONGODB_URI is not set. HelmDesk cannot run without a database.');
      process.exit(1);
    }
    try {
      await mongoose.connect(uri);
      this.connected = true;
      logger.info('✅ MongoDB connected');
    } catch (err) {
      logger.error('❌ MongoDB connection failed:', { message: err.message });
      process.exit(1);
    }

    mongoose.connection.on('disconnected', () => {
      this.connected = false;
      logger.warn('MongoDB disconnected');
    });
    mongoose.connection.on('reconnected', () => {
      this.connected = true;
      logger.info('MongoDB reconnected');
    });
  }

  isConnected() {
    return this.connected && mongoose.connection.readyState === 1;
  }
}

module.exports = new Database();
