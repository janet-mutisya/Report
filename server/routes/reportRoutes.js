// server/routes/reportRoutes.js
import express from "express";
import {
  getPatrolReport,
  getWeeklyReportPDF,
  getClientShifts,
  testReportGeneration,
} from "../controllers/reportController.js";

const router = express.Router();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 PATROL REPORT ENDPOINTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET/POST /api/reports/patrol
 * 
 * Get patrol report data with automatic schedule integration
 * 
 * Query/Body Parameters:
 * - client (string, required): Client name or ID
 * - startDateTime (string, required): Start date (YYYY-MM-DD)
 * - endDateTime (string, required): End date (YYYY-MM-DD)
 * - shiftType (string, optional): "Day", "Night", or "Day/Night" (default)
 * 
 * Response includes:
 * - Patrol summary data
 * - Event logs
 * - Schedule configuration (automatic)
 * - Expected vs actual patrol calculations
 * 
 * Example:
 * GET /api/reports/patrol?client=ACME&startDateTime=2025-01-01&endDateTime=2025-01-07
 * POST /api/reports/patrol
 * {
 *   "client": "ACME",
 *   "startDateTime": "2025-01-01",
 *   "endDateTime": "2025-01-07",
 *   "shiftType": "Day"
 * }
 */
router.get("/patrol", getPatrolReport);
router.post("/patrol", getPatrolReport);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📄 PDF EXPORT ENDPOINT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/reports/patrol/pdf
 * 
 * Generate and download PDF report with schedule-aware metrics
 * 
 * Query Parameters:
 * - client (string, required): Client name or ID
 * - startDateTime (string, required): Start date (YYYY-MM-DD)
 * - endDateTime (string, required): End date (YYYY-MM-DD)
 * - shiftType (string, optional): "Day", "Night", or "Day/Night" (default)
 * 
 * Returns: PDF file download
 * 
 * Example:
 * GET /api/reports/patrol/pdf?client=ACME&startDateTime=2025-01-01&endDateTime=2025-01-07&shiftType=Day
 */
router.get("/patrol/pdf", getWeeklyReportPDF);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔄 CLIENT CONFIGURATION ENDPOINTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/reports/client/shifts
 * GET /api/reports/client/shifts/:client
 * 
 * Get available shifts and schedule configuration for a client
 * 
 * Parameters:
 * - client (string, required): Client name or ID (query param or route param)
 * 
 * Response includes:
 * - Available shift options
 * - Configured shift (if any)
 * - Full schedule details
 * - Default shift selection
 * 
 * Example:
 * GET /api/reports/client/shifts?client=ACME
 * GET /api/reports/client/shifts/ACME
 */
router.get("/client/shifts", getClientShifts);
router.get("/client/shifts/:client", getClientShifts);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🧪 TESTING & DIAGNOSTICS ENDPOINT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /api/reports/test/:clientId
 * 
 * Test report generation and schedule integration for a specific client
 * 
 * Route Parameters:
 * - clientId (number, required): Client ID
 * 
 * Body Parameters (all optional):
 * - startDate (string): Start date (defaults to 7 days ago)
 * - endDate (string): End date (defaults to today)
 * - shiftType (string): Shift type to test (defaults to schedule or "Day/Night")
 * 
 * Response includes:
 * - Client details
 * - Schedule configuration status
 * - Data fetch test results
 * - PDF generation test results
 * - Automatic recommendations
 * 
 * Example:
 * POST /api/reports/test/123
 * {
 *   "startDate": "2025-01-01",
 *   "endDate": "2025-01-07",
 *   "shiftType": "Day"
 * }
 */
router.post("/test/:clientId", testReportGeneration);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔄 BACKWARD COMPATIBILITY ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Legacy routes for backward compatibility
 * These will be deprecated in future versions
 */
router.get("/weekly", getPatrolReport);
router.post("/weekly", getPatrolReport);
router.get("/weekly/pdf", getWeeklyReportPDF);
router.get("/shifts", getClientShifts);
router.get("/shifts/:client", getClientShifts);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📚 ROUTE DOCUMENTATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * ROUTE SUMMARY:
 * 
 * Primary Patrol Reports:
 *   GET/POST  /api/reports/patrol       - Get report data (recommended)
 *   GET       /api/reports/patrol/pdf   - Download PDF (recommended)
 * 
 * Client Configuration:
 *   GET       /api/reports/client/shifts       - Get shifts by query param
 *   GET       /api/reports/client/shifts/:id   - Get shifts by route param
 * 
 * Testing:
 *   POST      /api/reports/test/:id     - Test report generation
 * 
 * Legacy Routes (backward compatibility):
 *   GET/POST  /api/reports/weekly       - Get report data (legacy)
 *   GET       /api/reports/weekly/pdf   - Download PDF (legacy)
 *   GET       /api/reports/shifts       - Get shifts (legacy)
 *   GET       /api/reports/shifts/:id   - Get shifts (legacy)
 * 
 * All routes automatically integrate with patrol schedules configured via
 * managePatrolSchedules.js - no manual configuration needed!
 */

export default router;