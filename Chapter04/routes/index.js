var express = require("express");
var router = express.Router();

/* GET home page - redirect to login */
router.get("/", function (req, res, next) {
  res.redirect("/login");
});

module.exports = router;
