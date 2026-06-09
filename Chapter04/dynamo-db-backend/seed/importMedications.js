const medications = require('../modules/medications');

async function run() {
  const result = await medications.importCsvToDynamo(process.env.CSV_PATH);
  console.log(`Inserted ${result.imported} records from ${result.csvPath}`);

  console.log('Seed complete');
}

run().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
