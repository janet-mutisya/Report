// server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

// Import your existing routes
import reportRoutes from './routes/reportRoutes.js';
import clientRoutes from './routes/clientRoutes.js';
import dataSyncRoutes from './routes/dataSyncRoutes.js';
import backupSyncRoutes from './routes/backupSyncRoute.js';

// Import the weekly report scheduler (this starts the cron job automatically)
import './service/scheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

//  Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/reports', reportRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/sync', dataSyncRoutes);
app.use('/api/backup', backupSyncRoutes);

//  Root endpoint
app.get('/', (req, res) => {
  res.send('📊 Guard Report API is running, and the scheduler is active.');
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 API: http://localhost:${PORT}`);
  console.log('⏰ Scheduler loaded from service/scheduler.js and waiting for its cron trigger.');
});
