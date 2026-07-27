'use strict';

/**
 * driveService.js
 *
 * ✅ FIX: All Drive API calls now include supportsAllDrives: true and corpora: 'allDrives'
 *         so the service account can write into Shared Drives (which have storage
 *         quota) instead of personal My Drive (which does not).
 *
 * Folder structure inside ARCHIVE_ROOT_FOLDER_ID (Shared Drive folder):
 *   <ARCHIVE_ROOT_FOLDER_ID> / <clientName> / <YYYY-MM> / <filename>.pdf
 *
 * Env vars required:
 *   GOOGLE_SERVICE_ACCOUNT_KEY   — inline JSON string  (preferred)
 *   ARCHIVE_ROOT_FOLDER_ID       — root folder ID inside the Shared Drive
 *
 * Optional:
 *   GOOGLE_SERVICE_ACCOUNT_JSON      — alternate name for inline JSON
 *   GOOGLE_SERVICE_ACCOUNT_KEY_FILE  — path to JSON key file
 */

const { google } = require('googleapis');
const fs         = require('fs');

// ── Logger ────────────────────────────────────────────────────────────────────
const logger = {
  info:    (...a) => console.log('[DRIVE]',         ...a),
  warn:    (...a) => console.warn('[DRIVE WARNING]', ...a),
  error:   (...a) => console.error('[DRIVE ERROR]',  ...a),
  success: (...a) => console.log('[DRIVE]',          ...a),
};

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Build an authenticated Google Drive v3 client.
 * Credential resolution order:
 *   1. GOOGLE_SERVICE_ACCOUNT_KEY  (inline JSON string)
 *   2. GOOGLE_SERVICE_ACCOUNT_JSON (alternate name)
 *   3. GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path to .json file)
 */
function getDriveClient() {
  const rawKey =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let credentials;

  if (rawKey) {
    try {
      credentials = JSON.parse(rawKey);
      logger.info('Auth: using inline JSON credentials');
    } catch {
      throw new Error(
        'GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_SERVICE_ACCOUNT_JSON contains invalid JSON'
      );
    }
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

  if (!credentials && keyFile) {
    if (!fs.existsSync(keyFile)) {
      throw new Error(`Service account key file not found at: ${keyFile}`);
    }
    logger.info('Auth: using service account key file');
  }

  if (!credentials && !keyFile) {
    throw new Error(
      'No Google Drive credentials found. ' +
      'Set GOOGLE_SERVICE_ACCOUNT_KEY (inline JSON) or ' +
      'GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path).'
    );
  }

  const auth = new google.auth.GoogleAuth({
    ...(credentials ? { credentials } : { keyFile }),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
}

// ── Shared Drive helpers ──────────────────────────────────────────────────────

/**
 * Returns the base params that must be present on every files.list() call
 * so Shared Drive items are included.
 */
function sharedDriveListParams() {
  return {
    supportsAllDrives:         true,
    includeItemsFromAllDrives: true,
    corpora:                   'allDrives',
  };
}

/**
 * Find an existing folder by name under a given parent, or create it.
 * Works in both My Drive and Shared Drives.
 *
 * @param {object} drive      - authenticated Drive v3 client
 * @param {string} folderName - name of the folder to find/create
 * @param {string} parentId   - ID of the parent folder
 * @returns {string} folder ID
 */
async function getOrCreateFolder(drive, folderName, parentId) {
  if (!parentId) throw new Error('getOrCreateFolder: parentId is required');

  const safeName = folderName.replace(/'/g, "\\'");

  // Search for an existing folder with this name under this parent
  const searchRes = await drive.files.list({
    q: [
      `name = '${safeName}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      `trashed = false`,
    ].join(' and '),
    fields:                    'files(id, name)',
    spaces:                    'drive',
    supportsAllDrives:         true,
    includeItemsFromAllDrives: true,
    corpora:                   'allDrives', // ✅ Critical for Shared Drive visibility
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id;
  }

  // Not found — create it
  const createRes = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name:     folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parentId],
    },
    fields: 'id, name',
  });

  logger.info(`Created folder: "${folderName}" (id: ${createRes.data.id})`);
  return createRes.data.id;
}

/**
 * List all non-trashed children of a folder (files and/or sub-folders).
 *
 * @param {object}      drive    - authenticated Drive v3 client
 * @param {string}      parentId - folder to list
 * @param {string|null} mimeType - optional MIME type filter
 * @returns {Array} array of file metadata objects
 */
async function listChildren(drive, parentId, mimeType = null) {
  const queryParts = [
    `'${parentId}' in parents`,
    `trashed = false`,
  ];
  if (mimeType) queryParts.push(`mimeType = '${mimeType}'`);

  const res = await drive.files.list({
    q:                         queryParts.join(' and '),
    fields:                    'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)',
    orderBy:                   'name desc',
    pageSize:                  1000,
    supportsAllDrives:         true,
    includeItemsFromAllDrives: true,
    corpora:                   'allDrives', // ✅ Critical for Shared Drive visibility
  });

  return res.data.files || [];
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Upload a patrol report PDF to Google Drive under:
 *   <ARCHIVE_ROOT_FOLDER_ID> / <clientName> / <YYYY-MM> / <filename>.pdf
 *
 * @param {object} opts
 * @param {string} opts.filePath   - absolute path to the PDF on disk
 * @param {string} opts.clientName - client name (used as sub-folder name)
 * @param {string} opts.startDate  - YYYY-MM-DD
 * @param {string} opts.endDate    - YYYY-MM-DD
 * @returns {{ id, name, link }}
 */
async function saveReportToDrive({ filePath, clientName, startDate, endDate }) {
  if (!filePath || !clientName || !startDate || !endDate) {
    throw new Error(
      'saveReportToDrive: filePath, clientName, startDate, and endDate are all required.'
    );
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file not found at path: ${filePath}`);
  }

  const rootId = process.env.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId) {
    throw new Error(
      'ARCHIVE_ROOT_FOLDER_ID is not set in environment variables. ' +
      'Set it to the ID of your Shared Drive folder.'
    );
  }

  const drive = getDriveClient();

  try {
    // ✅ Validate root folder exists and is accessible
    const rootFolder = await drive.files.get({
      fileId: rootId,
      supportsAllDrives: true,
      fields: 'id, name',
    });
    logger.info(`Using archive root: ${rootFolder.data.name} (${rootFolder.data.id})`);

    // Build the folder hierarchy inside the Shared Drive root
    const clientFolderId = await getOrCreateFolder(drive, clientName, rootId);
    const month          = startDate.slice(0, 7); // "YYYY-MM"
    const monthFolderId  = await getOrCreateFolder(drive, month, clientFolderId);

    // Build a safe filename
    const safeClient = clientName
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${safeClient}_${startDate}_to_${endDate}.pdf`;

    // Upload the file
    const uploadRes = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name:    fileName,
        mimeType: 'application/pdf',
        parents: [monthFolderId],
      },
      media: {
        mimeType: 'application/pdf',
        body:     fs.createReadStream(filePath),
      },
      fields: 'id, name, webViewLink',
    });

    const result = {
      id:   uploadRes.data.id,
      name: uploadRes.data.name,
      link: uploadRes.data.webViewLink,
    };

    logger.success(`✅ Saved to Drive: ${result.name}`);
    logger.info(`   Link: ${result.link}`);
    return result;

  } catch (err) {
    logger.error(`Failed to save "${clientName}" report to Drive: ${err.message}`);
    throw err;
  }
}

// ── Archive read helpers ──────────────────────────────────────────────────────

/**
 * List all client sub-folders directly under ARCHIVE_ROOT_FOLDER_ID.
 * Returns [{ id, name }]
 */
async function listArchiveClients() {
  const rootId = process.env.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId) return [];

  const drive   = getDriveClient();
  const folders = await listChildren(
    drive,
    rootId,
    'application/vnd.google-apps.folder'
  );

  return folders
    .map(f => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List all month sub-folders for a given client folder name.
 * Returns [{ id, name }] sorted newest-first.
 *
 * @param {string} clientFolderName - exact folder name in Drive
 */
async function listArchiveMonths(clientFolderName) {
  const rootId = process.env.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId) return [];

  const drive         = getDriveClient();
  const clientFolders = await listChildren(
    drive,
    rootId,
    'application/vnd.google-apps.folder'
  );

  const clientFolder = clientFolders.find(
    f => f.name.trim().toUpperCase() === clientFolderName.trim().toUpperCase()
  );
  if (!clientFolder) return [];

  const monthFolders = await listChildren(
    drive,
    clientFolder.id,
    'application/vnd.google-apps.folder'
  );

  return monthFolders
    .map(f => ({ id: f.id, name: f.name }))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first
}

/**
 * List PDF files for a client, optionally filtered by month (e.g. "2026-04").
 * Returns [{ id, name, webViewLink, createdTime, size }]
 *
 * @param {string}      clientFolderName - exact folder name in Drive
 * @param {string|null} monthFilter      - "YYYY-MM" or null for all months
 */
async function listArchiveFiles(clientFolderName, monthFilter = null) {
  const rootId = process.env.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId) return [];

  const drive         = getDriveClient();
  const clientFolders = await listChildren(
    drive,
    rootId,
    'application/vnd.google-apps.folder'
  );

  const clientFolder = clientFolders.find(
    f => f.name.trim().toUpperCase() === clientFolderName.trim().toUpperCase()
  );
  if (!clientFolder) return [];

  // Collect month folder IDs to scan
  let monthIds = [];

  if (monthFilter) {
    const monthFolders = await listChildren(
      drive,
      clientFolder.id,
      'application/vnd.google-apps.folder'
    );
    const match = monthFolders.find(f => f.name === monthFilter);
    if (!match) return [];
    monthIds = [match.id];
  } else {
    const monthFolders = await listChildren(
      drive,
      clientFolder.id,
      'application/vnd.google-apps.folder'
    );
    monthIds = monthFolders.map(f => f.id);
  }

  if (monthIds.length === 0) return [];

  // Fetch PDFs from each month folder
  const allFiles = [];
  for (const mId of monthIds) {
    const files = await listChildren(drive, mId, 'application/pdf');
    allFiles.push(...files);
  }

  return allFiles.map(f => ({
    id:          f.id,
    name:        f.name,
    webViewLink: f.webViewLink  || null,
    createdTime: f.createdTime  || null,
    size:        f.size ? parseInt(f.size, 10) : null,
  }));
}

/**
 * Stream a file from Drive by ID.
 * Returns a readable stream.
 */
async function getFileStream(fileId) {
  const drive    = getDriveClient();
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return response.data;
}

/**
 * Get file metadata (name, size, mimeType, webViewLink) by Drive file ID.
 */
async function getFileMetadata(fileId) {
  const drive = getDriveClient();
  const res   = await drive.files.get({
    fileId,
    fields:            'id, name, size, mimeType, webViewLink',
    supportsAllDrives: true,
  });
  return res.data;
}

/**
 * Soft-delete (trash) a Drive file by ID.
 */
async function trashFile(fileId) {
  const drive = getDriveClient();
  const res   = await drive.files.update({
    fileId,
    supportsAllDrives: true,
    requestBody: { trashed: true },
    fields: 'id, name, trashed',
  });
  return res.data;
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  // Core upload
  saveReportToDrive,

  // Archive read helpers
  listArchiveClients,
  listArchiveMonths,
  listArchiveFiles,
  getFileStream,
  getFileMetadata,
  trashFile,

  // Low-level helpers (re-exported for callers that need them)
  getDriveClient,
  getOrCreateFolder,
  listChildren,
};