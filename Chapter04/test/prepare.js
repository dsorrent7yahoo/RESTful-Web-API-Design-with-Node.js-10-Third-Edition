var mongoose = require('mongoose');

var DB_URL = process.env.MONGO_URL || 'mongodb://localhost/catalog';

var itemSchema = new mongoose.Schema({
	itemId: { type: String, index: { unique: true } },
	itemName: String,
	price: Number,
	currency: String,
	categories: [String]
});

var CatalogItem = mongoose.models.Item || mongoose.model('Item', itemSchema);

var seedItems = [
	{ itemId: '1', itemName: 'Sports Watch', price: 100, currency: 'EUR', categories: ['Watches', 'Sports Watches'] },
	{ itemId: '2', itemName: 'Classic Watch', price: 140, currency: 'EUR', categories: ['Watches', 'Classic'] },
	{ itemId: '3', itemName: 'Running Shoes', price: 85, currency: 'USD', categories: ['Shoes', 'Sports'] },
	{ itemId: '4', itemName: 'Bluetooth Headphones', price: 120, currency: 'USD', categories: ['Electronics', 'Audio'] },
	{ itemId: '5', itemName: 'Yoga Mat', price: 35, currency: 'USD', categories: ['Fitness', 'Accessories'] },
	{ itemId: '6', itemName: 'Travel Backpack', price: 95, currency: 'EUR', categories: ['Bags', 'Travel'] },
	{ itemId: '7', itemName: 'Smartphone Stand', price: 18, currency: 'USD', categories: ['Accessories', 'Mobile'] },
	{ itemId: '8', itemName: 'Water Bottle', price: 22, currency: 'USD', categories: ['Fitness', 'Outdoor'] },
	{ itemId: '9', itemName: 'Desk Lamp', price: 48, currency: 'EUR', categories: ['Home', 'Lighting'] },
	{ itemId: '10', itemName: 'Mechanical Keyboard', price: 160, currency: 'USD', categories: ['Electronics', 'Computer'] }
];

async function connect() {
	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(DB_URL);
	}
}

async function clearDatabase() {
	var collections = mongoose.connection.collections;
	for (var key in collections) {
		await collections[key].deleteMany({});
	}
}

async function seedCatalog() {
	await connect();
	await CatalogItem.deleteMany({});
	await CatalogItem.insertMany(seedItems);
}

async function getAllItems() {
	await connect();
	return CatalogItem.find({}).sort({ itemId: 1 }).lean();
}

if (typeof beforeEach === 'function') {
	beforeEach(function(done) {
		connect()
			.then(clearDatabase)
			.then(function() { done(); })
			.catch(done);
	});

	afterEach(function(done) {
		mongoose.disconnect()
			.then(function() { done(); })
			.catch(done);
	});
}

if (require.main === module) {
	seedCatalog()
		.then(function() {
			return getAllItems();
		})
		.then(function(items) {
			console.log('Catalog seeded successfully. Items in catalog:');
			console.log(JSON.stringify(items, null, 2));
			return mongoose.disconnect();
		})
		.then(function() {
			process.exit(0);
		})
		.catch(function(error) {
			console.error('Seed failed:', error.message);
			process.exit(1);
		});
}

module.exports = {
	connect: connect,
	clearDatabase: clearDatabase,
	seedCatalog: seedCatalog,
	getAllItems: getAllItems
};
