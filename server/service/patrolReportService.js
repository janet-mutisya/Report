// server/service/patrolReportService.js - FIXED: Correct validation logic
import bmSecurityAPI from "./bmSecurityAPI.js";

/**
 * 📊 Fetches patrol report for a specific client account
 * This is the ONLY function dashboards and emails should call
 */
export async function getClientPatrolReport({
  apiClientAccount,
  startDate,
  endDate
}) {
  // Validate input
  if (!apiClientAccount) {
    throw new Error("Client account number is required");
  }

  if (!startDate || !endDate) {
    throw new Error("Start date and end date are required");
  }

  // Call the existing BM Security API
  try {
    console.log(`📊 [PatrolReportService] Fetching patrol report for ${apiClientAccount}`);
    console.log(`   Date range: ${startDate} to ${endDate}`);

    const result = await bmSecurityAPI.getPatrolEvents(
      apiClientAccount,
      startDate,
      endDate
    );

    if (!result.success) {
      throw new Error("Failed to fetch patrol events from BM Security API");
    }

    const events = result.data || [];

    return {
      success: true,
      accountNumber: apiClientAccount,
      startDate,
      endDate,
      data: events,
      summary: {
        totalEvents: events.length,
        dateRange: `${startDate} to ${endDate}`,
        daysCovered: result.daysCovered,
        daysRequested: result.daysRequested,
        hasCompleteCoverage: result.hasCompleteCoverage
      }
    };
  } catch (error) {
    console.error(`❌ [PatrolReportService] Error fetching data for ${apiClientAccount}:`, error);
    throw new Error(`Failed to fetch patrol report: ${error.message}`);
  }
}

/**
 * ✅ FIXED: Validates client credentials directly with BM Security API
 * 🔴 FIX #2: Use getAccountByNumber() instead of getPatrolEvents()
 * 📍 Validation = identity, not patrol data
 */
export async function validateClientCredentials(email, accountNumber) {
  if (!email || !accountNumber) {
    return { 
      valid: false, 
      error: "Email and account number required" 
    };
  }

  try {
    console.log(`🔍 [PatrolReportService] Validating credentials for ${accountNumber}`);

    // ✅ CORRECT: Use getAccountByNumber() to validate account existence
    // This checks identity, not patrol data
    const result = await bmSecurityAPI.getAccountByNumber(accountNumber);

    if (!result?.success) {
      console.log(`❌ [PatrolReportService] Account ${accountNumber} not found`);
      return { 
        valid: false, 
        error: "Account not found" 
      };
    }

    console.log(`✅ [PatrolReportService] Account ${accountNumber} validated successfully`);

    return {
      valid: true,
      accountNumber,
      email,
      accountDetails: result.account // Optional: include account info
    };

  } catch (error) {
    console.error(`❌ [PatrolReportService] Validation failed for ${accountNumber}:`, error);
    return {
      valid: false,
      error: "BM Security validation failed"
    };
  }
}

/**
 * 🔍 Helper: Get account details
 * Useful for displaying client information in dashboards
 */
export async function getAccountDetails(accountNumber) {
  if (!accountNumber) {
    throw new Error("Account number is required");
  }

  try {
    const result = await bmSecurityAPI.getAccountByNumber(accountNumber);

    if (!result?.success) {
      throw new Error("Account not found");
    }

    return {
      success: true,
      account: result.account,
      accountUsed: result.accountUsed
    };

  } catch (error) {
    console.error(`❌ [PatrolReportService] Error fetching account details:`, error);
    throw new Error(`Failed to get account details: ${error.message}`);
  }
}

/**
 * 🧪 Test the patrol report service
 */
export async function testPatrolReportService(accountNumber) {
  try {
    console.log(`🧪 [PatrolReportService] Testing with account ${accountNumber}`);

    // Test validation
    const validation = await validateClientCredentials("test@example.com", accountNumber);
    console.log("  Validation result:", validation);

    if (!validation.valid) {
      return {
        success: false,
        error: "Account validation failed"
      };
    }

    // Test patrol report fetch
    const today = new Date().toISOString().split('T')[0];
    const report = await getClientPatrolReport({
      apiClientAccount: accountNumber,
      startDate: today,
      endDate: today
    });

    console.log(`  Report summary:`, report.summary);

    return {
      success: true,
      validation,
      report: report.summary
    };

  } catch (error) {
    console.error(`❌ [PatrolReportService] Test failed:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}