var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var mongoUrl = process.env.MONGO_URL || 'mongodb://localhost/catalog';
var connectPromise = null;

function ensureConnected() {
    if (mongoose.connection.readyState === 1) {
        return Promise.resolve(mongoose.connection);
    }

    if (mongoose.connection.readyState === 2 && connectPromise) {
        return connectPromise;
    }

    connectPromise = mongoose.connect(mongoUrl)
        .then(function(connection) {
            return connection;
        })
        .catch(function(error) {
            connectPromise = null;
            throw error;
        });

    return connectPromise;
}

var itemSchema = new Schema ({
    "itemId" : {type: String, index: {unique: true}},
    "itemName": String,
    "price": Number,
    "currency" : String,
    "categories": [String]
});

var CatalogItem = mongoose.models.Item || mongoose.model('Item', itemSchema);

module.exports = {
    CatalogItem : CatalogItem,
    ensureConnected: ensureConnected
};
