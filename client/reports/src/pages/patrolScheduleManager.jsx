import { useState, useEffect, useCallback } from "react";
import { 
  Upload, Database, CheckCircle, XCircle, AlertCircle, 
  Loader, FileUp, Clock, Activity, Server, Trash2, Lock 
} from "lucide-react";

// API Configuration
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Helper function for consistent API calls
const createApiHelper = () => {
  const apiFetch = async (endpoint, options = {}) => {
    const url = `${API_BASE}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || `HTTP ${response.status}`;
        } catch {
          errorMessage = `HTTP ${response.status}: ${errorText}`;
        }
        throw new Error(errorMessage);
      }
      
      return await response.json();
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Cannot connect to server. Please check if the server is running.');
      }
      throw error;
    }
  };

  const apiFetchFormData = async (endpoint, formData) => {
    const url = `${API_BASE}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || `HTTP ${response.status}`;
        } catch {
          errorMessage = `HTTP ${response.status}: ${errorText}`;
        }
        throw new Error(errorMessage);
      }
      
      return await response.json();
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Cannot connect to server. Please check if the server is running.');
      }
      throw error;
    }
  };

  return { apiFetch, apiFetchFormData };
};

export default function BackupSyncDashboard() {
  // State Management
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState("");
  const [uploadHistory, setUploadHistory] = useState([]);
  const [deleting, setDeleting] = useState(null);
  const [canUpload, setCanUpload] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [serverReachable, setServerReachable] = useState(true);
  const [configError, setConfigError] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Initialize API helper
  const { apiFetch, apiFetchFormData } = createApiHelper();

  // Format file size helper
  const formatFileSize = useCallback((bytes) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  }, []);

  // Check server health
  const checkServerHealth = useCallback(async () => {
    if (!isOnline) return false;
    
    try {
      const response = await fetch(`${API_BASE}/health`);
      return response.ok;
    } catch (error) {
      console.error("Server health check failed:", error);
      return false;
    }
  }, [isOnline]);

  // Fetch upload history
  const fetchUploadHistory = useCallback(async () => {
    if (!isOnline) {
      setServerReachable(false);
      return;
    }

    try {
      const isServerHealthy = await checkServerHealth();
      if (!isServerHealthy) {
        setServerReachable(false);
        return;
      }

      const responseData = await apiFetch("/backup/history");
      if (responseData.success) {
        setUploadHistory(responseData.history || []);
        setCanUpload(responseData.history?.length === 0);
      } else {
        setError(responseData.message || "Failed to fetch history");
      }
      setServerReachable(true);
    } catch (err) {
      console.error("Failed to fetch upload history:", err.message);
      setServerReachable(false);
      if (err.message.includes('Cannot connect to server')) {
        setError("Cannot connect to backend server. Make sure it's running on http://localhost:5000");
      }
    }
  }, [isOnline, apiFetch, checkServerHealth]);

  // Handle delete backup
  const handleDelete = async (id, filename) => {
    if (!confirm(`Are you sure you want to delete backup "${filename}"? This action cannot be undone.`)) {
      return;
    }

    setDeleting(id);
    try {
      const response = await apiFetch(`/backup/history/${id}`, {
        method: "DELETE",
      });

      if (response.success) {
        setUploadHistory((prev) => prev.filter((item) => item.id !== id));
        setCanUpload(true);
        setUploadResult({
          success: true,
          message: `Backup "${filename}" deleted successfully. You can now upload a new backup.`,
          isDelete: true,
        });
        setError("");
      } else {
        throw new Error(response.message || "Delete failed");
      }
    } catch (err) {
      console.error("Delete error:", err.message);
      setError(err.message || "Failed to delete backup");
    } finally {
      setDeleting(null);
    }
  };

  // Handle file change
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith(".bak")) {
        if (selectedFile.size > 500 * 1024 * 1024) { // 500MB limit
          setError("File size exceeds 500MB limit");
          setFile(null);
        } else {
          setFile(selectedFile);
          setError("");
          setUploadResult(null);
        }
      } else {
        setError("Please select a valid .bak file");
        setFile(null);
      }
    }
  };

  // Handle drag events
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // Handle drop event
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith(".bak")) {
        if (droppedFile.size > 500 * 1024 * 1024) {
          setError("File size exceeds 500MB limit");
          setFile(null);
        } else {
          setFile(droppedFile);
          setError("");
          setUploadResult(null);
        }
      } else {
        setError("Please drop a valid .bak file");
      }
    }
  };

  // Handle upload
  const handleUpload = async () => {
    if (!file) {
      setError("Please select a backup file first");
      return;
    }

    if (!canUpload) {
      setError("You must delete the existing backup before uploading a new one");
      return;
    }

    setUploading(true);
    setError("");
    setUploadResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await apiFetchFormData("/backup/sync", formData);
      
      if (response.success) {
        setUploadResult({
          success: true,
          message: response.message,
          details: response.details,
        });
        setFile(null);
        
        // Refresh history
        await fetchUploadHistory();
      } else {
        throw new Error(response.message || "Upload failed");
      }
    } catch (err) {
      setError(err.message || "Backup sync failed");
    } finally {
      setUploading(false);
    }
  };

  // Network status effects
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchUploadHistory();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setServerReachable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchUploadHistory]);

  // Initial data fetch
  useEffect(() => {
    if (navigator.onLine) {
      fetchUploadHistory();
    }
  }, [fetchUploadHistory]);

  // Auto-clear messages
  useEffect(() => {
    if (uploadResult?.success) {
      const timer = setTimeout(() => setUploadResult(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [uploadResult]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const isSystemAvailable = isOnline && serverReachable && !configError;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Configuration Error */}
        {!API_BASE && (
          <div className="bg-red-900 border-l-4 border-red-600 rounded-xl p-6 mb-6 shadow-lg">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-8 h-8 text-red-300 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-2">Configuration Error</h3>
                <p className="text-red-100 mb-2">VITE_API_URL is not configured</p>
                <p className="text-sm text-red-200">
                  Using default: http://localhost:5000/api
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-2xl p-8 mb-8 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                <Database className="w-10 h-10" />
              </div>
              <div>
                <h1 className="text-4xl font-bold mb-2">Database Backup Sync</h1>
                <p className="text-blue-100 text-lg">Upload and restore SQL Server backup files</p>
                <p className="text-blue-200 text-sm mt-1">API Base: {API_BASE}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                isSystemAvailable
                  ? 'bg-green-500/20' 
                  : 'bg-red-500/20'
              }`}>
                <Server className="w-5 h-5" />
                <div>
                  <p className="font-semibold">
                    {isSystemAvailable ? 'System Online' : 
                     !API_BASE ? 'Configuration Error' :
                     !isOnline ? 'Offline' : 'Server Unreachable'}
                  </p>
                  {!API_BASE && (
                    <p className="text-xs opacity-90">Check environment variables</p>
                  )}
                  {!isOnline && (
                    <p className="text-xs opacity-90">No internet connection</p>
                  )}
                  {isOnline && !serverReachable && API_BASE && (
                    <p className="text-xs opacity-90">Cannot connect to server</p>
                  )}
                </div>
              </div>
              {uploadHistory.length > 0 && isSystemAvailable && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20">
                  <Lock className="w-5 h-5" />
                  <span className="font-semibold text-sm">
                    {uploadHistory.length} Active Backup
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Offline Warning */}
        {!isOnline && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-xl p-6 mb-6 shadow-lg">
            <div className="flex items-start gap-4">
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-900 mb-2">No Internet Connection</h3>
                <p className="text-red-800 mb-2">
                  You are currently offline. Please check your internet connection to use the backup sync service.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Server Unreachable Warning */}
        {isOnline && !serverReachable && API_BASE && (
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-xl p-6 mb-6 shadow-lg">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-orange-900 mb-2">Server Unreachable</h3>
                <p className="text-orange-800 mb-2">
                  Unable to connect to the backup server at {API_BASE}. The server may be down or experiencing issues.
                </p>
                <p className="text-sm text-orange-700">
                  Please make sure the backend server is running on http://localhost:5000
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Upload Restriction Warning */}
        {!canUpload && isSystemAvailable && (
          <div className="bg-amber-50 border-l-4 border-amber-500 rounded-xl p-6 mb-6 shadow-lg">
            <div className="flex items-start gap-4">
              <Lock className="w-6 h-6 text-amber-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-bold text-amber-900 mb-2">Upload Restricted</h3>
                <p className="text-amber-800 mb-2">
                  You must delete the existing backup before uploading a new one. Only one active backup is allowed at a time.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Upload Section */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
            <FileUp className="w-6 h-6 text-blue-600" />
            Upload Backup File
          </h2>

          {/* Drag & Drop Zone */}
          <div
            className={`relative border-3 border-dashed rounded-xl p-12 text-center transition-all ${
              !canUpload || !isSystemAvailable
                ? "border-gray-200 bg-gray-100 cursor-not-allowed opacity-50"
                : dragActive
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50"
            }`}
            onDragEnter={canUpload && isSystemAvailable ? handleDrag : undefined}
            onDragLeave={canUpload && isSystemAvailable ? handleDrag : undefined}
            onDragOver={canUpload && isSystemAvailable ? handleDrag : undefined}
            onDrop={canUpload && isSystemAvailable ? handleDrop : undefined}
          >
            <input
              type="file"
              accept=".bak"
              onChange={handleFileChange}
              className="hidden"
              id="file-upload"
              disabled={uploading || !canUpload || !isSystemAvailable}
            />

            <label
              htmlFor="file-upload"
              className={`flex flex-col items-center ${canUpload && isSystemAvailable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            >
              {(!canUpload || !isSystemAvailable) && <Lock className="w-16 h-16 text-gray-400 mb-4" />}
              {canUpload && isSystemAvailable && <Upload className="w-16 h-16 text-gray-400 mb-4" />}
              <p className="text-xl font-semibold text-gray-700 mb-2">
                {!isOnline
                  ? "Upload Disabled - No internet connection"
                  : !serverReachable
                  ? "Upload Disabled - Server unreachable"
                  : !canUpload 
                  ? "Upload Disabled - Delete existing backup first"
                  : file 
                  ? file.name 
                  : "Choose a backup file or drag it here"}
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Supports .bak files only • Max size: 500MB
              </p>
              {file && canUpload && isSystemAvailable && (
                <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-lg font-medium">
                  {formatFileSize(file.size)}
                </div>
              )}
            </label>
          </div>

          {/* Upload Button */}
          <div className="mt-6">
            <button
              onClick={handleUpload}
              disabled={!file || uploading || !canUpload || !isSystemAvailable}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl p-4 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-semibold text-lg transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
            >
              {uploading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Syncing Backup...
                </>
              ) : !isSystemAvailable ? (
                <>
                  <XCircle className="w-5 h-5" />
                  {!isOnline ? "No Connection" : "Server Unreachable"}
                </>
              ) : !canUpload ? (
                <>
                  <Lock className="w-5 h-5" />
                  Upload Locked
                </>
              ) : (
                <>
                  <Database className="w-5 h-5" />
                  Sync Backup to Database
                </>
              )}
            </button>
          </div>

          {/* Progress Info */}
          {uploading && (
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <Activity className="w-5 h-5 text-blue-600 animate-pulse" />
                <div>
                  <p className="font-semibold text-blue-900">Processing backup file...</p>
                  <p className="text-sm text-blue-700">This may take a few minutes depending on file size</p>
                </div>
              </div>
              <div className="space-y-2 text-sm text-blue-800 ml-8">
                <p>• Uploading file to server</p>
                <p>• Restoring backup to staging database</p>
                <p>• Checking for duplicate records</p>
                <p>• Merging data into main database</p>
              </div>
            </div>
          )}
        </div>

        {/* Success Message */}
        {uploadResult && uploadResult.success && (
          <div className={`border-l-4 rounded-xl p-6 mb-6 shadow-lg ${
            uploadResult.isDelete 
              ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-500'
              : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-500'
          }`}>
            <div className="flex items-start gap-4">
              <CheckCircle className={`w-6 h-6 flex-shrink-0 mt-1 ${
                uploadResult.isDelete ? 'text-blue-600' : 'text-green-600'
              }`} />
              <div className="flex-1">
                <h3 className={`text-lg font-bold mb-2 ${
                  uploadResult.isDelete ? 'text-blue-900' : 'text-green-900'
                }`}>
                  {uploadResult.isDelete ? 'Backup Deleted!' : 'Backup Synced Successfully!'}
                </h3>
                <p className={uploadResult.isDelete ? 'text-blue-800' : 'text-green-800'}>
                  {uploadResult.message}
                </p>
                
                {uploadResult.details && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">File Size</p>
                        <p className="text-lg font-bold text-gray-900">{uploadResult.details.fileSize}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">Records Found</p>
                        <p className="text-lg font-bold text-gray-900">{uploadResult.details.recordsFound}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">Records Merged</p>
                        <p className="text-lg font-bold text-green-600">{uploadResult.details.recordsMerged}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">Duplicates Skipped</p>
                        <p className="text-lg font-bold text-amber-600">{uploadResult.details.duplicatesSkipped}</p>
                      </div>
                    </div>

                    <div className="mt-4 text-sm text-green-700 space-y-1">
                      <p>📁 File: <span className="font-semibold">{uploadResult.details.filename}</span></p>
                      <p>🕐 Time: <span className="font-semibold">{new Date(uploadResult.details.timestamp).toLocaleString()}</span></p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-xl p-6 mb-6 shadow-lg">
            <div className="flex items-start gap-4">
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-bold text-red-900 mb-2">Error</h3>
                <p className="text-red-800">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Upload History */}
        {uploadHistory.length > 0 && (
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <Clock className="w-6 h-6 text-blue-600" />
              Backup History
            </h2>
            <div className="space-y-4">
              {uploadHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-5 rounded-xl border-l-4 bg-green-50 border-green-500 transition-all hover:shadow-md"
                >
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 mb-1">{item.filename}</p>
                        <p className="text-sm text-gray-600 mb-2">
                          {new Date(item.uploadedAt).toLocaleString()}
                        </p>
                        
                        <div className="flex flex-wrap gap-3 text-xs mt-2">
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                            📊 {item.recordsMerged} merged
                          </span>
                          <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded">
                            ⏭️ {item.duplicatesSkipped} skipped
                          </span>
                          <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                            💾 {item.fileSize}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-green-100 text-green-800">
                        {item.status}
                      </span>
                      <button
                        onClick={() => handleDelete(item.id, item.filename)}
                        disabled={deleting === item.id || !isSystemAvailable}
                        className="flex items-center gap-2 bg-red-600 text-white rounded-lg px-4 py-2 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                      >
                        {deleting === item.id ? (
                          <>
                            <Loader className="w-4 h-4 animate-spin" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Section */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mt-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-3 text-base">How the Backup Sync Works:</p>
              <ol className="list-decimal list-inside space-y-2">
                <li className="pl-2">
                  <span className="font-semibold">Upload:</span> Your SQL Server .bak backup file is securely uploaded
                </li>
                <li className="pl-2">
                  <span className="font-semibold">Restore:</span> System restores backup to a temporary staging database
                </li>
                <li className="pl-2">
                  <span className="font-semibold">Validate:</span> Checks for duplicate records using timestamp and terminal ID
                </li>
                <li className="pl-2">
                  <span className="font-semibold">Merge:</span> Only new records are inserted into the main database
                </li>
              </ol>
              <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                <p className="font-semibold mb-2">✅ Features:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Automatic duplicate prevention</li>
                  <li>Safe merge without data loss</li>
                  <li>Detailed statistics on every sync</li>
                  <li><strong>One backup at a time policy</strong></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}