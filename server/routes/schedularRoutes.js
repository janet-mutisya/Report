import express from "express";
import {
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  createSchedule,
  upsertSchedule,
  deleteSchedule
} from "../controllers/schedulerController.js";

const router = express.Router();

// GET all schedules
router.get("/", getAllSchedules);

// GET schedule by ID
router.get("/:id", getScheduleById);

// CREATE new schedule
router.post("/", createSchedule);

// UPDATE existing schedule
router.put("/:id", updateSchedule);

// DELETE schedule
router.delete("/:id", deleteSchedule);

// UPSERT schedule (update if exists, insert if not)
router.post("/upsert", upsertSchedule);

export default router;