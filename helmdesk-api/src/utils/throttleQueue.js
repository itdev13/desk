const logger = require('./logger');

/**
 * Tiny serial task queue with a fixed delay between tasks.
 * Used to avoid hammering the GHL API when many INSTALL webhooks land at once
 * (e.g. an agency bulk-installs across many sub-accounts).
 */
class ThrottleQueue {
  constructor({ name = 'queue', delayMs = 350 } = {}) {
    this.name = name;
    this.delayMs = delayMs;
    this.tasks = [];
    this.running = false;
  }

  size() {
    return this.tasks.length;
  }

  push(task) {
    this.tasks.push(task);
    if (!this.running) this._drain();
  }

  async _drain() {
    this.running = true;
    while (this.tasks.length) {
      const task = this.tasks.shift();
      try {
        await task();
      } catch (err) {
        logger.warn(`ThrottleQueue[${this.name}] task failed (non-fatal)`, { message: err.message });
      }
      if (this.tasks.length) await new Promise((r) => setTimeout(r, this.delayMs));
    }
    this.running = false;
  }
}

module.exports = ThrottleQueue;
