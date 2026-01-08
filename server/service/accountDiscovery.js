// server/service/accountDiscovery.js
import bmSecurityAPI from "./bmSecurityAPI.js";

/**
 * 🚀 OPTIMIZED ACCOUNT DISCOVERY ENGINE
 * Key improvement: Fetch ALL accounts ONCE, then run all strategies in memory
 */

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 
  'live.com', 'aol.com', 'icloud.com', 'protonmail.com',
  'mail.com', 'zoho.com', 'yandex.com', 'gmx.com'
]);

function extractDomain(email) {
  const match = email.match(/@(.+)$/);
  return match ? match[1].toLowerCase() : null;
}

function isGenericDomain(domain) {
  return GENERIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

function normalizeCompanyName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ltd|limited|inc|incorporated|llc|corp|corporation|co\./gi, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function companyNamesMatch(name1, name2, threshold = 0.5) {
  const n1 = normalizeCompanyName(name1);
  const n2 = normalizeCompanyName(name2);

  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;

  const words1 = new Set(n1.split(" ").filter(w => w.length > 2));
  const words2 = new Set(n2.split(" ").filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return false;

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  const similarity = intersection.size / union.size;
  return similarity >= threshold;
}

function extractKeywords(companyName) {
  const normalized = normalizeCompanyName(companyName);
  return normalized
    .split(" ")
    .filter(word => word.length > 3)
    .filter(word => !['limited', 'company', 'services', 'group'].includes(word));
}

/**
 * 🔥 STRATEGY A: Direct Email Lookup
 */
function findByEmail(email, allAccounts) {
  const match = allAccounts.find(account => {
    const bmEmail = account.cue_correo || account.cue_cemail || account.email || "";
    return bmEmail.toLowerCase() === email.toLowerCase();
  });

  if (!match) return null;

  return {
    accountNumber: match.cue_ncuenta,
    confidence: "very_high",
    method: "direct_email",
    accountData: match
  };
}

/**
 * 🔥 STRATEGY B: Company Name Matching
 */
function findByCompanyName(companyName, allAccounts) {
  if (!companyName || companyName.trim().length < 3) return null;

  const matches = allAccounts.filter(account => {
    const bmCompanyName = account.cue_cnombre || account.cue_cempresa || "";
    return companyNamesMatch(companyName, bmCompanyName);
  });

  if (matches.length === 0) return null;

  if (matches.length === 1) {
    return {
      accountNumber: matches[0].cue_ncuenta,
      confidence: "high",
      method: "company_name",
      accountData: matches[0]
    };
  }

  const activeAccounts = matches.filter(a => a.cue_lactivo);
  const selectedAccount = activeAccounts.length > 0 ? activeAccounts[0] : matches[0];
  
  return {
    accountNumber: selectedAccount.cue_ncuenta,
    confidence: activeAccounts.length === 1 ? "high" : "medium",
    method: "company_name_multiple",
    accountData: selectedAccount,
    alternativeAccounts: matches.map(m => m.cue_ncuenta)
  };
}

/**
 * 🔥 STRATEGY C: Email Domain Matching
 */
function findByEmailDomain(email, allAccounts) {
  const domain = extractDomain(email);
  if (!domain || isGenericDomain(domain)) return null;

  const domainKeyword = domain.split(".")[0];

  const matches = allAccounts.filter(account => {
    const companyName = account.cue_cnombre || account.cue_cempresa || "";
    const normalizedCompany = normalizeCompanyName(companyName);
    return normalizedCompany.includes(domainKeyword);
  });

  if (matches.length === 0) return null;

  if (matches.length === 1) {
    return {
      accountNumber: matches[0].cue_ncuenta,
      confidence: "high",
      method: "email_domain",
      accountData: matches[0]
    };
  }

  const activeAccount = matches.find(a => a.cue_lactivo) || matches[0];
  
  return {
    accountNumber: activeAccount.cue_ncuenta,
    confidence: "medium",
    method: "email_domain_multiple",
    accountData: activeAccount,
    alternativeAccounts: matches.map(m => m.cue_ncuenta)
  };
}

/**
 * 🔥 STRATEGY D: Keyword Matching
 */
function findByKeywords(companyName, allAccounts) {
  if (!companyName || companyName.trim().length < 3) return null;

  const keywords = extractKeywords(companyName);
  if (keywords.length === 0) return null;

  const matches = allAccounts.filter(account => {
    const bmCompanyName = normalizeCompanyName(
      account.cue_cnombre || account.cue_cempresa || ""
    );
    return keywords.some(keyword => bmCompanyName.includes(keyword));
  });

  if (matches.length === 0) return null;

  if (matches.length === 1) {
    return {
      accountNumber: matches[0].cue_ncuenta,
      confidence: "medium",
      method: "keyword_match",
      accountData: matches[0]
    };
  }

  const activeAccount = matches.find(a => a.cue_lactivo) || matches[0];
  
  return {
    accountNumber: activeAccount.cue_ncuenta,
    confidence: "low",
    method: "keyword_match_multiple",
    accountData: activeAccount,
    alternativeAccounts: matches.map(m => m.cue_ncuenta)
  };
}

/**
 * 🚀 MAIN DISCOVERY FUNCTION - OPTIMIZED
 * Fetches all accounts ONCE, then runs all strategies in memory
 */
export async function discoverAccountNumber(email, companyName) {
  const startTime = Date.now();
  
  console.log(`\n🔍 Starting optimized account discovery...`);
  console.log(`   Email: ${email}`);
  console.log(`   Company: ${companyName || 'Not provided'}`);

  try {
    // 🔥 SINGLE DATABASE CALL - Fetch all accounts once using dedicated method
    console.log(`   📊 Fetching all accounts from database...`);
    const result = await bmSecurityAPI.getAllAccounts();
    
    if (!result.success || !result.data || result.data.length === 0) {
      console.log(`   ❌ No accounts found in database`);
      return null;
    }

    const allAccounts = result.data;
    const fetchTime = Date.now() - startTime;
    console.log(`   ✅ Fetched ${allAccounts.length} accounts in ${fetchTime}ms`);

    const domain = extractDomain(email);
    if (domain && isGenericDomain(domain)) {
      console.log(`   ⚠️  Generic email domain (${domain}) - relying on company name\n`);
    } else {
      console.log(`   ✅ Corporate email domain (${domain})\n`);
    }

    // 🔥 RUN ALL STRATEGIES IN MEMORY (super fast)
    
    // Strategy A: Direct email
    console.log(`[Strategy A] Checking direct email match...`);
    let discoveryResult = findByEmail(email, allAccounts);
    if (discoveryResult) {
      const totalTime = Date.now() - startTime;
      console.log(`✅ SUCCESS via ${discoveryResult.method} in ${totalTime}ms\n`);
      return discoveryResult;
    }

    // Strategy B: Company name
    if (companyName) {
      console.log(`[Strategy B] Checking company name match...`);
      discoveryResult = findByCompanyName(companyName, allAccounts);
      if (discoveryResult) {
        const totalTime = Date.now() - startTime;
        console.log(`✅ SUCCESS via ${discoveryResult.method} in ${totalTime}ms\n`);
        return discoveryResult;
      }
    }

    // Strategy C: Email domain
    console.log(`[Strategy C] Checking email domain match...`);
    discoveryResult = findByEmailDomain(email, allAccounts);
    if (discoveryResult) {
      const totalTime = Date.now() - startTime;
      console.log(`✅ SUCCESS via ${discoveryResult.method} in ${totalTime}ms\n`);
      return discoveryResult;
    }

    // Strategy D: Keyword matching
    if (companyName) {
      console.log(`[Strategy D] Checking keyword match...`);
      discoveryResult = findByKeywords(companyName, allAccounts);
      if (discoveryResult) {
        const totalTime = Date.now() - startTime;
        console.log(`⚠️  FOUND via ${discoveryResult.method} in ${totalTime}ms\n`);
        return discoveryResult;
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`❌ All strategies failed in ${totalTime}ms\n`);
    return null;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[Discovery] Error after ${totalTime}ms:`, error.message);
    return null;
  }
}

/**
 * Validates discovered account number
 */
export async function validateAccountNumber(accountNumber) {
  try {
    console.log(`[Validation] Checking account: ${accountNumber}`);

    const result = await bmSecurityAPI.getAccountByNumber(accountNumber);

    if (!result.success || !result.account) {
      console.log(`[Validation] ❌ Account not found or invalid`);
      return { valid: false, error: "Account not found in BM Security" };
    }

    console.log(`[Validation] ✅ Account validated: ${result.accountUsed}`);
    
    return {
      valid: true,
      normalizedAccountNumber: result.accountUsed,
      accountData: result.account
    };

  } catch (error) {
    console.error(`[Validation] Error:`, error.message);
    return { valid: false, error: error.message };
  }
}