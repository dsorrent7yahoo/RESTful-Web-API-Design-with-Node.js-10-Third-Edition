/*
  seed/importMedications.js
  -------------------------
  Reads coherent-11-07-2022/csv/medications.csv (relative to Chapter04 root),
  clears the medications collection, then bulk-inserts all rows.

  Usage (from Chapter04/backend):
    node seed/importMedications.js

  Or with a custom CSV path:
    CSV_PATH=../../coherent-11-07-2022/csv/medications.csv node seed/importMedications.js
*/

var fs        = require('fs');
var path      = require('path');
var mongoose  = require('mongoose');
var csvParse  = require('csv-parse');

var model     = require('../model/medication');
var Medication = model.Medication;

var MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost/medications';
var CSV_PATH  = process.env.CSV_PATH  ||
  path.join(__dirname, '..', '..', 'coherent-11-07-2022', 'csv', 'medications.csv');

var BATCH_SIZE = 500;

async function run() {
  console.log('Connecting to', MONGO_URL);
  await mongoose.connect(MONGO_URL);
  console.log('Connected. Clearing existing medications...');
  await Medication.deleteMany({});

  console.log('Reading CSV:', CSV_PATH);
  var records = [];
  var total   = 0;
  var batch   = [];

  await new Promise(function(resolve, reject) {
    fs.createReadStream(CSV_PATH)
      .pipe(csvParse.parse({ columns: true, trim: true, skip_empty_lines: true }))
      .on('data', async function(row) {
        batch.push({
          start:             row.START             ? new Date(row.START)  : null,
          stop:              row.STOP              ? new Date(row.STOP)   : null,
          patient:           row.PATIENT           || null,
          payer:             row.PAYER             || null,
          encounter:         row.ENCOUNTER         || null,
          code:              row.CODE              || null,
          description:       row.DESCRIPTION       || null,
          baseCost:          row.BASE_COST          != null && row.BASE_COST          !== '' ? parseFloat(row.BASE_COST)          : null,
          payerCoverage:     row.PAYER_COVERAGE     != null && row.PAYER_COVERAGE     !== '' ? parseFloat(row.PAYER_COVERAGE)     : null,
          dispenses:         row.DISPENSES          != null && row.DISPENSES          !== '' ? parseInt(row.DISPENSES)            : null,
          totalCost:         row.TOTALCOST          != null && row.TOTALCOST          !== '' ? parseFloat(row.TOTALCOST)          : null,
          reasonCode:        row.REASONCODE         || null,
          reasonDescription: row.REASONDESCRIPTION  || null
        });

        if (batch.length >= BATCH_SIZE) {
          var toInsert = batch.splice(0, BATCH_SIZE);
          try {
            await Medication.insertMany(toInsert, { ordered: false });
            total += toInsert.length;
            process.stdout.write('\rInserted ' + total + ' records...');
          } catch (err) {
            console.error('\nBatch insert error:', err.message);
          }
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  if (batch.length > 0) {
    try {
      await Medication.insertMany(batch, { ordered: false });
      total += batch.length;
    } catch (err) {
      console.error('\nFinal batch insert error:', err.message);
    }
  }

  console.log('\nDone. Total inserted:', total);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(function(err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
