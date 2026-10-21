const mongoose = require('mongoose');

/**
 * A single public intake form. A workspace can have MANY forms (e.g. "Repair Request", "Billing"),
 * each with its own fields, branding-inherited look, and short public slug / URL.
 *
 * The slug is RANDOM and short (not derived from the locationId, which is public). The customer-facing
 * form is served at /f/:slug (short path). Fields mirror the portal field shape used by the builder.
 */
const fieldSchema = new mongoose.Schema(
  {
    _id: false,
    key: { type: String, required: true },
    type: { type: String, enum: ['text', 'textarea', 'select', 'radio', 'checkbox'], default: 'text' },
    label: { type: String, default: 'Field' },
    placeholder: { type: String, default: '' },
    helpText: { type: String, default: '' },
    required: { type: Boolean, default: false },
    maxLength: { type: Number, default: null },
    options: { type: [String], default: [] },
    maps: { type: String, default: null } // name|email|phone|subject|message|priority|null(custom)
  },
  { _id: false }
);

const portalFormSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    name: { type: String, default: 'Support request' }, // internal + shown as the form title
    slug: { type: String, required: true, unique: true, index: true }, // short public id (the lookup key)
    // A readable, URL-safe slug of the agency's brand/workspace name, used only to make the public URL
    // pretty (/f/<workspace-name>/<slug>). Cosmetic — routing always keys off `slug`.
    workspaceSlug: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    fields: { type: [fieldSchema], default: undefined }, // falls back to defaults when empty
    submitCount: { type: Number, default: 0 } // how many submissions (handy stat)
  },
  { timestamps: true }
);

portalFormSchema.index({ locationId: 1, createdAt: 1 });

module.exports = mongoose.model('PortalForm', portalFormSchema);
