const model = require('../model/item.js');
const CatalogItem = model.CatalogItem;
const ensureConnected = model.ensureConnected;
const contentTypeJson = {
	'Content-Type' : 'application/json'
};
const contentTypePlainText = {
	'Content-Type' : 'text/plain'
};

exports.findAllItems = async function(response) {
	try {
		await ensureConnected();
		const result = await CatalogItem.find({});
		if (result != null) {
			response.json(result);
		} else {
			response.json({});
		}
	} catch (error) {
		console.error(error);
		response.writeHead(500, contentTypePlainText);
		response.end('Internal Server Error');
	}
};


exports.findItemById = async function(itemId, response) {
	try {
		await ensureConnected();
		const result = await CatalogItem.findOne({itemId: itemId});
		if (!result) {
			if (response != null) {
				response.writeHead(404, contentTypePlainText);
				response.end('Not Found');
			}
			return;
		}

		if (response != null) {
			response.setHeader('Content-Type', 'application/json');
			response.send(result);
		}
		console.log(result);
	} catch (error) {
		console.error(error);
		response.writeHead(500, contentTypePlainText);
	}
};

exports.findItemsByCategory = async function(category, response) {
	try {
		await ensureConnected();
		const result = await CatalogItem.find({categories: category});
		if (!result) {
			if (response != null) {
				response.writeHead(404, contentTypePlainText);
				response.end('Not Found');
			}
			return;
		}

		if (response != null) {
			response.setHeader('Content-Type', 'application/json');
			response.send(result);
		}
		console.log(result);
	} catch (error) {
		console.error(error);
		response.writeHead(500, contentTypePlainText);
	}
};

exports.saveItem = async function(request, response) {
	var item = toItem(request.body);
	try {
		await ensureConnected();
		var existing = await CatalogItem.findOne({itemId: item.itemId});
		if (!existing) {
			await item.save();
			response.writeHead(201, contentTypeJson);
			response.end(JSON.stringify(request.body));
			return;
		}

		console.log('Updating existing item');
		existing.itemId = item.itemId;
		existing.itemName = item.itemName;
		existing.price = item.price;
		existing.currency = item.currency;
		existing.categories = item.categories;
		await existing.save();
		response.json(existing);
	} catch (error) {
		console.log(error);
		response.writeHead(500, contentTypePlainText);
		response.end('Internal Server Error');
	}
};

exports.remove = async function(request, response) {
	console.log('Deleting item with id: ' + request.params.itemId);
	try {
		await ensureConnected();
		var data = await CatalogItem.findOneAndDelete({itemId: request.params.itemId});
		if (!data) {
			console.log('Item not found');
			if (response != null) {
				response.writeHead(404, contentTypePlainText);
				response.end('Not Found');
			}
			return;
		}

		response.json({'Status': 'Successfully deleted'});
	} catch (error) {
		console.log(error);
		if (response != null) {
			response.writeHead(500, contentTypePlainText);
			response.end('Internal server error');
		}
	}
};

function toItem(body) {
	return new CatalogItem({
		itemId: body.itemId,
		itemName: body.itemName,
		price: body.price,
		currency: body.currency,
		categories: body.categories
	});
}
