var mongoose = require('mongoose');
var should = require('should');
var prepare = require('./prepare');

const model = require('../model/item.js');
const CatalogItem = model.CatalogItem;

describe('CatalogItem: models', function () {
  describe('#create()', function () {
    it('Should create a new CatalogItem', async function () {
      var item = {
        "itemId": "1",
        "itemName": "Sports Watch",
        "price": 100,
        "currency": "EUR",
        "categories": [
          "Watches",
          "Sports Watches"
        ]
      };

      const createdItem = await CatalogItem.create(item);
      should.exist(createdItem);
      createdItem.itemId.should.equal('1');
      createdItem.itemName.should.equal('Sports Watch');
      createdItem.price.should.equal(100);
      createdItem.currency.should.equal('EUR');
      createdItem.categories[0].should.equal('Watches');
      createdItem.categories[1].should.equal('Sports Watches');
    });
  });
});
