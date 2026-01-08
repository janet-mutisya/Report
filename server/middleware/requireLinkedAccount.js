// server/middleware/requireLinkedAccount.js

/**
 * Middleware to ensure user has a linked account
 * Must be used AFTER requireAuth middleware
 * 
 * Usage:
 * router.get("/dashboard", requireAuth, requireLinkedAccount, (req, res) => {
 *   // User is authenticated AND has linked account
 *   const accountNumber = req.user.apiClientAccount;
 * });
 */
export function requireLinkedAccount(req, res, next) {
  // Ensure requireAuth was called first
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required. Please login first.",
      errorType: "NO_AUTH"
    });
  }

  // Check if user has an account number linked
  if (!req.user.apiClientAccount) {
    return res.status(403).json({
      success: false,
      message: "Account setup in progress. Please check back later or contact support.",
      errorType: "NO_ACCOUNT_LINKED",
      status: req.user.status,
      canRetry: req.user.status === "pending_link"
    });
  }

  // Check if user is active
  if (req.user.status !== "active") {
    return res.status(403).json({
      success: false,
      message: "Account is not active. Please contact support.",
      errorType: "ACCOUNT_INACTIVE",
      status: req.user.status
    });
  }

  // All checks passed
  next();
}

/**
 * Optional: Middleware to allow pending accounts (for status checks, etc.)
 * 
 * Usage:
 * router.get("/status", requireAuth, allowPending, (req, res) => {
 *   // Works for both active and pending accounts
 * });
 */
export function allowPending(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      errorType: "NO_AUTH"
    });
  }

  // Allow both active and pending_link statuses
  if (req.user.status !== "active" && req.user.status !== "pending_link") {
    return res.status(403).json({
      success: false,
      message: "Account is not accessible",
      errorType: "ACCOUNT_INACCESSIBLE",
      status: req.user.status
    });
  }

  next();
}