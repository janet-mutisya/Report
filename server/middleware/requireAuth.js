// server/middleware/requireAuth.js
const jwt = require("jsonwebtoken");

/**
 * Middleware to protect routes requiring authentication
 * Attaches decoded user info to req.user
 * 
 * Usage:
 * router.get("/protected", requireAuth, (req, res) => {
 *   console.log(req.user.email);
 *   console.log(req.user.apiClientAccount);
 * });
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      errorType: "NO_TOKEN"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "change-this-secret-in-production"
    );

    // Attach user info to request object
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      apiClientAccount: decoded.apiClientAccount,
      companyName: decoded.companyName,
      status: decoded.status,
      role: decoded.role
    };

    next();

  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired, please login again",
        errorType: "TOKEN_EXPIRED"
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({
        success: false,
        message: "Invalid token",
        errorType: "INVALID_TOKEN"
      });
    }

    return res.status(403).json({
      success: false,
      message: "Authentication failed",
      errorType: "AUTH_ERROR"
    });
  }
}

/**
 * Optional: Middleware to check for specific roles
 * 
 * Usage:
 * router.get("/admin", requireAuth, requireRole("admin"), (req, res) => {
 *   // Only admins can access
 * });
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        errorType: "NO_USER"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        errorType: "INSUFFICIENT_PERMISSIONS",
        requiredRole: allowedRoles,
        currentRole: req.user.role
      });
    }

    next();
  };
}

// Export functions
module.exports = {
  requireAuth,
  requireRole
};