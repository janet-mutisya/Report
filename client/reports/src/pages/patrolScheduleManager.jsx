import { useState, useEffect, useCallback } from "react";
import { 
  Calendar, 
  Clock, 
  Save, 
  Trash2, 
  Plus, 
  AlertCircle, 
  CheckCircle, 
  Building2, 
  Settings,
  RefreshCw,
  Edit3,
  Sun,
  Moon,
  Shield
} from "lucide-react";

export default function PatrolScheduleManager() {
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [availableClients, setAvailableClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingClient, setEditingClient] = useState(null);
  const [formData, setFormData] = useState({
    clientId: "",
    patrolsPerDay: 11,
    patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    scheduleType: "daily",
    weekendPatrols: "",
    customIntervalDays: "",
    shiftType: "Day/Night"
  });

  const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
  const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const shiftTypes = [
    { value: "Day", label: "Day Shift", icon: Sun, color: "text-yellow-500" },
    { value: "Night", label: "Night Shift", icon: Moon, color: "text-blue-500" },
    { value: "Day/Night", label: "Day & Night Shifts", icon: Shield, color: "text-green-500" }
  ];

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      // Fetch all three endpoints to get complete data
      const [schedulesRes, clientsRes, availableClientsRes] = await Promise.all([
        fetch(`${API_BASE}/patrol-schedules`),
        fetch(`${API_BASE}/clients`),
        fetch(`${API_BASE}/patrol-schedules/available-clients`)
      ]);

      if (!schedulesRes.ok) throw new Error(`Schedules API returned ${schedulesRes.status}`);
      if (!clientsRes.ok) throw new Error(`Clients API returned ${clientsRes.status}`);
      if (!availableClientsRes.ok) throw new Error(`Available clients API returned ${availableClientsRes.status}`);

      const schedulesData = await schedulesRes.json();
      const clientsData = await clientsRes.json();
      const availableClientsData = await availableClientsRes.json();

      console.log('📋 Schedules data:', schedulesData);
      console.log('👥 Clients data:', clientsData);
      console.log('🟢 Available clients data:', availableClientsData);

      // Process schedules data
      if (schedulesData.success) {
        const activeSchedules = schedulesData.schedules.filter(schedule => 
          schedule.PatrolsPerDay !== null && schedule.PatrolDays !== null
        );
        
        const transformedSchedules = activeSchedules.map(schedule => ({
          clientId: schedule.ClientID,
          clientName: schedule.ClientName,
          patrolsPerDay: schedule.PatrolsPerDay,
          patrolDays: schedule.PatrolDays,
          scheduleType: schedule.ScheduleType,
          weekendPatrols: schedule.WeekendPatrols,
          customIntervalDays: schedule.CustomInterval,
          shiftType: schedule.ShiftType || "Day/Night"
        }));
        
        setSchedules(transformedSchedules);
      }

      // Process clients data
      let clientsList = Array.isArray(clientsData) ? clientsData : 
                      clientsData.success && Array.isArray(clientsData.clients) ? clientsData.clients :
                      Array.isArray(clientsData.data) ? clientsData.data : [];

      const formattedClients = clientsList
        .filter(client => {
          const id = client.cue_iid || client.id;
          return id !== undefined && id !== null && id !== '';
        })
        .map((client, index) => ({
          id: client.cue_iid || client.id,
          name: client.cue_cnombre || client.name || `Client ${index + 1}`,
          email: client.cue_cemail || client.email || "unknown@company.com"
        }));

      setClients(formattedClients);
      
      // Set available clients directly from the API
      if (availableClientsData.success) {
        setAvailableClients(availableClientsData.availableClients || []);
      } else {
        // Fallback: calculate available clients manually
        const available = formattedClients.filter(client => 
          !schedulesData.schedules?.some(schedule => 
            schedule.ClientID === client.id && schedule.PatrolsPerDay !== null
          )
        );
        setAvailableClients(available);
      }
      
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(`Failed to load data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDayToggle = (day) => {
    const currentDays = formData.patrolDays.split(",").filter(d => d.trim());
    const dayIndex = currentDays.indexOf(day);

    if (dayIndex > -1) {
      currentDays.splice(dayIndex, 1);
    } else {
      currentDays.push(day);
    }

    setFormData({ 
      ...formData, 
      patrolDays: currentDays.join(",") || "Mon,Tue,Wed,Thu,Fri,Sat,Sun" 
    });
  };

  const handleEdit = (schedule) => {
    setEditingClient(schedule.clientId);
    setFormData({
      clientId: schedule.clientId.toString(),
      patrolsPerDay: schedule.patrolsPerDay || 11,
      patrolDays: schedule.patrolDays || "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      scheduleType: schedule.scheduleType || "daily",
      weekendPatrols: schedule.weekendPatrols?.toString() || "",
      customIntervalDays: schedule.customIntervalDays?.toString() || "",
      shiftType: schedule.shiftType || "Day/Night"
    });
    setError("");
    setSuccess("");
  };

  const handleNew = () => {
    console.log('Available clients:', availableClients); // Debug log
    
    if (availableClients.length === 0) {
      setError("All clients already have schedules configured. Please edit existing schedules instead.");
      return;
    }
    
    setEditingClient("new");
    setFormData({
      clientId: "",
      patrolsPerDay: 11,
      patrolDays: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      scheduleType: "daily",
      weekendPatrols: "",
      customIntervalDays: "",
      shiftType: "Day/Night"
    });
    setError("");
    setSuccess("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        patrolsPerDay: parseInt(formData.patrolsPerDay),
        patrolDays: formData.patrolDays,
        scheduleType: formData.scheduleType,
        weekendPatrols: formData.weekendPatrols ? parseInt(formData.weekendPatrols) : null,
        customIntervalDays: formData.customIntervalDays ? parseInt(formData.customIntervalDays) : null,
        shiftType: formData.shiftType
      };

      const url = `${API_BASE}/patrol-schedules/client/${formData.clientId}`;
      
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `HTTP error! status: ${response.status}`);
      }

      if (data.success) {
        setSuccess(data.message || "Schedule saved successfully!");
        setEditingClient(null);
        fetchData(); // Refresh all data
      } else {
        throw new Error(data.message || "Failed to save schedule");
      }
    } catch (err) {
      setError(`Error saving schedule: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (clientId) => {
    if (!confirm("Are you sure you want to delete this schedule? This action cannot be undone.")) {
      return;
    }

    setDeleting(clientId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`${API_BASE}/patrol-schedules/client/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patrolsPerDay: null,
          patrolDays: null,
          scheduleType: "daily",
          weekendPatrols: null,
          customIntervalDays: null,
          shiftType: "Day/Night"
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `HTTP error! status: ${response.status}`);
      }

      if (data.success) {
        setSuccess("Schedule deleted successfully!");
        fetchData();
      } else {
        throw new Error(data.message || "Failed to delete schedule");
      }
    } catch (err) {
      setError(`Error deleting schedule: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  const getClientName = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client ? client.name : `Client ${clientId}`;
  };

  const getShiftIcon = (shiftType) => {
    const shift = shiftTypes.find(s => s.value === shiftType) || shiftTypes[2];
    const IconComponent = shift.icon;
    return <IconComponent className={`w-4 h-4 ${shift.color}`} />;
  };

  const getShiftLabel = (shiftType) => {
    const shift = shiftTypes.find(s => s.value === shiftType) || shiftTypes[2];
    return shift.label;
  };

  const clearMessages = () => {
    setError("");
    setSuccess("");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="relative">
            <RefreshCw className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
            <Building2 className="w-8 h-8 text-blue-800 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
          </div>
          <h2 className="text-xl font-semibold text-gray-700 mb-2">Loading Patrol Schedules</h2>
          <p className="text-gray-500">Setting up your security configurations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-8 border border-blue-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-blue-100 p-3 rounded-xl">
                <Settings className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Patrol Schedule Manager</h1>
                <p className="text-gray-600 mt-1">Configure expected patrol checks, schedules, and shift types for each client</p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleNew}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
              >
                <Plus className="w-5 h-5" />
                New Schedule
              </button>
            </div>
          </div>

          {/* Status Messages */}
          {(error || success) && (
            <div className={`p-4 rounded-lg mb-6 flex items-start gap-3 animate-in fade-in duration-300 ${
              error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'
            }`}>
              {error ? (
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              ) : (
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={error ? 'text-red-700' : 'text-green-700'}>{error || success}</p>
              </div>
              <button
                onClick={clearMessages}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ×
              </button>
            </div>
          )}

          {/* Edit/Create Form */}
          {editingClient && (
            <form onSubmit={handleSubmit} className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 mb-6 border-2 border-blue-200 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-blue-600" />
                  {editingClient === "new" ? "Create New Schedule" : "Edit Schedule"}
                </h3>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Client Selection & Basic Configuration */}
                <div className="space-y-4">
                  {/* Client Selection */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-600" />
                      Client Selection
                    </label>
                    <select
                      value={formData.clientId}
                      onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                      className="w-full border-2 border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      required
                      disabled={editingClient !== "new"}
                    >
                      <option value="">Select a Client</option>
                      {editingClient === "new" ? (
                        availableClients.map(client => (
                          <option key={`client-${client.id}`} value={client.id}>
                            {client.name}
                          </option>
                        ))
                      ) : (
                        <option key={`edit-${formData.clientId}`} value={formData.clientId}>
                          {getClientName(parseInt(formData.clientId))}
                        </option>
                      )}
                    </select>
                    {editingClient === "new" && availableClients.length === 0 && (
                      <p className="text-sm text-red-600 mt-2">
                        All clients already have schedules configured. Edit existing schedules instead.
                      </p>
                    )}
                  </div>

                  {/* Shift Type Selection */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Shift Type Configuration
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {shiftTypes.map((shift) => {
                        const IconComponent = shift.icon;
                        return (
                          <button
                            key={shift.value}
                            type="button"
                            onClick={() => setFormData({ ...formData, shiftType: shift.value })}
                            className={`p-3 rounded-lg border-2 transition-all duration-200 ${
                              formData.shiftType === shift.value
                                ? "border-blue-500 bg-blue-50 shadow-md"
                                : "border-gray-200 bg-white hover:border-blue-300"
                            }`}
                          >
                            <div className="flex flex-col items-center gap-1">
                              <IconComponent className={`w-5 h-5 ${shift.color}`} />
                              <span className="text-xs font-medium text-gray-700">
                                {shift.label}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Determines which shift data will be included in automated reports
                    </p>
                  </div>

                  {/* Patrols Configuration */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-600" />
                      Patrols Configuration
                    </label>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Patrols Per Day</label>
                        <input
                          type="number"
                          min="1"
                          max="24"
                          value={formData.patrolsPerDay}
                          onChange={(e) => setFormData({ ...formData, patrolsPerDay: e.target.value })}
                          className="w-full border-2 border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Weekend Patrols (Optional)</label>
                        <input
                          type="number"
                          min="0"
                          max="24"
                          value={formData.weekendPatrols}
                          onChange={(e) => setFormData({ ...formData, weekendPatrols: e.target.value })}
                          className="w-full border-2 border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          placeholder="Same as weekday if empty"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Schedule Configuration */}
                <div className="space-y-4">
                  {/* Schedule Type */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Schedule Type
                    </label>
                    <select
                      value={formData.scheduleType}
                      onChange={(e) => setFormData({ ...formData, scheduleType: e.target.value })}
                      className="w-full border-2 border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      required
                    >
                      <option value="daily">Daily Schedule</option>
                      <option value="weekly">Weekly Schedule</option>
                      <option value="custom">Custom Interval</option>
                    </select>
                  </div>

                  {/* Custom Interval */}
                  {formData.scheduleType === "custom" && (
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Custom Interval (Days)</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.customIntervalDays}
                        onChange={(e) => setFormData({ ...formData, customIntervalDays: e.target.value })}
                        className="w-full border-2 border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                        required={formData.scheduleType === "custom"}
                        placeholder="e.g., 3 for every 3 days"
                      />
                    </div>
                  )}

                  {/* Patrol Days */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-blue-600" />
                      Patrol Days
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {daysOfWeek.map(day => {
                        const isSelected = formData.patrolDays.split(",").includes(day);
                        return (
                          <button
                            key={`day-${day}`}
                            type="button"
                            onClick={() => handleDayToggle(day)}
                            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 ${
                              isSelected
                                ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                                : "bg-white text-gray-700 border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                            }`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Configuration Preview */}
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <h4 className="font-semibold text-blue-800 mb-2">Configuration Preview</h4>
                    <div className="text-sm text-blue-700 space-y-1">
                      <div className="flex justify-between">
                        <span>Shift Type:</span>
                        <span className="font-medium flex items-center gap-1">
                          {getShiftIcon(formData.shiftType)}
                          {getShiftLabel(formData.shiftType)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Patrols/Day:</span>
                        <span className="font-medium">{formData.patrolsPerDay}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Active Days:</span>
                        <span className="font-medium">{formData.patrolDays.split(',').length} days</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-blue-200">
                <button
                  type="submit"
                  disabled={saving || (editingClient === "new" && availableClients.length === 0)}
                  className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-all duration-200 shadow-lg shadow-green-200 disabled:shadow-none"
                >
                  <Save className="w-4 h-4" />
                  {saving ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Saving...
                    </span>
                  ) : (
                    "Save Schedule"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingClient(null)}
                  className="px-6 py-3 border-2 border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Schedules Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-blue-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Client</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Shift Type</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Patrols/Day</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Active Days</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Schedule Type</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Weekend</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {schedules.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-12 text-center">
                        <div className="text-gray-400 mb-2">
                          <Settings className="w-12 h-12 mx-auto opacity-50" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-500 mb-2">No Schedules Configured</h3>
                        <p className="text-gray-400 mb-4">Get started by creating your first patrol schedule</p>
                        <div className="text-sm text-gray-500 mt-4">
                          {availableClients.length === 0 ? (
                            <p>All clients have schedules configured. Use the "New Schedule" button above to manage existing schedules.</p>
                          ) : (
                            <p>Click the "New Schedule" button above to get started.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    schedules.map((schedule) => (
                      <tr 
                        key={`schedule-${schedule.clientId}`}
                        className="hover:bg-blue-50 transition-colors group"
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-semibold text-gray-900 group-hover:text-blue-900">
                            {schedule.clientName || getClientName(schedule.clientId)}
                          </div>
                          <div className="text-sm text-gray-500">ID: {schedule.clientId}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {getShiftIcon(schedule.shiftType)}
                            <span className="font-medium text-gray-700">
                              {getShiftLabel(schedule.shiftType)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                            {schedule.patrolsPerDay || "Not Set"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {daysOfWeek.map(day => (
                              <span
                                key={`${schedule.clientId}-${day}`}
                                className={`text-xs px-2 py-1 rounded ${
                                  schedule.patrolDays?.includes(day)
                                    ? "bg-green-100 text-green-800"
                                    : "bg-gray-100 text-gray-500 opacity-50"
                                }`}
                              >
                                {day}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            schedule.scheduleType === "daily" 
                              ? "bg-blue-100 text-blue-800"
                              : schedule.scheduleType === "weekly"
                              ? "bg-green-100 text-green-800"
                              : "bg-purple-100 text-purple-800"
                          }`}>
                            {schedule.scheduleType || "daily"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-gray-700 font-medium">
                            {schedule.weekendPatrols || schedule.patrolsPerDay || "Same"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(schedule)}
                              className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors"
                            >
                              <Edit3 className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(schedule.clientId)}
                              disabled={deleting === schedule.clientId}
                              className="text-red-600 hover:text-red-800 font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              {deleting === schedule.clientId ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                              {deleting === schedule.clientId ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {schedules.length > 0 && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">
                    Total schedules: <strong>{schedules.length}</strong> • Available clients: <strong>{availableClients.length}</strong>
                  </span>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <Sun className="w-3 h-3 text-yellow-500" />
                      <span>Day Shift</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Moon className="w-3 h-3 text-blue-500" />
                      <span>Night Shift</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Shield className="w-3 h-3 text-green-500" />
                      <span>Both Shifts</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Information Panel */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border-2 border-blue-200">
          <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            How Patrol Scheduling Works
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-blue-800 mb-3">Configuration Guide</h4>
              <ul className="space-y-2 text-blue-700">
                <li className="flex items-start gap-2">
                  <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                  <span><strong>Shift Type:</strong> Determines which shift data appears in automated reports</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                  <span><strong>Patrols Per Day:</strong> Expected number of security checks per active day</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                  <span><strong>Active Days:</strong> Select which days patrols should occur</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                  <span><strong>Weekend Patrols:</strong> Optional different count for Saturday/Sunday</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-blue-800 mb-3">Schedule Types & Shift Configuration</h4>
              <ul className="space-y-2 text-blue-700">
                <li>• <strong>Daily:</strong> Patrols occur every day on selected days</li>
                <li>• <strong>Weekly:</strong> Patrols occur on specific days each week</li>
                <li>• <strong>Custom Interval:</strong> Patrols repeat every X days</li>
              </ul>
              <div className="mt-4 p-3 bg-blue-100 rounded-lg border border-blue-200">
                <h5 className="font-semibold text-blue-800 mb-2">Shift Types Explained:</h5>
                <div className="space-y-2 text-sm text-blue-700">
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4 text-yellow-500" />
                    <span><strong>Day Shift:</strong> 6:00 AM - 6:00 PM patrol data only</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Moon className="w-4 h-4 text-blue-500" />
                    <span><strong>Night Shift:</strong> 6:00 PM - 6:00 AM patrol data only</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-500" />
                    <span><strong>Both Shifts:</strong> All patrol data included (24 hours)</span>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm text-blue-600">
                <strong>Note:</strong> These schedules determine "Expected Checks" in performance reports and 
                integrate with the automated report scheduler for shift-specific reporting.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}