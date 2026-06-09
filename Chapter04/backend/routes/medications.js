const express = require('express');
const router = express.Router();
const medications = require('../modules/medications');

// GET all medications (supports ?limit=50&skip=0)
router.get('/', function(request, response, next) {
  console.log('medications.findAllMedications');
  medications.findAllMedications(request, response);
});

// GET by MongoDB _id
router.get('/id/:id', function(request, response, next) {
  console.log('GET /medications/id/' + request.params.id);
  medications.findMedicationById(request.params.id, response);
});

// GET by patient UUID
router.get('/patient/:patient', function(request, response, next) {
  console.log('GET /medications/patient/' + request.params.patient);
  medications.findMedicationsByPatient(request.params.patient, response);
});

// GET by medication code
router.get('/code/:code', function(request, response, next) {
  console.log('GET /medications/code/' + request.params.code);
  medications.findMedicationsByCode(request.params.code, response);
});

// POST create new medication
router.post('/', function(request, response, next) {
  console.log('POST /medications');
  medications.saveMedication(request, response);
});

// PUT update medication by _id
router.put('/:id', function(request, response, next) {
  console.log('PUT /medications/' + request.params.id);
  medications.updateMedication(request, response);
});

// DELETE medication by _id
router.delete('/:id', function(request, response, next) {
  console.log('DELETE /medications/' + request.params.id);
  medications.removeMedication(request, response);
});

module.exports = router;
