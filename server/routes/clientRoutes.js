// server/routes/clientRoutes.js
const express = require("express");
const clientController = require("../controllers/clientController.js");

const router = express.Router();

// ✅ GET all clients
router.get("/", clientController.getClients);

module.exports = router;