import { useEffect, useState, useCallback } from "react";
import { 
  Calendar, 
  Clock, 
  Send, 
  AlertCircle, 
  CheckCircle, 
  Building2, 
  Mail,
  Repeat,
  Settings,
  Trash2,
  Edit3,
  Play,
  Pause,
  History,
  RefreshCw
} from "lucide-react";
import dayjs from "dayjs";

export default function ReportScheduler() {
  // --- State management ---
  const [clients, setClients] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [frequency, setFrequency] = useState(1);
  const [intervalDays, setIntervalDays] = useState(1);
  const [nextRun, setNextRun] = useState("");
  const [email, setEmail] = useState("");
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [reportType, setReportType] = useState("weekly");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [endOption, setEndOption] = useState("never");
  const [occurrences, setOccurrences] = useState(1);
  const [endDate, setEndDate] = useState("");
  const [selectedSchedules, setSelectedSchedules] = useState([]);

  const API_BASE = "http://localhost:5000/api";

  // --- Enhanced API Error Handler ---
  const handleApiError = (error, operation) => {
    console.error(`❌ ${operation} failed:`, error);
    
    if (error.message.includes("404")) {
      return `API endpoint not found. Please check if the server is running.`;
    } else if (error.message.includes("400")) {
      return `Invalid request. Check your data and try again.`;
    } else if (error.message.includes("Network Error")) {
      return `Network error. Please check your connection.`;
    } else if (error.message.includes("500")) {
      return `Server error. Please try again later.`;
    }
    
    return error.message || `Failed to ${operation}`;
  };

  // --- Fetch clients ---
  const fetchClients = useCallback(async () => {
    try {
      console.log("➡️ Fetching clients...");
      const res = await fetch(`${API_BASE}/clients`);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();

      if (!Array.isArray(data)) {
        console.error("Invalid clients response:", data);
        return;
      }

      const normalized = data.map((c, idx) => ({
        id: Number(c.id) || idx + 1,
        name: c.name,
        email: c.email,
      }));

      console.log("✅ Normalized clients:", normalized);
      setClients(normalized);
    } catch (err) {
      const errorMessage = handleApiError(err, "load clients");
      console.warn(errorMessage);
    }
  }, [API_BASE]);

  // --- Fetch schedules ---
  const fetchSchedules = useCallback(async () => {
    try {
      setSchedulesLoading(true);
      const res = await fetch(`${API_BASE}/schedules`);
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      const data = await res.json();
      
      if (data.success) {
        setSchedules(data.schedules || []);
      } else {
        throw new Error(data.message || "Failed to fetch schedules");
      }
    } catch (err) {
      const errorMessage = handleApiError(err, "load schedules");
      setStatus({ type: "error", message: errorMessage });
    } finally {
      setSchedulesLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    fetchClients();
    fetchSchedules();
  }, [fetchClients, fetchSchedules]);

  // --- Input Validation ---
  const validateForm = () => {
    const newErrors = {};
    
    if (!selectedClient) newErrors.client = "Please select a client";
    if (!email) newErrors.email = "Email is required";
    if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) newErrors.email = "Invalid email format";
    if (!nextRun) newErrors.nextRun = "Next run date is required";
    if (nextRun && dayjs(nextRun).isBefore(dayjs())) newErrors.nextRun = "Next run must be in the future";
    if (intervalDays < 1) newErrors.interval = "Interval must be at least 1";
    if (endOption === "after" && occurrences < 1) newErrors.occurrences = "Must have at least 1 occurrence";
    if (endOption === "onDate" && (!endDate || dayjs(endDate).isBefore(dayjs(nextRun)))) {
      newErrors.endDate = "End date must be after next run date";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // --- Handle selecting a client ---
  const handleSelectClient = (e) => {
    const selectedId = e.target.value ? Number(e.target.value) : "";
    setSelectedClient(selectedId);
    
    if (selectedId) {
      const client = clients.find(c => c.id === selectedId);
      if (client && client.email) {
        setEmail(client.email);
      }
    }
  };

  // --- Handle save/update schedule ---
  const handleSaveSchedule = async () => {
    try {
      if (!validateForm()) {
        setStatus({ type: "error", message: "Please fix the errors above" });
        return;
      }

      setLoading(true);
      
      const scheduleData = {
        rep_iidcuenta: selectedClient,
        rep_ntipo: reportType === "daily" ? 1 : reportType === "weekly" ? 2 : 3,
        rep_tproximoenvio: dayjs(nextRun).toISOString(),
        rep_nfrecuencia: frequency,
        rep_cmail: email,
        rep_nCadaUnidadTiempo: intervalDays,
        rep_cMailRuteoSMS: "",
        rep_cSMSParaInforme: "",
        rep_timezone: timezone,
        rep_estado: 1,
        rep_endOption: endOption,
        rep_occurrences: endOption === "after" ? occurrences : null,
        rep_endDate: endOption === "onDate" ? endDate : null,
      };

      console.log("📝 Saving schedule:", scheduleData);

      let res;
      if (editingSchedule) {
        // Update existing schedule
        res = await fetch(`${API_BASE}/schedules/${editingSchedule.rep_idKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scheduleData),
        });
      } else {
        // Create new schedule using upsert
        res = await fetch(`${API_BASE}/schedules/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scheduleData),
        });
      }

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || "Database error while saving schedule.");
      }

      console.log("✅ Schedule saved:", result);
      setStatus({ type: "success", message: `Schedule ${editingSchedule ? 'updated' : 'created'} successfully!` });
      
      // Reset form
      resetForm();
      // Refresh schedules
      fetchSchedules();
      
    } catch (err) {
      const errorMessage = handleApiError(err, "save schedule");
      setStatus({ type: "error", message: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  // --- Handle edit schedule ---
  const handleEditSchedule = (schedule) => {
    setEditingSchedule(schedule);
    setSelectedClient(schedule.rep_iidcuenta);
    setFrequency(schedule.rep_nfrecuencia);
    setIntervalDays(schedule.rep_nCadaUnidadTiempo || 1);
    setNextRun(dayjs(schedule.rep_tproximoenvio).format('YYYY-MM-DDTHH:mm'));
    setEmail(schedule.rep_cmail);
    setReportType(schedule.rep_ntipo === 1 ? "daily" : schedule.rep_ntipo === 2 ? "weekly" : "monthly");
    setTimezone(schedule.rep_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    setEndOption(schedule.rep_endOption || "never");
    setOccurrences(schedule.rep_occurrences || 1);
    setEndDate(schedule.rep_endDate || "");
  };

  // --- Handle delete schedule ---
  const handleDeleteSchedule = async (scheduleId) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;

    try {
      const res = await fetch(`${API_BASE}/schedules/${scheduleId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to delete schedule");
      }

      setStatus({ type: "success", message: "Schedule deleted successfully!" });
      fetchSchedules();
    } catch (err) {
      const errorMessage = handleApiError(err, "delete schedule");
      setStatus({ type: "error", message: errorMessage });
    }
  };

  // --- Handle run schedule now ---
  const handleRunNow = async (schedule) => {
    try {
      setLoading(true);
      
      // Update next run to now to trigger immediate execution
      const scheduleData = {
        ...schedule,
        rep_tproximoenvio: dayjs().toISOString(),
        rep_ultimoejecucion: dayjs().toISOString()
      };

      const res = await fetch(`${API_BASE}/schedules/${schedule.rep_idKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleData),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || "Failed to trigger schedule");
      }

      setStatus({ type: "success", message: "Schedule triggered! Report will be generated and sent shortly." });
      fetchSchedules();
      
    } catch (err) {
      const errorMessage = handleApiError(err, "trigger schedule");
      setStatus({ type: "error", message: errorMessage });
    } finally {
      setLoading(false);
    }
  };

  // --- Toggle schedule status ---
  const handleToggleStatus = async (schedule) => {
    try {
      const newStatus = schedule.rep_estado === 1 ? 0 : 1;
      const scheduleData = {
        ...schedule,
        rep_estado: newStatus
      };

      const res = await fetch(`${API_BASE}/schedules/${schedule.rep_idKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleData),
      });

      if (!res.ok) {
        throw new Error("Failed to update schedule status");
      }

      setStatus({ type: "success", message: `Schedule ${newStatus === 1 ? 'activated' : 'paused'} successfully!` });
      fetchSchedules();
      
    } catch (err) {
      const errorMessage = handleApiError(err, "update schedule status");
      setStatus({ type: "error", message: errorMessage });
    }
  };

  // --- Bulk operations ---
  const handleBulkDelete = async () => {
    if (!selectedSchedules.length) {
      setStatus({ type: "error", message: "No schedules selected" });
      return;
    }
    
    if (!confirm(`Delete ${selectedSchedules.length} schedule(s)?`)) return;

    try {
      await Promise.all(
        selectedSchedules.map(id => 
          fetch(`${API_BASE}/schedules/${id}`, { method: "DELETE" })
        )
      );
      setStatus({ type: "success", message: `${selectedSchedules.length} schedule(s) deleted successfully!` });
      fetchSchedules();
      setSelectedSchedules([]);
    } catch (err) {
      const errorMessage = handleApiError(err, "delete schedules in bulk");
      setStatus({ type: "error", message: errorMessage });
    }
  };

  const handleBulkToggle = async (newStatus) => {
    if (!selectedSchedules.length) {
      setStatus({ type: "error", message: "No schedules selected" });
      return;
    }

    try {
      await Promise.all(
        selectedSchedules.map(id => 
          fetch(`${API_BASE}/schedules/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rep_estado: newStatus })
          })
        )
      );
      setStatus({ type: "success", message: `${selectedSchedules.length} schedule(s) ${newStatus === 1 ? 'activated' : 'paused'}!` });
      fetchSchedules();
      setSelectedSchedules([]);
    } catch (err) {
      const errorMessage = handleApiError(err, "update schedules in bulk");
      setStatus({ type: "error", message: errorMessage });
    }
  };

  // --- Reset form ---
  const resetForm = () => {
    setSelectedClient("");
    setFrequency(1);
    setIntervalDays(1);
    setNextRun("");
    setEmail("");
    setEditingSchedule(null);
    setErrors({});
    setReportType("weekly");
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setEndOption("never");
    setOccurrences(1);
    setEndDate("");
  };

  // --- Format frequency text ---
  const getFrequencyText = (freq, interval) => {
    switch (freq) {
      case 1: return `Every ${interval} day${interval > 1 ? 's' : ''}`;
      case 2: return `Every ${interval} week${interval > 1 ? 's' : ''}`;
      case 3: return `Every ${interval} month${interval > 1 ? 's' : ''}`;
      default: return 'One-time';
    }
  };

  // --- Retry failed operations ---
  const retryOperation = () => {
    setStatus({ type: "", message: "" });
    fetchClients();
    fetchSchedules();
  };

  return (
    <div className="max-w-7xl mx-auto mt-8 space-y-8">
      {/* Header */}
      <div className="bg-white shadow-md rounded-xl p-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2 mb-2">
              <Settings className="text-blue-500" /> Automated Report Scheduler
            </h2>
            <p className="text-gray-600">
              Schedule automated security reports to be generated and sent via email
            </p>
          </div>
          <button
            onClick={retryOperation}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors"
            title="Retry failed operations"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Schedule Form */}
        <div className="bg-white shadow-md rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            {editingSchedule ? <Edit3 className="w-5 h-5" /> : <Send className="w-5 h-5" />}
            {editingSchedule ? 'Edit Schedule' : 'Create New Schedule'}
          </h3>

          {/* Client Selection */}
          <div className="mb-4">
            <label className="block text-gray-600 mb-2 font-medium">Client</label>
            <select
              value={selectedClient}
              onChange={handleSelectClient}
              className={`border p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.client ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="">-- Select Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.email && `(${c.email})`}
                </option>
              ))}
            </select>
            {errors.client && (
              <div className="text-red-500 text-sm mt-1 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.client}
              </div>
            )}
          </div>

          {/* Email */}
          <div className="mb-4">
            <label className="block text-gray-600 mb-2 font-medium flex items-center gap-2">
              <Mail className="w-4 h-4" /> Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="recipient@company.com"
              className={`border p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.email ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.email && (
              <div className="text-red-500 text-sm mt-1 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.email}
              </div>
            )}
          </div>

          {/* Report Type */}
          <div className="mb-4">
            <label className="block text-gray-600 mb-2 font-medium">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="border border-gray-300 p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="daily">Daily Summary</option>
              <option value="weekly">Weekly Performance</option>
              <option value="monthly">Monthly Analytics</option>
              <option value="incident">Incident Report</option>
            </select>
          </div>

          {/* Frequency Settings */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-gray-600 mb-2 font-medium flex items-center gap-2">
                <Repeat className="w-4 h-4" /> Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(Number(e.target.value))}
                className="border border-gray-300 p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={1}>Daily</option>
                <option value={2}>Weekly</option>
                <option value={3}>Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-600 mb-2 font-medium">Interval</label>
              <input
                type="number"
                min="1"
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                className={`border p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  errors.interval ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {errors.interval && (
                <div className="text-red-500 text-sm mt-1 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {errors.interval}
                </div>
              )}
            </div>
          </div>

          {/* Next Run */}
          <div className="mb-4">
            <label className="block text-gray-600 mb-2 font-medium flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Next Run Date & Time
            </label>
            <input
              type="datetime-local"
              value={nextRun}
              onChange={(e) => setNextRun(e.target.value)}
              className={`border p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                errors.nextRun ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.nextRun && (
              <div className="text-red-500 text-sm mt-1 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {errors.nextRun}
              </div>
            )}
          </div>

          {/* Time Zone */}
          <div className="mb-4">
            <label className="block text-gray-600 mb-2 font-medium">Time Zone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="border border-gray-300 p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Denver">Mountain Time (MT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          {/* Recurrence End */}
          <div className="mb-6">
            <label className="block text-gray-600 mb-2 font-medium">Recurrence End</label>
            <select 
              value={endOption} 
              onChange={(e) => setEndOption(e.target.value)}
              className="border border-gray-300 p-3 w-full rounded-lg mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="never">Never</option>
              <option value="after">After occurrences</option>
              <option value="onDate">On specific date</option>
            </select>
            
            {endOption === "after" && (
              <div>
                <input
                  type="number"
                  min="1"
                  value={occurrences}
                  onChange={(e) => setOccurrences(Number(e.target.value))}
                  placeholder="Number of occurrences"
                  className={`border p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.occurrences ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {errors.occurrences && (
                  <div className="text-red-500 text-sm mt-1 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.occurrences}
                  </div>
                )}
              </div>
            )}
            
            {endOption === "onDate" && (
              <div>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={`border p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                    errors.endDate ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {errors.endDate && (
                  <div className="text-red-500 text-sm mt-1 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.endDate}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSaveSchedule}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {loading ? (
                "Saving..."
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  {editingSchedule ? 'Update Schedule' : 'Create Schedule'}
                </>
              )}
            </button>
            
            {editingSchedule && (
              <button
                onClick={resetForm}
                className="flex items-center gap-2 bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 font-medium transition-colors"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Status Message */}
          {status.message && (
            <div
              className={`mt-4 p-3 rounded-lg flex items-center gap-2 ${
                status.type === "success"
                  ? "bg-green-100 text-green-700 border border-green-200"
                  : "bg-red-100 text-red-700 border border-red-200"
              }`}
            >
              {status.type === "success" ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
              {status.message}
            </div>
          )}
        </div>

        {/* Active Schedules List */}
        <div className="bg-white shadow-md rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5" /> Active Schedules
            </h3>
            
            {selectedSchedules.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleBulkToggle(1)}
                  className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors"
                >
                  Activate
                </button>
                <button
                  onClick={() => handleBulkToggle(0)}
                  className="text-xs bg-yellow-600 text-white px-3 py-1 rounded hover:bg-yellow-700 transition-colors"
                >
                  Pause
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
          
          {schedulesLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-500">Loading schedules...</p>
            </div>
          ) : schedules.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No active schedules</p>
              <p className="text-sm">Create your first schedule to get started</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {schedules.map((schedule) => {
                const client = clients.find(c => c.id === schedule.rep_iidcuenta);
                return (
                  <div key={schedule.rep_idKey} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedSchedules.includes(schedule.rep_idKey)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSchedules(prev => [...prev, schedule.rep_idKey]);
                            } else {
                              setSelectedSchedules(prev => prev.filter(id => id !== schedule.rep_idKey));
                            }
                          }}
                          className="mt-1"
                        />
                        <div>
                          <h4 className="font-semibold text-gray-900">
                            {client?.name || `Client #${schedule.rep_iidcuenta}`}
                          </h4>
                          <p className="text-sm text-gray-600">{schedule.rep_cmail}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRunNow(schedule)}
                          disabled={loading}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Run now"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEditSchedule(schedule)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(schedule.rep_idKey)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                      <div>
                        <span className="text-gray-500">Frequency:</span>
                        <p className="font-medium">
                          {getFrequencyText(schedule.rep_nfrecuencia, schedule.rep_nCadaUnidadTiempo || 1)}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Next Run:</span>
                        <p className="font-medium">
                          {dayjs(schedule.rep_tproximoenvio).format('MMM D, YYYY HH:mm')}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Type:</span>
                        <p className="font-medium capitalize">
                          {schedule.rep_ntipo === 1 ? 'daily' : schedule.rep_ntipo === 2 ? 'weekly' : 'monthly'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Timezone:</span>
                        <p className="font-medium text-xs">
                          {schedule.rep_timezone || 'System'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center mt-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        schedule.rep_estado === 1 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {schedule.rep_estado === 1 ? 'Active' : 'Paused'}
                      </span>
                      
                      <button
                        onClick={() => handleToggleStatus(schedule)}
                        className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        {schedule.rep_estado === 1 ? (
                          <>
                            <Pause className="w-3 h-3" />
                            Pause
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3" />
                            Resume
                          </>
                        )}
                      </button>
                    </div>
                    
                    {schedule.rep_ultimoejecucion && (
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <History className="w-3 h-3" />
                        Last run: {dayjs(schedule.rep_ultimoejecucion).format('MMM D, YYYY HH:mm')}
                      </div>
                    )}
                    
                    {dayjs(schedule.rep_tproximoenvio).isBefore(dayjs()) && (
                      <div className="mt-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded inline-flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Due for execution
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}