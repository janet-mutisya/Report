// server/routes/auth.js - FIXED: Role from database + Confidence-based account linking
const express = require("express");
const jwt = require("jsonwebtoken");
const clientStorage = require("../service/clientStorage.js");
const accountDiscovery = require("../service/accountDiscovery.js");
const { requireAuth } = require("../middleware/requireAuth.js"); // ✅ Fixed import

const router = express.Router();

/**
 * POST /api/auth/signup
 * Client registers with email + password + company name
 * System automatically tries to discover their account
 * 🔴 FIX #3: Only auto-link accounts with "very_high" or "high" confidence
 */
router.post("/signup", async (req, res) => {
  try {
    const { email, password, companyName } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    // Create client account (accountNumber = null initially)
    const createResult = await clientStorage.createClient({
      email,
      password,
      companyName
    });

    if (!createResult.success) {
      return res.status(400).json({
        success: false,
        message: createResult.error
      });
    }

    const client = createResult.client;

    // 🔥 AUTOMATIC ACCOUNT DISCOVERY
    console.log(`\n🎯 Starting auto-discovery for new user: ${email}`);
    
    const discoveryResult = await accountDiscovery.discoverAccountNumber(email, companyName);

    if (discoveryResult) {
      console.log(`✅ Account discovered: ${discoveryResult.accountNumber} (${discoveryResult.confidence} confidence)`);

      // Validate the discovered account
      const validationResult = await accountDiscovery.validateAccountNumber(discoveryResult.accountNumber);

      // 🔴 FIX #3: ENFORCE CONFIDENCE RULES
      // Only auto-link if confidence is "very_high" or "high"
      if (
        validationResult.valid &&
        ["very_high", "high"].includes(discoveryResult.confidence)
      ) {
        console.log(`✅ Confidence level acceptable (${discoveryResult.confidence}), proceeding with auto-link`);

        // Link account number to client
        const linkResult = await clientStorage.linkAccountNumber(
          client.id,
          validationResult.normalizedAccountNumber
        );

        if (linkResult.success) {
          console.log(`✅ Account linked automatically!\n`);

          // Get updated client with role
          const updatedClient = await clientStorage.getClientById(client.id);

          // Generate JWT with account number and role from database
          const token = jwt.sign(
            {
              userId: updatedClient.id,
              email: updatedClient.email,
              apiClientAccount: validationResult.normalizedAccountNumber,
              companyName: updatedClient.companyName,
              status: "active",
              role: updatedClient.role || "client"  // ✅ Read from database!
            },
            process.env.JWT_SECRET || "change-this-secret-in-production",
            { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
          );

          return res.status(201).json({
            success: true,
            message: "Account created and linked successfully!",
            token,
            user: {
              email: updatedClient.email,
              accountNumber: validationResult.normalizedAccountNumber,
              companyName: updatedClient.companyName,
              status: "active",
              role: updatedClient.role || "client"  // ✅ Include role in response
            },
            autoLinked: true,
            discoveryMethod: discoveryResult.method,
            confidence: discoveryResult.confidence
          });
        }
      } else if (validationResult.valid) {
        // Account found but confidence too low
        console.log(`⚠️  Confidence too low (${discoveryResult.confidence}), requires manual review\n`);
      } else {
        // Account validation failed
        console.log(`❌ Account validation failed\n`);
      }
    }

    // Discovery failed OR confidence too low - user stays in pending_link status
    console.log(`⚠️  Auto-discovery incomplete, user marked as pending\n`);

    const token = jwt.sign(
      {
        userId: client.id,
        email: client.email,
        apiClientAccount: null,
        companyName: client.companyName,
        status: "pending_link",
        role: client.role || "client"  // ✅ Read from database!
      },
      process.env.JWT_SECRET || "change-this-secret-in-production",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    res.status(201).json({
      success: true,
      message: "Account created! Setting up your dashboard...",
      token,
      user: {
        email: client.email,
        accountNumber: null,
        companyName: client.companyName,
        status: "pending_link",
        role: client.role || "client"  // ✅ Include role in response
      },
      autoLinked: false,
      pendingMessage: "We're setting up your account. You'll receive an email when ready."
    });

  } catch (error) {
    console.error("[Auth] Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during signup"
    });
  }
});

/**
 * POST /api/auth/login
 * Client logs in, system attempts discovery if still pending
 * 🔴 FIX #3: Only auto-link accounts with "very_high" or "high" confidence
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const validation = await clientStorage.validateClientLogin(email, password);

    if (!validation.valid) {
      return res.status(401).json({
        success: false,
        message: validation.error
      });
    }

    let client = validation.client;

    // 🔥 If account still pending, try discovery again
    if (client.status === "pending_link" && !client.accountNumber) {
      console.log(`\n🎯 Retrying auto-discovery for: ${email}`);

      const discoveryResult = await accountDiscovery.discoverAccountNumber(email, client.companyName);

      if (discoveryResult) {
        const validationResult = await accountDiscovery.validateAccountNumber(discoveryResult.accountNumber);

        // 🔴 FIX #3: ENFORCE CONFIDENCE RULES
        if (
          validationResult.valid &&
          ["very_high", "high"].includes(discoveryResult.confidence)
        ) {
          console.log(`✅ Confidence level acceptable (${discoveryResult.confidence}), linking account`);

          const linkResult = await clientStorage.linkAccountNumber(
            client.id,
            validationResult.normalizedAccountNumber
          );

          if (linkResult.success) {
            console.log(`✅ Account linked on login!\n`);
            client = linkResult.client;
          }
        } else if (validationResult.valid) {
          console.log(`⚠️  Confidence too low (${discoveryResult.confidence}), requires manual review\n`);
        }
      }
    }

    // Get fresh client data to ensure we have the latest role
    const freshClient = await clientStorage.getClientById(client.id);

    // Generate JWT with role from database
    const token = jwt.sign(
      {
        userId: freshClient.id,
        email: freshClient.email,
        apiClientAccount: freshClient.accountNumber,
        companyName: freshClient.companyName,
        status: freshClient.status,
        role: freshClient.role || "client"  // ✅ Read from database!
      },
      process.env.JWT_SECRET || "change-this-secret-in-production",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    res.json({
      success: true,
      token,
      user: {
        email: freshClient.email,
        accountNumber: freshClient.accountNumber,
        companyName: freshClient.companyName,
        status: freshClient.status,
        role: freshClient.role || "client"  // ✅ Include role in response
      }
    });

  } catch (error) {
    console.error("[Auth] Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error during login"
    });
  }
});

/**
 * POST /api/auth/verify
 * Verify JWT token
 */
router.post("/verify", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      valid: false,
      message: "No token provided"
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "change-this-secret-in-production"
    );

    res.json({
      valid: true,
      user: {
        email: decoded.email,
        accountNumber: decoded.apiClientAccount,
        companyName: decoded.companyName,
        status: decoded.status,
        role: decoded.role
      }
    });
  } catch (error) {
    res.status(401).json({
      valid: false,
      message: "Invalid or expired token"
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const client = await clientStorage.getClientById(req.user.userId);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user: client
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

/**
 * POST /api/auth/retry-discovery
 * Manually trigger account discovery retry
 * 🔴 FIX #3: Only auto-link accounts with "very_high" or "high" confidence
 */
router.post("/retry-discovery", requireAuth, async (req, res) => {
  try {
    const client = await clientStorage.getClientById(req.user.userId);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (client.status === "active" && client.accountNumber) {
      return res.json({
        success: true,
        message: "Account already linked",
        accountNumber: client.accountNumber
      });
    }

    console.log(`\n🎯 Manual discovery retry for: ${client.email}`);

    const discoveryResult = await accountDiscovery.discoverAccountNumber(client.email, client.companyName);

    if (!discoveryResult) {
      return res.json({
        success: false,
        message: "Unable to find matching account. Please contact support."
      });
    }

    const validationResult = await accountDiscovery.validateAccountNumber(discoveryResult.accountNumber);

    if (!validationResult.valid) {
      return res.json({
        success: false,
        message: "Found account but validation failed"
      });
    }

    // 🔴 FIX #3: ENFORCE CONFIDENCE RULES
    if (!["very_high", "high"].includes(discoveryResult.confidence)) {
      return res.json({
        success: false,
        message: `Account found but confidence level too low (${discoveryResult.confidence}). Please contact support for manual verification.`,
        requiresManualReview: true,
        discoveredAccount: discoveryResult.accountNumber,
        confidence: discoveryResult.confidence
      });
    }

    const linkResult = await clientStorage.linkAccountNumber(
      client.id,
      validationResult.normalizedAccountNumber
    );

    if (!linkResult.success) {
      return res.status(400).json({
        success: false,
        message: linkResult.error
      });
    }

    // Get updated client with role
    const updatedClient = await clientStorage.getClientById(client.id);

    // Generate new token with account number and role from database
    const token = jwt.sign(
      {
        userId: updatedClient.id,
        email: updatedClient.email,
        apiClientAccount: validationResult.normalizedAccountNumber,
        companyName: updatedClient.companyName,
        status: "active",
        role: updatedClient.role || "client"  // ✅ Read from database!
      },
      process.env.JWT_SECRET || "change-this-secret-in-production",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    res.json({
      success: true,
      message: "Account linked successfully!",
      token,
      user: linkResult.client,
      discoveryMethod: discoveryResult.method,
      confidence: discoveryResult.confidence
    });

  } catch (error) {
    console.error("[Auth] Retry discovery error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

/**
 * POST /api/auth/change-password
 * Change user password (requires authentication)
 */
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long"
      });
    }

    // Validate current password
    const validation = await clientStorage.validateClientLogin(req.user.email, currentPassword);

    if (!validation.valid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    // Update password
    // Note: This depends on your clientStorage implementation
    // You might need to add a method like clientStorage.updatePassword()
    const updateResult = await clientStorage.updatePassword(req.user.userId, newPassword);

    if (!updateResult.success) {
      return res.status(400).json({
        success: false,
        message: updateResult.error || "Failed to update password"
      });
    }

    res.json({
      success: true,
      message: "Password changed successfully"
    });

  } catch (error) {
    console.error("[Auth] Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal)
 */
router.post("/logout", (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully"
  });
});

module.exports = router;