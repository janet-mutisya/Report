const express = require("express");
const { triggerSchedulerNow, sendTestEmail } = require("../controllers/testScheduler.js");

const router = express.Router();

// Manually run the scheduler
router.get("/run-now", triggerSchedulerNow);

// Send test email only
router.get("/email-test", sendTestEmail);

module.exports = router;