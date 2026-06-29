const mongoose = require('mongoose');

/**
 * Atomic per-workspace sequence counter for human-readable ticket numbers (e.g. HD-1042).
 * We use findOneAndUpdate({$inc}) so concurrent ticket creations never collide — never count
 * documents to derive the next number.
 */
const counterSchema = new mongoose.Schema({
  // Composite key: `${locationId}:${name}` — keeps sequences isolated per workspace.
  key: { type: String, required: true, unique: true, index: true },
  seq: { type: Number, default: 0 }
});

/** Returns the next integer in the named sequence for a workspace, atomically. */
counterSchema.statics.next = async function next(locationId, name = 'ticket') {
  const doc = await this.findOneAndUpdate(
    { key: `${locationId}:${name}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
