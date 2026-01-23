import { useState, useEffect } from "react";
import { Upload, Database, CheckCircle, XCircle, AlertCircle, Loader, FileUp, Clock, Activity, Server, Trash2, Lock } from "lucide-react";

export default function BackupSyncDashboard() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [uploadHistory, setUploadHistory] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [canUpload, setCanUpload] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [serverReachable, setServerReachable] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

  useEffect(() => {
    const fetchUploadHistory = async () => {
      if (!navigator.onLine) {
        console.log("No internet connection, skipping history fetch");
        return;
      }

      setLoadingHistory(true);
      try {
        console.log("Fetching upload history from:", `${API_BASE}/backup/history`);
        const res = await fetch(`${API_BASE}/backup/history`);
        
        if (!res.ok) {
          console.error(`Server responded with status: ${res.status} ${res.statusText}`);
          setServerReachable(false);
          setUploadHistory([]);
          return;
        }
        
        const data = await res.json();
        console.log("History API response:", data);
        
        if (data.success) {
          // FIXED: The API returns 'data' not 'history'
          const historyData = data.data || data.history;
          
          // Check if history exists and is an array
          if (historyData && Array.isArray(historyData)) {
            setUploadHistory(historyData);
            setCanUpload(historyData.length === 0);
          } else {
            console.warn("History is not an array or is missing:", historyData);
            setUploadHistory([]);
            setCanUpload(true);
          }
          setServerReachable(true);
        } else {
          console.warn("API returned success: false", data);
          setUploadHistory([]);
          setCanUpload(true);
          setServerReachable(true);
        }
      } catch (err) {
        console.error("Failed to fetch upload history:", err);
        setServerReachable(false);
        setUploadHistory([]);
      } finally {
        setLoadingHistory(false);
      }
    };

    // Fetch history on mount and when coming back online
    if (navigator.onLine) {
      fetchUploadHistory();
    }

    const handleOnline = () => {
      setIsOnline(true);
      fetchUploadHistory();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [API_BASE]);

  const handleDelete = async (id, filename) => {
    if (!confirm(`Are you sure you want to delete backup "${filename}"? This action cannot be undone.`)) {
      return;
    }

    setDeleting(id);
    try {
      const res = await fetch(`${API_BASE}/backup/history/${id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        setUploadHistory((prev) => prev.filter((item) => item.id !== id));
        setCanUpload(true);
        setServerReachable(true);
        setResult({
          success: true,
          message: `Backup "${filename}" deleted successfully. You can now upload a new backup.`,
          isDelete: true,
        });
      } else {
        setError(data.message || "Failed to delete backup");
      }
    } catch (err) {
      console.error("Delete error:", err);
      setError("Failed to delete backup. Please try again.");
      setServerReachable(false);
    } finally {
      setDeleting(null);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith(".bak")) {
        setFile(selectedFile);
        setError("");
        setResult(null);
      } else {
        setError("Please select a valid .bak file");
        setFile(null);
      }
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith(".bak")) {
        setFile(droppedFile);
        setError("");
        setResult(null);
      } else {
        setError("Please drop a valid .bak file");
      }
    }
  };

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
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/backup/sync`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setResult({
          success: true,
          message: data.message,
          details: data.details,
        });
        setFile(null);
        setServerReachable(true);
        
        // Refresh history
        try {
          const historyRes = await fetch(`${API_BASE}/backup/history`);
          const historyData = await historyRes.json();
          if (historyData.success) {
            // FIXED: The API returns 'data' not 'history'
            const refreshedHistory = historyData.data || historyData.history;
            if (refreshedHistory && Array.isArray(refreshedHistory)) {
              setUploadHistory(refreshedHistory);
              setCanUpload(refreshedHistory.length === 0);
            }
          }
        } catch (err) {
          console.error("Failed to refresh data:", err);
        }
      } else {
        setError(data.message || "Backup sync failed");
      }
    } catch (err) {
      console.error("Upload error:", err);
      setError("Failed to connect to server. Please check your connection and try again.");
      setServerReachable(false);
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  const isSystemAvailable = isOnline && serverReachable;

  // Safe check for history length
  const hasUploadHistory = Array.isArray(uploadHistory) && uploadHistory.length > 0;

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-900 via-blue-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-linear-to-r from-blue-600 to-indigo-600 rounded-2xl shadow-2xl p-8 mb-8 text-white">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                <Database className="w-10 h-10" />
              </div>
              <div>
                <h1 className="text-4xl font-bold mb-2">Database Backup Sync</h1>
                <p className="text-blue-100 text-lg">Upload and restore SQL Server backup files</p>
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
                    {isSystemAvailable ? 'System Online' : isOnline ? 'Server Unreachable' : 'Offline'}
                  </p>
                  {!isOnline && (
                    <p className="text-xs opacity-90">No internet connection</p>
                  )}
                  {isOnline && !serverReachable && (
                    <p className="text-xs opacity-90">Cannot connect to server</p>
                  )}
                </div>
              </div>
              {hasUploadHistory && isOnline && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20">
                  <Lock className="w-5 h-5" />
                  <span className="font-semibold text-sm">
                    {uploadHistory.length} Active Backup{uploadHistory.length !== 1 ? 's' : ''}
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
              <XCircle className="w-6 h-6 text-red-600 shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-red-900 mb-2">No Internet Connection</h3>
                <p className="text-red-800 mb-2">
                  You are currently offline. Please check your internet connection to use the backup sync service.
                </p>
                <p className="text-sm text-red-700">
                  The system will automatically reconnect when your internet connection is restored.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Server Unreachable Warning */}
        {isOnline && !serverReachable && (
          <div className="bg-orange-50 border-l-4 border-orange-500 rounded-xl p-6 mb-6 shadow-lg">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-orange-600 shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="text-lg font-bold text-orange-900 mb-2">Server Unreachable</h3>
                <p className="text-orange-800 mb-2">
                  Unable to connect to the backup server. The server may be down or experiencing issues.
                </p>
                <p className="text-sm text-orange-700">
                  Please contact your system administrator or try again later.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Upload Restriction Warning */}
        {!canUpload && isSystemAvailable && (
          <div className="bg-amber-50 border-l-4 border-amber-500 rounded-xl p-6 mb-6 shadow-lg">
            <div className="flex items-start gap-4">
              <Lock className="w-6 h-6 text-amber-600 shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-bold text-amber-900 mb-2">Upload Restricted</h3>
                <p className="text-amber-800 mb-2">
                  You must delete the existing backup before uploading a new one. Only one active backup is allowed at a time.
                </p>
                <p className="text-sm text-amber-700">
                  Scroll down to the backup history section and delete the current backup to enable new uploads.
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
              className="w-full bg-linear-to-r from-blue-600 to-indigo-600 text-white rounded-xl p-4 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed font-semibold text-lg transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
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
                <p>• Restoring backup to staging database</p>
                <p>• Checking for duplicate records</p>
                <p>• Merging data into main database</p>
                <p>• Cleaning up temporary files</p>
              </div>
            </div>
          )}
        </div>

        {/* Success Message with Details */}
        {result && result.success && (
          <div className={`border-l-4 rounded-xl p-6 mb-6 shadow-lg ${
            result.isDelete 
              ? 'bg-linear-to-r from-blue-50 to-indigo-50 border-blue-500'
              : 'bg-linear-to-r from-green-50 to-emerald-50 border-green-500'
          }`}>
            <div className="flex items-start gap-4">
              <CheckCircle className={`w-6 h-6 shrink-0 mt-1 ${
                result.isDelete ? 'text-blue-600' : 'text-green-600'
              }`} />
              <div className="flex-1">
                <h3 className={`text-lg font-bold mb-2 ${
                  result.isDelete ? 'text-blue-900' : 'text-green-900'
                }`}>
                  {result.isDelete ? 'Backup Deleted!' : 'Backup Synced Successfully!'}
                </h3>
                <p className={result.isDelete ? 'text-blue-800' : 'text-green-800'}>
                  {result.message}
                </p>
                
                {result.details && (
                  <>
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">File Size</p>
                        <p className="text-lg font-bold text-gray-900">{result.details.fileSize}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">Records Found</p>
                        <p className="text-lg font-bold text-gray-900">{result.details.recordsFound}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">Records Merged</p>
                        <p className="text-lg font-bold text-green-600">{result.details.recordsMerged}</p>
                      </div>
                      <div className="bg-white/60 rounded-lg p-3">
                        <p className="text-xs text-gray-600 mb-1">Duplicates Skipped</p>
                        <p className="text-lg font-bold text-amber-600">{result.details.duplicatesSkipped}</p>
                      </div>
                    </div>

                    <div className="mt-4 text-sm text-green-700 space-y-1">
                      <p>📁 File: <span className="font-semibold">{result.details.filename}</span></p>
                      <p>🕐 Time: <span className="font-semibold">{new Date(result.details.timestamp).toLocaleString()}</span></p>
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
              <XCircle className="w-6 h-6 text-red-600 shrink-0 mt-1" />
              <div>
                <h3 className="text-lg font-bold text-red-900 mb-2">Sync Failed</h3>
                <p className="text-red-800">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Upload History Section */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
            <Clock className="w-6 h-6 text-blue-600" />
            Backup History
            {loadingHistory && (
              <Loader className="w-5 h-5 text-blue-500 animate-spin ml-2" />
            )}
          </h2>
          
          {loadingHistory ? (
            <div className="text-center py-8">
              <Loader className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-3" />
              <p className="text-gray-600">Loading backup history...</p>
            </div>
          ) : hasUploadHistory ? (
            <div className="space-y-4">
              {uploadHistory.map((item) => (
                <div
                  key={item.id || `${item.filename}-${item.uploadedAt}`}
                  className="p-5 rounded-xl border-l-4 bg-green-50 border-green-500 transition-all hover:shadow-md"
                >
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 mb-1">{item.filename || 'Unknown File'}</p>
                        <p className="text-sm text-gray-600 mb-2">
                          {item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : 'Unknown Date'}
                        </p>
                        
                        <div className="flex flex-wrap gap-3 text-xs mt-2">
                          {item.recordsMerged !== undefined && (
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              📊 {item.recordsMerged} merged
                            </span>
                          )}
                          {item.duplicatesSkipped !== undefined && (
                            <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded">
                              ⏭️ {item.duplicatesSkipped} skipped
                            </span>
                          )}
                          {item.fileSize && (
                            <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                              💾 {item.fileSize}
                            </span>
                          )}
                          {item.status && (
                            <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                              {item.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.status && (
                        <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-green-100 text-green-800">
                          {item.status}
                        </span>
                      )}
                      <button
                        onClick={() => handleDelete(item.id, item.filename || 'Backup')}
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
          ) : (
            <div className="text-center py-8 bg-gray-50 rounded-xl">
              <Database className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 mb-1">No backup history found</p>
              <p className="text-sm text-gray-500">Upload your first backup file to get started</p>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="bg-linear-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mt-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
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
                  <span className="font-semibold">Merge:</span> Only new records are inserted into the main database (_Datos)
                </li>
                <li className="pl-2">
                  <span className="font-semibold">Cleanup:</span> Staging database and temporary files are automatically removed
                </li>
              </ol>
              <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                <p className="font-semibold mb-2">✅ Features:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Automatic duplicate prevention</li>
                  <li>Safe merge without data loss</li>
                  <li>Detailed statistics on every sync</li>
                  <li>Automatic cleanup of temporary resources</li>
                  <li><strong>One backup at a time policy</strong> - Delete old backup before uploading new</li>
                </ul>
              </div>
              <div className="mt-4 p-3 bg-amber-100 rounded-lg border border-amber-300">
                <p className="font-semibold mb-1 text-amber-900">⚠️ Important:</p>
                <p className="text-xs text-amber-800">
                  Only one backup can be active at a time. You must delete the existing backup before uploading a new one. This ensures data integrity and prevents conflicts.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}