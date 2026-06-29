const mongoose = require('mongoose');

/**
 * Maps an agency companyId → its locationIds, so we can resolve which company owns a location
 * when only a location-scoped request comes in (needed to mint a location token from a company token).
 */
const companyLocationSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, unique: true, index: true },
    locationIds: { type: [String], default: [] }
  },
  { timestamps: true }
);

companyLocationSchema.statics.findCompanyByLocation = function findCompanyByLocation(locationId) {
  return this.findOne({ locationIds: locationId });
};

module.exports = mongoose.model('CompanyLocation', companyLocationSchema);
