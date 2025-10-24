 import { useEffect, useState, useCallback } from "react";
import { Calendar, Clock, Send, AlertCircle, CheckCircle, Building2 } from "lucide-react";
import dayjs from "dayjs";

export default function ReportScheduler() {
  // --- State management ---
  const [clients, setClients] = useState([]);
  const [client, setClient] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });

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

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // --- Handle selecting a client ---
  const handleSelectClient = (e) => {
    const selectedId = e.target.value ? Number(e.target.value) : "";
    setClient(selectedId);
    console.log("👤 Selected client ID:", selectedId);
  };

  // --- Handle save schedule ---
  const handleSave = async () => {
    try {
      if (!client || isNaN(client)) {
        throw new Error("Please select a valid client before saving.");
      }
      if (!startDate || !startTime || !endDate || !endTime) {
        throw new Error("Please select both start and end date/time.");
      }

      const startDateTime = dayjs(`${startDate}T${startTime}`).toISOString();
      const endDateTime = dayjs(`${endDate}T${endTime}`).toISOString();

      const scheduleData = {
        clientId: client,
        startDateTime,
        endDateTime,
        emailEnabled: false, // 🚫 disable auto-emailing
      };

      console.log("📝 Saving schedule:", scheduleData);

      const res = await fetch("http://localhost:5000/api/schedules/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleData),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || "Database error while saving schedule.");
      }

      console.log("✅ Schedule saved:", result);
      setStatus({ type: "success", message: "Schedule saved successfully!" });
    } catch (err) {
      console.error("❌ Save failed:", err);
      setStatus({ type: "error", message: err.message });
    }
  };

  // --- Generate time options (24h format) ---
  const generateTimeOptions = () => {
    const times = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const label = `${h.toString().padStart(2, "0")}:${m
          .toString()
          .padStart(2, "0")}`;
        times.push(label);
      }
    }
    return times;
  };

  // --- Render ---
  return (
    <div className="max-w-3xl mx-auto mt-8 bg-white shadow-md rounded-xl p-6">
      <h2 className="text-2xl font-bold flex items-center gap-2 mb-4">
        <Building2 className="text-blue-500" /> Weekly Report Scheduler
      </h2>

      {/* Client Dropdown */}
      <div className="mb-4">
        <label className="block text-gray-600 mb-1">Select Client</label>
        <select
          value={client}
          onChange={handleSelectClient}
          className="border p-2 w-full rounded-md"
        >
          <option value="">-- Select Client --</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Start Date/Time */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-gray-600 mb-1 flex items-center gap-1">
            <Calendar className="w-4 h-4" /> Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border p-2 w-full rounded-md"
          />
        </div>
        <div>
          <label className="block text-gray-600 mb-1 flex items-center gap-1">
            <Clock className="w-4 h-4" /> Start Time
          </label>
          <select
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="border p-2 w-full rounded-md"
          >
            <option value="">-- Select Time --</option>
            {generateTimeOptions().map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* End Date/Time */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-gray-600 mb-1 flex items-center gap-1">
            <Calendar className="w-4 h-4" /> End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border p-2 w-full rounded-md"
          />
        </div>
        <div>
          <label className="block text-gray-600 mb-1 flex items-center gap-1">
            <Clock className="w-4 h-4" /> End Time
          </label>
          <select
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="border p-2 w-full rounded-md"
          >
            <option value="">-- Select Time --</option>
            {generateTimeOptions().map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
      >
        <Send className="w-4 h-4" /> Save Schedule
      </button>

      {/* Status Message */}
      {status.message && (
        <div
          className={`mt-4 p-3 rounded-md flex items-center gap-2 ${
            status.type === "success"
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
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
  );
}  