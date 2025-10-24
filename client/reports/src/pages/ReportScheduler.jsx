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
  Play
} from "lucide-react";
import dayjs from "dayjs";

export default function ReportScheduler() {
  // --- State management ---
  const [clients, setClients] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [frequency, setFrequency] = useState(1); // 1=daily, 2=weekly, 3=monthly
  const [intervalDays, setIntervalDays] = useState(1);
  const [nextRun, setNextRun] = useState("");
  const [email, setEmail] = useState("");
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  // --- Fetch clients ---
  const fetchClients = useCallback(async () => {
    try {
      console.log("➡️ Fetching clients...");
      const res = await fetch("http://localhost:5000/api/clients");
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
      console.error("❌ Failed to fetch clients:", err);
      setStatus({ type: "error", message: "Failed to load clients." });
    }
  }, []);

  // --- Fetch schedules ---
  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:5000/api/schedules");
      const data = await res.json();
      
      if (data.success) {
        setSchedules(data.schedules || []);
      } else {
        throw new Error(data.message || "Failed to fetch schedules");
      }
    } catch (err) {
      console.error("❌ Failed to fetch schedules:", err);
      setStatus({ type: "error", message: "Failed to load schedules." });
    }
  }, []);

  useEffect(() => {
    fetchClients();
    fetchSchedules();
  }, [fetchClients, fetchSchedules]);

  // --- Handle selecting a client ---
  const handleSelectClient = (e) => {
    const selectedId = e.target.value ? Number(e.target.value) : "";
    setSelectedClient(selectedId);
    
    // Auto-fill email if client is selected
    if (selectedId) {
      const client = clients.find(c => c.id === selectedId);
      if (client && client.email) {
        setEmail(client.email);
      }
    }
    console.log("👤 Selected client ID:", selectedId);
  };

  // --- Handle save/update schedule ---
  const handleSaveSchedule = async () => {
    try {
      setLoading(true);
      
      if (!selectedClient || isNaN(selectedClient)) {
        throw new Error("Please select a valid client.");
      }
      if (!nextRun) {
        throw new Error("Please set the next run date/time.");
      }
      if (!email) {
        throw new Error("Please enter an email address.");
      }

      const scheduleData = {
        rep_iidcuenta: selectedClient,
        rep_ntipo: 1, // Default report type
        rep_tproximoenvio: dayjs(nextRun).toISOString(),
        rep_nfrecuencia: frequency,
        rep_cmail: email,
        rep_nCadaUnidadTiempo: intervalDays,
        rep_cMailRuteoSMS: "", // Optional
        rep_cSMSParaInforme: "", // Optional
      };

      console.log("📝 Saving schedule:", scheduleData);

      let res;
      if (editingSchedule) {
        // Update existing schedule
        res = await fetch(`http://localhost:5000/api/schedules/${editingSchedule.rep_idKey}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scheduleData),
        });
      } else {
        // Create new schedule using upsert
        res = await fetch("http://localhost:5000/api/schedules/upsert", {
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
      console.error("❌ Save failed:", err);
      setStatus({ type: "error", message: err.message });
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
  };

  // --- Handle delete schedule ---
  const handleDeleteSchedule = async (scheduleId) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;

    try {
      const res = await fetch(`http://localhost:5000/api/schedules/${scheduleId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Failed to delete schedule");
      }

      setStatus({ type: "success", message: "Schedule deleted successfully!" });
      fetchSchedules();
    } catch (err) {
      console.error("❌ Delete failed:", err);
      setStatus({ type: "error", message: err.message });
    }
  };

  // --- Handle run schedule now ---
  const handleRunNow = async (schedule) => {
    try {
      setLoading(true);
      
      // Update next run to now to trigger immediate execution
      const scheduleData = {
        ...schedule,
        rep_tproximoenvio: dayjs().toISOString()
      };

      const res = await fetch(`http://localhost:5000/api/schedules/${schedule.rep_idKey}`, {
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
      console.error("❌ Run now failed:", err);
      setStatus({ type: "error", message: err.message });
    } finally {
      setLoading(false);
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

  // --- Render ---
  return (
    <div className="max-w-6xl mx-auto mt-8 space-y-8">
      {/* Header */}
      <div className="bg-white shadow-md rounded-xl p-6">
        <h2 className="text-2xl font-bold flex items-center gap-2 mb-2">
          <Settings className="text-blue-500" /> Automated Report Scheduler
        </h2>
        <p className="text-gray-600">
          Schedule automated security reports to be generated and sent via email
        </p>
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
              className="border border-gray-300 p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- Select Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.email && `(${c.email})`}
                </option>
              ))}
            </select>
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
              className="border border-gray-300 p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
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
                className="border border-gray-300 p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Next Run */}
          <div className="mb-6">
            <label className="block text-gray-600 mb-2 font-medium flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Next Run Date & Time
            </label>
            <input
              type="datetime-local"
              value={nextRun}
              onChange={(e) => setNextRun(e.target.value)}
              className="border border-gray-300 p-3 w-full rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
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
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" /> Active Schedules
          </h3>
          
          {schedules.length === 0 ? (
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
                      <div>
                        <h4 className="font-semibold text-gray-900">
                          {client?.name || `Client #${schedule.rep_iidcuenta}`}
                        </h4>
                        <p className="text-sm text-gray-600">{schedule.rep_cmail}</p>
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
                    
                    <div className="grid grid-cols-2 gap-2 text-sm">
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
                    </div>
                    
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