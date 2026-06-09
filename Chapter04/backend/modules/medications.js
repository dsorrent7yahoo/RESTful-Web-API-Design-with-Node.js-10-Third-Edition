const model = require('../model/medication');
const Medication = model.Medication;

const contentTypeJson = { 'Content-Type': 'application/json' };
const contentTypePlainText = { 'Content-Type': 'text/plain' };

// GET all medications (paginated)
exports.findAllMedications = async function(request, response) {
  try {
    const limit = parseInt(request.query.limit) || 50;
    const skip  = parseInt(request.query.skip)  || 0;
    const result = await Medication.find({}).skip(skip).limit(limit);
    response.json(result);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

// GET single medication by MongoDB _id
exports.findMedicationById = async function(id, response) {
  try {
    const result = await Medication.findById(id);
    if (!result) {
      response.writeHead(404, contentTypePlainText);
      response.end('Not Found');
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.send(result);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

// GET medications by patient UUID
exports.findMedicationsByPatient = async function(patient, response) {
  try {
    const result = await Medication.find({ patient: patient });
    response.json(result);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

// GET medications by medication code
exports.findMedicationsByCode = async function(code, response) {
  try {
    const result = await Medication.find({ code: code });
    response.json(result);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

// POST create new medication
exports.saveMedication = async function(request, response) {
  var medication = toMedication(request.body);
  try {
    await medication.save();
    response.writeHead(201, contentTypeJson);
    response.end(JSON.stringify(request.body));
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

// PUT update medication by _id
exports.updateMedication = async function(request, response) {
  try {
    const existing = await Medication.findById(request.params.id);
    if (!existing) {
      response.writeHead(404, contentTypePlainText);
      response.end('Not Found');
      return;
    }
    Object.assign(existing, toMedicationFields(request.body));
    await existing.save();
    response.json(existing);
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal Server Error');
  }
};

// DELETE medication by _id
exports.removeMedication = async function(request, response) {
  try {
    const data = await Medication.findByIdAndDelete(request.params.id);
    if (!data) {
      response.writeHead(404, contentTypePlainText);
      response.end('Not Found');
      return;
    }
    response.json({ Status: 'Successfully deleted' });
  } catch (error) {
    console.error(error);
    response.writeHead(500, contentTypePlainText);
    response.end('Internal server error');
  }
};

function toMedicationFields(body) {
  return {
    start:             body.start             ? new Date(body.start) : undefined,
    stop:              body.stop              ? new Date(body.stop)  : undefined,
    patient:           body.patient,
    payer:             body.payer,
    encounter:         body.encounter,
    code:              body.code,
    description:       body.description,
    baseCost:          body.baseCost          != null ? Number(body.baseCost)      : undefined,
    payerCoverage:     body.payerCoverage     != null ? Number(body.payerCoverage) : undefined,
    dispenses:         body.dispenses         != null ? Number(body.dispenses)     : undefined,
    totalCost:         body.totalCost         != null ? Number(body.totalCost)     : undefined,
    reasonCode:        body.reasonCode,
    reasonDescription: body.reasonDescription
  };
}

function toMedication(body) {
  return new Medication(toMedicationFields(body));
}
