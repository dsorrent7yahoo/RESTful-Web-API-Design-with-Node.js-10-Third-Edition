const model = require('../model/item.js');
const CatalogItem = model.CatalogItem;
const contentTypeJson = {  //object
    'Content-Type' : 'application/json'
};
const contentTypePlainText = {
    'ContentType' : 'text/plain'
};

exports.findallItems = async function(response) {
    try {
        const result = await CatalogItem.find({});
        if(result != null) {
            response.json(result);
        } else {
            response.json(result);
        }
    } catch (error) {
        console.error(error);
        response.writeHead(500, contentTypePlainText);
        response.end('Internal Server Error');
    }
};

exports.findItemsByCategory = async function(category, response) {
    try { 
        const result = await CatalogItem.find({categories: category});
        if (!result) {
            if (response != null) {
                response.writeHead(404, contentTypePlainText);
                response.end('Not Found');
            }
            return;
        }
        //got a result
        if (response != null) {
            response.setHeader('Content-Type', 'application/json');
            response.send(result);
        }
    }catch (error) {  //catch (error)
		console.error(error);
		response.writeHead(500, contentTypePlainText);
	}
};