import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Users, TrendingUp, Edit2, Save, X, Search, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

const API_BASE = 'http://localhost:5000/api/patrol-schedules';

export default function PatrolScheduleManager() {
  const [clients, setClients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingClient, setEditingClient] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);

  const fetchClients = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/all`);
      const data = await response.json();
      
      if (data.success) {
        setClients(data.data.clients);
      } else {
        showNotification('Failed to fetch clients', 'error');
      }
    } catch (error) {
      showNotification('Failed to fetch clients', 'error');
      console.error('Error fetching clients:', error);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const startEdit = (client) => {
    setEditingClient(client.ClientID);
    setEditForm({
      patrolsPerDay: client.PatrolsPerDay,
      patrolDays: client.PatrolDays,
      weekendPatrols: client.WeekendPatrols,
      shiftType: client.ShiftType,
      scheduleType: client.ScheduleType || 'daily',
      customIntervalDays: client.CustomIntervalDays || null
    });
  };

  const cancelEdit = () => {
    setEditingClient(null);
    setEditForm({});
  };

  const saveSchedule = async (clientId) => {
    try {
      setSaving(true);
      const response = await fetch(`${API_BASE}/${clientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      
      const data = await response.json();
      
      if (data.success) {
        showNotification('Schedule updated successfully!', 'success');
        await fetchClients();
        cancelEdit();
      } else {
        showNotification(data.message || 'Failed to update schedule', 'error');
      }
    } catch (error) {
      showNotification('Error saving schedule', 'error');
      console.error('Error saving schedule:', error);
    } finally {
      setSaving(false);
    }
  };

  const filteredClients = clients.filter(client => {
    return client.ClientName.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const stats = {
    total: clients.length,
    avgPatrols: clients.length > 0 
      ? (clients.reduce((sum, c) => sum + c.WeeklyTotal, 0) / clients.length).toFixed(0)
      : 0,
    totalWeekly: clients.reduce((sum, c) => sum + c.WeeklyTotal, 0)
  };

  const dayOptions = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const toggleDay = (day) => {
    const currentDays = editForm.patrolDays.split(',').map(d => d.trim());
    const newDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day];
    
    setEditForm({ ...editForm, patrolDays: newDays.join(',') });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Patrol Schedule Manager</h1>
          <p className="text-gray-600">Manage client patrol schedules and monitoring</p>
        </div>

        {/* Notification */}
        {notification && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            notification.type === 'success' 
              ? 'bg-green-100 text-green-800 border border-green-200' 
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {notification.type === 'success' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            <span>{notification.message}</span>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Scheduled Patrol Clients</p>
                <p className="text-3xl font-bold text-gray-800">{stats.total}</p>
              </div>
              <Users className="w-12 h-12 text-blue-500 opacity-20" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-orange-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Avg Weekly Patrols</p>
                <p className="text-3xl font-bold text-gray-800">{stats.avgPatrols}</p>
              </div>
              <TrendingUp className="w-12 h-12 text-orange-500 opacity-20" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Total Weekly Patrols</p>
                <p className="text-3xl font-bold text-gray-800">{stats.totalWeekly}</p>
              </div>
              <Calendar className="w-12 h-12 text-purple-500 opacity-20" />
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex gap-4 items-center w-full md:w-auto">
              <div className="relative flex-1 md:flex-initial">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search clients..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full md:w-64"
                />
              </div>
              <button
                onClick={fetchClients}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Clients Table */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Client
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Schedule
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Patrol Days
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Weekly Total
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredClients.map((client) => (
                  <React.Fragment key={client.ClientID}>
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-gray-800">{client.ClientName}</p>
                          <p className="text-sm text-gray-500">ID: {client.ClientID}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700">
                            {client.PatrolsPerDay} per day
                            {client.WeekendPatrols !== client.PatrolsPerDay && (
                              <span className="text-gray-500"> / {client.WeekendPatrols} weekend</span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-700">{client.PatrolDays}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-blue-600">{client.WeeklyTotal}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {editingClient !== client.ClientID && (
                          <button
                            onClick={() => startEdit(client)}
                            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {editingClient === client.ClientID && (
                      <tr>
                        <td colSpan="5" className="px-6 py-6 bg-gray-50">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="font-semibold text-gray-800">Edit Schedule for {client.ClientName}</h4>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => saveSchedule(client.ClientID)}
                                  disabled={saving}
                                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                  <Save className="w-4 h-4" />
                                  {saving ? 'Saving...' : 'Save Changes'}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={saving}
                                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                  <X className="w-4 h-4" />
                                  Cancel
                                </button>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Patrols Per Day (Weekday)
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  max="50"
                                  value={editForm.patrolsPerDay}
                                  onChange={(e) => setEditForm({ ...editForm, patrolsPerDay: parseInt(e.target.value) })}
                                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Weekend Patrols Per Day
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  max="50"
                                  value={editForm.weekendPatrols}
                                  onChange={(e) => setEditForm({ ...editForm, weekendPatrols: parseInt(e.target.value) })}
                                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Shift Type
                                </label>
                                <select
                                  value={editForm.shiftType}
                                  onChange={(e) => setEditForm({ ...editForm, shiftType: e.target.value })}
                                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="Day/Night">Day/Night</option>
                                  <option value="Day Only">Day Only</option>
                                  <option value="Night Only">Night Only</option>
                                  <option value="24/7">24/7</option>
                                </select>
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Schedule Type
                                </label>
                                <select
                                  value={editForm.scheduleType}
                                  onChange={(e) => setEditForm({ ...editForm, scheduleType: e.target.value })}
                                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="daily">Daily</option>
                                  <option value="custom">Custom Interval</option>
                                </select>
                              </div>
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Patrol Days
                              </label>
                              <div className="flex gap-2 flex-wrap">
                                {dayOptions.map((day) => (
                                  <button
                                    key={day}
                                    onClick={() => toggleDay(day)}
                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                      editForm.patrolDays.split(',').map(d => d.trim()).includes(day)
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    }`}
                                  >
                                    {day}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {filteredClients.length === 0 && (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No clients found matching your criteria</p>
            </div>
          )}
        </div>

        {/* Footer Stats */}
        <div className="mt-6 text-center text-sm text-gray-600">
          Showing {filteredClients.length} of {clients.length} clients
        </div>
      </div>
    </div>
  );
}