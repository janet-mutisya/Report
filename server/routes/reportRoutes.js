import express from 'express';
import { getWeeklyReport } from '../controllers/reportController.js';

const router = express.Router();

// Support both GET and POST
router.get('/weekly', getWeeklyReport);
router.post('/weekly', getWeeklyReport);

export default router;
