import { useState, useEffect } from 'react';
import {
  Users,
  Search,
  Link as LinkIcon,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Loader,
  Eye,
  Filter,
  Download,
  RefreshCw,
  UserCheck,
  Shield
} from 'lucide-react';

// Read environment variable ONCE at the top
const API_URL = import.meta.env.VITE_API_URL;
console.log("API URL:", API_URL); // Debugging line

export default function AdminDashboard() {
  const [clients, setClients] = useState([]);
  const [bmAccounts, setBMAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedClient, setSelectedClient] = useState(null);
  const [linking, setLinking] = useState(false);
  const [loadingBMAccounts, setLoadingBMAccounts] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');

      const clientsResponse = await fetch(`${API_URL}/admin/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const clientsData = await clientsResponse.json();
      setClients(clientsData.clients || []);

    } catch (err) {
      console.error('Failed to load admin data:', err);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadBMAccounts = async () => {
    setLoadingBMAccounts(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/admin/bm-accounts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setBMAccounts(data.accounts || []);
    } catch (err) {
      console.error('Failed to load BM accounts:', err);
      setError('Failed to load BM accounts. Please try again.');
    } finally {
      setLoadingBMAccounts(false);
    }
  };

  const handleManualLink = async (clientId, accountNumber) => {
    if (!window.confirm(`Link client to account ${accountNumber}?`)) return;

    setLinking(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/admin/link-account`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ clientId, accountNumber })
      });

      const data = await response.json();

      if (data.success) {
        alert('Account linked successfully!');
        loadData();
        setSelectedClient(null);
      } else {
        alert(data.message || 'Failed to link account');
      }

    } catch (err) {
      console.error('Link error:', err);
      alert('Failed to link account. Please try again.');
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (clientId) => {
    if (!window.confirm('Unlink this account? The client will lose access to their dashboard.')) return;

    setError(null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/admin/unlink-account`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ clientId })
      });

      const data = await response.json();

      if (data.success) {
        alert('Account unlinked successfully');
        loadData();
      } else {
        alert(data.message || 'Failed to unlink account');
      }

    } catch (err) {
      console.error('Unlink error:', err);
      alert('Failed to unlink account');
    }
  };

  const exportToCSV = () => {
    const headers = ['Email', 'Company', 'Account Number', 'Status', 'Created At'];
    const rows = filteredClients.map(client => [
      client.email,
      client.companyName || '',
      client.accountNumber || 'Not Linked',
      client.status,
      new Date(client.createdAt).toLocaleDateString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clients-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const filteredClients = clients.filter(client => {
    const matchesSearch = 
      client.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.companyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.accountNumber || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = 
      statusFilter === 'all' || client.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: clients.length,
    active: clients.filter(c => c.status === 'active').length,
    pending: clients.filter(c => c.status === 'pending_link').length,
    inactive: clients.filter(c => c.status === 'inactive').length
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          </div>
          <p className="text-gray-600">Manage client accounts and manual linking</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-red-800">{error}</p>
            <button 
              onClick={() => setError(null)}
              className="ml-auto text-red-600 hover:text-red-800"
            >
              ×
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-6 mb-8 border border-gray-100">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-64">
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by email, company, or account..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="pending_link">Pending Link</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <button
              onClick={loadData}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>

            <button
              onClick={exportToCSV}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
            <p className="text-sm text-gray-600 mt-1">Total Clients</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
            <p className="text-3xl font-bold text-green-600">{stats.active}</p>
            <p className="text-sm text-gray-600 mt-1">Active & Linked</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
            <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
            <p className="text-sm text-gray-600 mt-1">Pending Link</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="p-2 bg-red-100 rounded-lg">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <p className="text-3xl font-bold text-red-600">{stats.inactive}</p>
            <p className="text-sm text-gray-600 mt-1">Inactive</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-8">
          <div className="p-6 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 text-lg">Client Accounts</h3>
            <p className="text-sm text-gray-600 mt-1">
              Showing {filteredClients.length} of {clients.length} clients
            </p>
          </div>

          <div className="overflow-x-auto">
            {filteredClients.length > 0 ? (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredClients.map((client) => (
                    <tr key={client.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{client.email}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{client.companyName || '-'}</td>
                      <td className="px-6 py-4 text-sm">
                        {client.accountNumber ? (
                          <span className="font-mono text-blue-600">{client.accountNumber}</span>
                        ) : (
                          <span className="text-gray-400">Not Linked</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {client.status === 'active' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                            <CheckCircle className="w-3 h-3" />
                            Active
                          </span>
                        )}
                        {client.status === 'pending_link' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
                            <Clock className="w-3 h-3" />
                            Pending
                          </span>
                        )}
                        {client.status === 'inactive' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
                            <XCircle className="w-3 h-3" />
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {new Date(client.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {client.status === 'pending_link' && (
                            <button
                              onClick={() => setSelectedClient(client)}
                              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition flex items-center gap-1"
                            >
                              <LinkIcon className="w-3 h-3" />
                              Link
                            </button>
                          )}
                          {client.status === 'active' && (
                            <button
                              onClick={() => handleUnlink(client.id)}
                              className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition"
                            >
                              Unlink
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-12 text-center">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No clients found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">Manual Account Linking</h3>
              <p className="text-sm text-gray-600 mt-1">
                Link {selectedClient.email} to BM Security account
              </p>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <h4 className="font-semibold text-gray-900 mb-2">Client Information</h4>
                <div className="space-y-1 text-sm">
                  <p><strong>Email:</strong> {selectedClient.email}</p>
                  <p><strong>Company:</strong> {selectedClient.companyName || 'Not specified'}</p>
                  <p><strong>Created:</strong> {new Date(selectedClient.createdAt).toLocaleString()}</p>
                </div>
              </div>

              {!loadingBMAccounts && bmAccounts.length === 0 && (
                <button
                  onClick={loadBMAccounts}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-2"
                >
                  <Shield className="w-5 h-5" />
                  Load BM Security Accounts
                </button>
              )}

              {loadingBMAccounts && (
                <div className="text-center py-8">
                  <Loader className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
                  <p className="text-gray-600">Loading BM accounts...</p>
                </div>
              )}

              {bmAccounts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900 mb-3">
                    Select BM Security Account ({bmAccounts.length} available)
                  </h4>
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {bmAccounts.map((account) => (
                      <button
                        key={account.cue_iid}
                        onClick={() => handleManualLink(selectedClient.id, account.cue_ncuenta)}
                        disabled={linking}
                        className="w-full p-4 text-left border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition disabled:opacity-50"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-gray-900">
                              {account.cue_cnombre || account.cue_cempresa || 'Unnamed Account'}
                            </p>
                            <p className="text-sm text-gray-600 mt-1">
                              Account: <span className="font-mono">{account.cue_ncuenta}</span>
                            </p>
                          </div>
                          <UserCheck className="w-5 h-5 text-blue-600" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => setSelectedClient(null)}
                className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}