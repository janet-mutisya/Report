// server/routes/clientRoutes.js
const express = require("express");
const clientController = require("../controllers/clientController.js");
const { auth, requireAny } = require('../middleware/auth.js');

const router = express.Router();

// ✅ GET all clients
router.get("/", auth, requireAny, clientController.getClients);

module.exports = router;