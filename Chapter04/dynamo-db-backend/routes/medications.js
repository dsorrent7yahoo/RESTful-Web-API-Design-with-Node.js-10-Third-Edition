const express = require('express');
const router = express.Router();
const multer = require('multer');
const medications = require('../modules/medications');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

router.get('/', function(request, response, next) {
  console.log('GET /medications', {
    topN: request.query.topN,
    limit: request.query.limit,
    id: request.query.id,
    patientId: request.query.patientId,
    medicationId: request.query.medicationId,
    startKey: request.query.startKey
  });
  medications.findAllMedications(request, response);
});

router.get('/id/:id', function(request, response, next) {
  console.log('GET /medications/id/:id', { id: request.params.id });
  medications.findMedicationById(request.params.id, response);
});

router.get('/patient/:patient', function(request, response, next) {
  console.log('GET /medications/patient/:patient', { patient: request.params.patient });
  medications.findMedicationsByPatient(request.params.patient, response);
});

router.get('/code/:code', function(request, response, next) {
  console.log('GET /medications/code/:code', { code: request.params.code });
  medications.findMedicationsByCode(request.params.code, response);
});

router.get('/medication/:medicationId', function(request, response, next) {
  console.log('GET /medications/medication/:medicationId', { medicationId: request.params.medicationId });
  medications.findMedicationsByMedicationId(request.params.medicationId, response);
});

router.get('/patients/multiple-medications', function(request, response, next) {
  console.log('GET /medications/patients/multiple-medications', { topN: request.query.topN });
  medications.findPatientsWithMultipleMedications(request, response);
});

router.post('/', function(request, response, next) {
  console.log('POST /medications', {
    id: request.body && request.body.id,
    patient: request.body && request.body.patient,
    code: request.body && request.body.code
  });
  medications.saveMedication(request, response);
});

router.put('/:id', function(request, response, next) {
  console.log('PUT /medications/:id', { id: request.params.id });
  medications.updateMedication(request, response);
});

router.delete('/:id', function(request, response, next) {
  console.log('DELETE /medications/:id', { id: request.params.id });
  medications.removeMedication(request, response);
});

router.post('/upload', upload.single('csvFile'), function(request, response, next) {
  if (!request.body) {
    request.body = {};
  }

  if (request.file && request.file.buffer && !request.body.csvContent) {
    request.body.csvContent = request.file.buffer.toString('utf8');
    request.body.fileName = request.file.originalname;
  }

  if (typeof request.body.replaceExistingTable === 'string') {
    request.body.replaceExistingTable = request.body.replaceExistingTable.toLowerCase() === 'true';
  }

  console.log('POST /medications/upload', {
    csvPath: request.body && request.body.csvPath ? request.body.csvPath : '(default CSV path)',
    fileName: request.body && request.body.fileName ? request.body.fileName : '(none)',
    tableName: request.body && request.body.tableName ? request.body.tableName : '(default table)',
    replaceExistingTable: Boolean(request.body && request.body.replaceExistingTable)
  });
  medications.uploadToDynamo(request, response);
});

module.exports = router;
