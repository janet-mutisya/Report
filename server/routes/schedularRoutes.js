import express from "express";
import {
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  upsertSchedule, // 🟣 Add this
} from "../controllers/schedulerController.js";

const router = express.Router();

router.get("/", getAllSchedules);
router.get("/:id", getScheduleById);
router.post("/", createSchedule);
router.put("/:id", updateSchedule);

// 🟣 New UPSERT endpoint
router.post("/upsert", upsertSchedule);

export default router;
