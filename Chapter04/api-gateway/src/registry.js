/**
 * Service Registry
 * Single source of truth for every backend, frontend, and microservice.
 * Each entry describes how the gateway routes to and monitors the service.
 */

const SERVICES = {
  // ── Django React UI ────────────────────────────────────────────────────────
  'django-react': {
    label:       'Django React UI',
    icon:        '⚛️',
    category:    'frontend',
    target:      process.env.DJANGO_REACT_URL || 'http://localhost:3003',
    healthPath:  '/',
    description: 'React 18 · Vite — functional test client for Django REST Framework',
    launchUrl:   'http://localhost:3003',
  },

  // ── API Backends ────────────────────────────────────────────────────────────
  django: {
    label:       'Django REST Framework',
    icon:        '🎸',
    category:    'backend',
    target:      process.env.DJANGO_URL       || 'http://localhost:4002',
    healthPath:  '/health',
    description: 'Python · Django REST Framework · DynamoDB · Microservices-ready',
    swaggerPath: '/api-docs',
    launchUrl:   'http://localhost:4002/api-docs',
  },
  flask: {
    label:       'Flask + DynamoDB',
    icon:        '🐍',
    category:    'backend',
    target:      process.env.FLASK_URL        || 'http://localhost:4001',
    healthPath:  '/health',
    description: 'Python · Flask 3 · DynamoDB · S3 export · Glue catalog',
    swaggerPath: '/api-docs',
    launchUrl:   'http://localhost:4001/api-docs',
  },
  node: {
    label:       'Node.js Express',
    icon:        '🟩',
    category:    'backend',
    target:      process.env.NODE_URL         || 'http://localhost:4003',
    healthPath:  '/health',
    description: 'JavaScript · Express.js · DynamoDB · JWT authentication',
    swaggerPath: '/api-docs',
    launchUrl:   'http://localhost:4003/api-docs',
  },
  springboot: {
    label:       'Spring Boot 3',
    icon:        '🍃',
    category:    'backend',
    target:      process.env.SPRINGBOOT_URL   || 'http://localhost:4004',
    healthPath:  '/health',
    description: 'Java · Spring Boot 3 · DynamoDB · Bedrock AI SQL',
    swaggerPath: '/swagger-ui.html',
    launchUrl:   'http://localhost:4004/swagger-ui.html',
  },

  // ── Frontends ────────────────────────────────────────────────────────────────
  'django-ui': {
    label:       'Django TypeScript UI',
    icon:        '💙',
    category:    'frontend',
    target:      process.env.DJANGO_UI_URL    || 'http://localhost:5175',
    healthPath:  '/',
    description: 'React 18 · TypeScript · Vite — drives the Django backend',
    launchUrl:   'http://localhost:5175',
  },
  'flask-ui': {
    label:       'Flask React UI',
    icon:        '🐍',
    category:    'frontend',
    target:      process.env.FLASK_UI_URL     || 'http://localhost:4001',
    healthPath:  '/',
    description: 'React 18 · Vite — bundled with Flask backend on port 4001',
    launchUrl:   'http://localhost:4001',
  },
  'node-ui': {
    label:       'Node.js React UI',
    icon:        '🟩',
    category:    'frontend',
    target:      process.env.NODE_UI_URL      || 'http://localhost:3002',
    healthPath:  '/',
    description: 'React 18 · Vite — drives the Node.js Express backend',
    launchUrl:   'http://localhost:3002',
  },
  'springboot-ui': {
    label:       'Spring Boot React UI',
    icon:        '🍃',
    category:    'frontend',
    target:      process.env.SPRINGBOOT_UI_URL || 'http://localhost:5181',
    healthPath:  '/',
    description: 'React 18 · TypeScript — drives the Spring Boot backend',
    launchUrl:   'http://localhost:5181',
  },

  // ── Microservices ────────────────────────────────────────────────────────────
  glue: {
    label:       'Glue Catalog Service',
    icon:        '🗄️',
    category:    'microservice',
    target:      process.env.GLUE_URL         || 'http://localhost:4010',
    healthPath:  '/health',
    description: 'Uploads CSVs to S3 and registers tables in AWS Glue Catalog',
  },
  claims: {
    label:       'Claims Generator',
    icon:        '🏥',
    category:    'microservice',
    target:      process.env.CLAIMS_URL       || 'http://localhost:4011',
    healthPath:  '/health',
    description: 'Generates synthetic FHIR claims CSV files in S3',
  },
  cleaner: {
    label:       'Claims Cleaner',
    icon:        '🧹',
    category:    'microservice',
    target:      process.env.CLEANER_URL      || 'http://localhost:4012',
    healthPath:  '/health',
    description: 'Cleans claims CSVs and registers Parquet in Glue Catalog',
  },
  sqs: {
    label:       'SQS Monitor',
    icon:        '📬',
    category:    'microservice',
    target:      process.env.SQS_URL          || 'http://localhost:4013',
    healthPath:  '/health',
    description: 'Monitors SQS queue — messages, DLQ, and email notifications',
  },
  athena: {
    label:       'Athena Client',
    icon:        '🗄',
    category:    'microservice',
    target:      process.env.ATHENA_URL       || 'http://localhost:4014',
    healthPath:  '/health',
    description: 'Amazon Athena SQL query client with AI SQL generation',
  },
  patients: {
    label:       'Patients & Encounters',
    icon:        '🧬',
    category:    'microservice',
    target:      process.env.PATIENTS_URL     || 'http://localhost:4015',
    healthPath:  '/health',
    description: 'Generates synthetic FHIR patient and encounter records',
  },
};

module.exports = { SERVICES };
