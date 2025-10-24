// server/routes/reportRoutes.js
import express from "express";
import {
  getWeeklyReport,
  getWeeklyReportPDF,
} from "../controllers/reportController.js";

const router = express.Router();

// Regular report data
router.get("/weekly", getWeeklyReport);
router.post("/weekly", getWeeklyReport);

// PDF export
router.get("/weekly/pdf", getWeeklyReportPDF);

export default router;
