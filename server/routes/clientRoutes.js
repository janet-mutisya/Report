// server/routes/clientRoutes.js
import express from "express";
import { getClients } from "../controllers/clientController.js";

const router = express.Router();

// ✅ GET all clients
router.get("/", getClients);

export default router;
