// server/middleware/requireAdmin.js
const jwt = require("jsonwebtoken");

/**
 * Middleware to check if user is an admin
 * Must be used AFTER requireAuth middleware
 */
function requireAdmin(req, res, next) {
  try {
    // Check if user exists (set by requireAuth)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        errorType: "NO_AUTH"
      });
    }

    // Check if user has admin role
    if (req.user.role !== "admin") {
      console.log(`[Admin] Access denied for user: ${req.user.email} (role: ${req.user.role})`);
      return res.status(403).json({
        success: false,
        message: "Admin access required",
        errorType: "INSUFFICIENT_PERMISSIONS"
      });
    }

    console.log(`[Admin] Access granted for admin: ${req.user.email}`);
    next();

  } catch (error) {
    console.error("[Admin] Middleware error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      errorType: "SERVER_ERROR"
    });
  }
}

/**
 * Helper function to create admin JWT token
 * Use this when creating admin accounts
 */
function createAdminToken(adminData) {
  return jwt.sign(
    {
      userId: adminData.id,
      email: adminData.email,
      role: "admin",
      status: "active"
    },
    process.env.JWT_SECRET || "change-this-secret-in-production",
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

/**
 * List of admin emails (can be moved to database later)
 * For now, hardcode admin emails here
 */
const ADMIN_EMAILS = [
  "admin@bmsecurity.com",
  "support@bmsecurity.com",
  // Add more admin emails as needed
];

/**
 * Check if an email is an admin
 */
function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// Export functions
module.exports = {
  requireAdmin,
  createAdminToken,
  isAdminEmail
};