import express from "express";
import { triggerSchedulerNow, sendTestEmail } from "../controllers/testScheduler.js";

const router = express.Router();

// Manually run the scheduler
router.get("/run-now", triggerSchedulerNow);

// Send test email only
router.get("/email-test", sendTestEmail);

export default router;
