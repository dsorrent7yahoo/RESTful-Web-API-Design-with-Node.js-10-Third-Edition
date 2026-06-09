var mongoose = require('mongoose');
var Schema = mongoose.Schema;

mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost/medications');

/*
  Schema mirrors the CSV columns in coherent-11-07-2022/csv/medications.csv:
  START, STOP, PATIENT, PAYER, ENCOUNTER, CODE, DESCRIPTION,
  BASE_COST, PAYER_COVERAGE, DISPENSES, TOTALCOST, REASONCODE, REASONDESCRIPTION
*/
var medicationSchema = new Schema({
  start:             { type: Date },
  stop:              { type: Date },
  patient:           { type: String, index: true },
  payer:             { type: String },
  encounter:         { type: String },
  code:              { type: String, index: true },
  description:       { type: String },
  baseCost:          { type: Number },
  payerCoverage:     { type: Number },
  dispenses:         { type: Number },
  totalCost:         { type: Number },
  reasonCode:        { type: String },
  reasonDescription: { type: String }
});

var Medication = mongoose.model('Medication', medicationSchema);

module.exports = { Medication: Medication };
