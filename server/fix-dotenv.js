#!/usr/bin/env node
// ============================================================
// 🔧 fix-dotenv.js
// Fixes all dotenv.config({ path: require('path').join(__dirname, '.env') }) calls across the project to use
// an explicit __dirname-based path so env vars always load
// correctly regardless of where the process is started from.
//
// Usage:
//   node fix-dotenv.js            (dry run — shows what will change)
//   node fix-dotenv.js --apply    (applies the fixes)
// ============================================================

const fs   = require('fs');
const path = require('path');

const DRY_RUN = !process.argv.includes('--apply');

if (DRY_RUN) {
  console.log('🔍 DRY RUN — no files will be changed. Pass --apply to fix.\n');
} else {
  console.log('🔧 APPLYING fixes...\n');
}

// ─── CONFIG ─────────────────────────────────────────────────
// Root of your project (one level up from /server where this script lives)
const PROJECT_ROOT = path.resolve(__dirname);

// Folders to skip entirely
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'release']);

// Only process these file types
const VALID_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

// ─── PATTERNS TO FIND & REPLACE ─────────────────────────────
//
// We handle three cases:
//
// CASE 1 — bare call (no options):
//   require('dotenv').config({ path: require('path').join(__dirname, '.env') })
//   → require('dotenv').config({ path: require('path').join(__dirname, '.env') })
//
// CASE 2 — call with options but no `path` key:
//   require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: false })
//   → require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: false })
//
// CASE 3 — already has a `path` key → skip (already fixed)
//
// Also handles: dotenv.config(...) when dotenv is already required separately

const REPLACEMENT_PATH = `require('path').join(__dirname, '.env')`;

// ─── HELPERS ────────────────────────────────────────────────
function walkDir(dir, fileList = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return fileList; }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name))  continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (entry.isFile() && VALID_EXTENSIONS.has(path.extname(entry.name))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function fixDotenvCalls(content, filePath) {
  let changed  = false;
  const issues = [];

  // ── Regex patterns ──────────────────────────────────────────

  // Matches: require('dotenv').config({ path: require('path').join(__dirname, '.env') })  or  require('dotenv').config({ path: require('path').join(__dirname, '.env') })
  // with optional whitespace and NO arguments
  const bareInlineRe = /require\(['"]dotenv['"]\)\.config\(\s*\)/g;

  // Matches: require('dotenv').config({ path: require('path').join(__dirname, '.env'), ... }) — captures the inner object
  const inlineWithOptsRe = /require\(['"]dotenv['"]\)\.config\(\s*\{([^}]*)\}\s*\)/g;

  // Matches: dotenv.config({ path: require('path').join(__dirname, '.env') })  (dotenv imported as variable)
  const bareVarRe = /\bdotenv\.config\(\s*\)/g;

  // Matches: dotenv.config({ path: require('path').join(__dirname, '.env'), ... })
  const varWithOptsRe = /\bdotenv\.config\(\s*\{([^}]*)\}\s*\)/g;

  // ── Fix 1: require('dotenv').config({ path: require('path').join(__dirname, '.env') }) with no args ──────────
  content = content.replace(bareInlineRe, (match) => {
    issues.push(`  bare inline: ${match.trim()}`);
    changed = true;
    return `require('dotenv').config({ path: ${REPLACEMENT_PATH} })`;
  });

  // ── Fix 2: require('dotenv').config({ path: require('path').join(__dirname, '.env'), ...opts }) ────────────
  content = content.replace(inlineWithOptsRe, (match, inner) => {
    if (/\bpath\s*:/.test(inner)) return match; // already has path — skip
    issues.push(`  inline with opts: ${match.trim()}`);
    changed = true;
    const trimmed = inner.trim();
    const sep     = trimmed ? ', ' : '';
    return `require('dotenv').config({ path: ${REPLACEMENT_PATH}${sep}${trimmed} })`;
  });

  // ── Fix 3: dotenv.config({ path: require('path').join(__dirname, '.env') }) with no args ─────────────────────
  content = content.replace(bareVarRe, (match) => {
    // Make sure dotenv is actually imported in this file before replacing
    if (!/require\(['"]dotenv['"]\)|import.*dotenv/.test(content)) return match;
    issues.push(`  bare var: ${match.trim()}`);
    changed = true;
    return `dotenv.config({ path: ${REPLACEMENT_PATH} })`;
  });

  // ── Fix 4: dotenv.config({ path: require('path').join(__dirname, '.env'), ...opts }) ───────────────────────
  content = content.replace(varWithOptsRe, (match, inner) => {
    if (!/require\(['"]dotenv['"]\)|import.*dotenv/.test(content)) return match;
    if (/\bpath\s*:/.test(inner)) return match; // already has path — skip
    issues.push(`  var with opts: ${match.trim()}`);
    changed = true;
    const trimmed = inner.trim();
    const sep     = trimmed ? ', ' : '';
    return `dotenv.config({ path: ${REPLACEMENT_PATH}${sep}${trimmed} })`;
  });

  return { content, changed, issues };
}

// ─── MAIN ────────────────────────────────────────────────────
function main() {
  console.log(`📂 Scanning: ${PROJECT_ROOT}\n`);

  const files     = walkDir(PROJECT_ROOT);
  const fixed     = [];
  const skipped   = [];
  const alreadyOk = [];

  for (const filePath of files) {
    let original;
    try { original = fs.readFileSync(filePath, 'utf8'); }
    catch { skipped.push(filePath); continue; }

    // Quick check — does this file even mention dotenv?
    if (!original.includes('dotenv')) { continue; }

    const rel = path.relative(PROJECT_ROOT, filePath);
    const { content, changed, issues } = fixDotenvCalls(original, filePath);

    if (!changed) {
      alreadyOk.push(rel);
      continue;
    }

    console.log(`📄 ${rel}`);
    issues.forEach(i => console.log(`   ${i}`));

    if (!DRY_RUN) {
      try {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`   ✅ Fixed\n`);
        fixed.push(rel);
      } catch (err) {
        console.log(`   ❌ Could not write: ${err.message}\n`);
        skipped.push(rel);
      }
    } else {
      console.log(`   → would be fixed\n`);
      fixed.push(rel);
    }
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(60));

  if (alreadyOk.length) {
    console.log(`\n✅ Already correct (${alreadyOk.length} files):`);
    alreadyOk.forEach(f => console.log(`   ${f}`));
  }

  if (fixed.length) {
    const verb = DRY_RUN ? 'Would fix' : 'Fixed';
    console.log(`\n🔧 ${verb} (${fixed.length} files):`);
    fixed.forEach(f => console.log(`   ${f}`));
  }

  if (skipped.length) {
    console.log(`\n⚠️  Skipped / errors (${skipped.length} files):`);
    skipped.forEach(f => console.log(`   ${f}`));
  }

  if (fixed.length === 0) {
    console.log('\n🎉 Nothing to fix — all dotenv calls are already correct!');
  } else if (DRY_RUN) {
    console.log(`\n👉 Run with --apply to apply ${fixed.length} fix(es):`);
    console.log(`   node fix-dotenv.js --apply`);
  } else {
    console.log(`\n🎉 Done! ${fixed.length} file(s) fixed.`);
    console.log('   Restart your server: npm run dev  or  node server.js');
  }

  console.log('');
}

main();