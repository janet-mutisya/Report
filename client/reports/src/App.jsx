import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate } from "react-router-dom";
import WeeklyReport from "./pages/WeeklyReport";
import BackupSync from "./pages/BackupSync";
import ReportScheduler from "./pages/ReportScheduler";
import PatrolScheduleManager from "./pages/patrolScheduleManager";
import Signup from "./pages/signup";
import Login from "./pages/login";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import { Database, FileText, Clock, Menu, X, Shield, MapPin, LogOut, User, Users, BarChart3, Calendar, Settings } from "lucide-react";
import { useState, useEffect } from "react";

// Protected Route Component with Role Check
function ProtectedRoute({ children, allowedRoles = [] }) {
  const token = localStorage.getItem('token');
  const userData = localStorage.getItem('user');
  
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // If roles are specified, check if user has permission
  if (allowedRoles.length > 0 && userData) {
    try {
      const user = JSON.parse(userData);
      const userRole = user.role || 'client';
      
      if (!allowedRoles.includes(userRole)) {
        // Redirect non-admins to their client dashboard
        return <Navigate to="/client-dashboard" replace />;
      }
    } catch (error) {
      console.error('Error parsing user data:', error);
      return <Navigate to="/login" replace />;
    }
  }
  
  return children;
}

// Sidebar Component with Role-Based Menu
function Sidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const loadUserData = () => {
      const userData = localStorage.getItem('user');
      if (userData) {
        try {
          const parsedUser = JSON.parse(userData);
          setUser({
            ...parsedUser,
            role: parsedUser.role || 'client'
          });
        } catch (error) {
          console.error('Error parsing user data:', error);
          setUser(null);
        }
      } else {
        setUser(null);
      }
    };

    loadUserData();
    
    // Listen for storage changes (login/logout from other tabs)
    const handleStorageChange = () => {
      loadUserData();
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    navigate('/login');
  };

  const isAdmin = user?.role === 'admin';

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-lg">
        <div className="flex justify-between items-center h-16 px-4">
          <Link 
            to={isAdmin ? "/admin" : "/client-dashboard"} 
            className="flex items-center group"
          >
            <Shield className="w-8 h-8 text-white mr-3" />
            <h1 className="text-white text-xl font-bold">
              BM Security
            </h1>
          </Link>

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
          >
            {sidebarOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full bg-gradient-to-b from-blue-600 via-indigo-600 to-purple-600 shadow-xl z-40
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:w-64
        w-64
      `}>
        <div className="flex flex-col h-full">
          {/* Logo/Brand - Desktop Only */}
          <div className="hidden lg:flex items-center h-16 px-6 border-b border-white/20">
            <Link 
              to={isAdmin ? "/admin" : "/client-dashboard"} 
              className="flex items-center group"
            >
              <Shield className="w-8 h-8 text-white mr-3" />
              <h1 className="text-white text-xl font-bold">
                BM Security
              </h1>
            </Link>
          </div>

          {/* User Info */}
          {user ? (
            <div className="px-6 py-4 border-b border-white/20">
              <div className="text-white">
                <div className="font-medium text-sm truncate">{user.fullName || user.email}</div>
                <div className="flex flex-col gap-1 mt-2">
                  {user.companyName && (
                    <span className="text-xs text-white/70 truncate">{user.companyName}</span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold inline-block w-fit ${
                    isAdmin 
                      ? 'bg-yellow-500 text-white' 
                      : 'bg-green-500 text-white'
                  }`}>
                    {isAdmin ? 'Admin' : 'Client'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-6 py-4 border-b border-white/20">
              <div className="text-white text-sm">Guest</div>
            </div>
          )}

          {/* Navigation Menu */}
          <nav className="flex-1 overflow-y-auto py-4 px-3">
            {user ? (
              <div className="space-y-1">
                {isAdmin ? (
                  // Admin Menu Items
                  <>
                    <Link
                      to="/admin"
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-3 py-3 rounded-lg transition-colors"
                    >
                      <BarChart3 className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Analytics</span>
                    </Link>

                    <Link
                      to="/backup-sync"
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-3 py-3 rounded-lg transition-colors"
                    >
                      <Database className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Backup & Sync</span>
                    </Link>

                    <Link
                      to="/scheduler"
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-3 py-3 rounded-lg transition-colors"
                    >
                      <Clock className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Scheduler</span>
                    </Link>

                    <Link
                      to="/patrol-schedule"
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-3 py-3 rounded-lg transition-colors"
                    >
                      <MapPin className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Patrol Schedule</span>
                    </Link>

                    <Link
                      to="/admin/clients"
                      onClick={() => setSidebarOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-3 py-3 rounded-lg transition-colors"
                    >
                      <Users className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">Clients</span>
                    </Link>
                  </>
                ) : (
                  // Client Menu Items
                  <Link
                    to="/client-dashboard"
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 text-white hover:bg-white/20 px-3 py-3 rounded-lg transition-colors"
                  >
                    <BarChart3 className="w-5 h-5 flex-shrink-0" />
                    <span className="font-medium">Dashboard</span>
                  </Link>
                )}
              </div>
            ) : (
              // Public Menu (Login/Signup)
              <div className="space-y-1">
                <Link
                  to="/login"
                  onClick={() => setSidebarOpen(false)}
                  className="flex items-center gap-3 text-white hover:bg-white/20 px-3 py-3 rounded-lg transition-colors"
                >
                  <User className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium">Login</span>
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setSidebarOpen(false)}
                  className="flex items-center gap-3 bg-white text-blue-600 hover:bg-blue-50 px-3 py-3 rounded-lg transition-colors font-medium"
                >
                  <span>Sign Up</span>
                </Link>
              </div>
            )}
          </nav>

          {/* Logout Button - Bottom */}
          {user && (
            <div className="px-3 py-4 border-t border-white/20">
              <button
                onClick={() => {
                  setSidebarOpen(false);
                  handleLogout();
                }}
                className="flex items-center gap-3 text-white hover:bg-red-500/30 px-3 py-3 rounded-lg transition-colors w-full"
              >
                <LogOut className="w-5 h-5 flex-shrink-0" />
                <span className="font-medium">Logout</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        
        {/* Main Content Area - Adjusted for sidebar */}
        <main className="lg:ml-64 pt-16 lg:pt-0">
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Client Dashboard - Accessible to Authenticated Clients */}
              <Route 
                path="/client-dashboard" 
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />

              {/* Admin Routes */}
              <Route 
                path="/admin" 
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <WeeklyReport />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/admin/clients" 
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/backup-sync" 
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <BackupSync />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/scheduler" 
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <ReportScheduler />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/patrol-schedule" 
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <PatrolScheduleManager />
                  </ProtectedRoute>
                } 
              />

              {/* Root Redirect based on role */}
              <Route 
                path="/" 
                element={
                  (() => {
                    const token = localStorage.getItem('token');
                    const userData = localStorage.getItem('user');
                    
                    if (!token || !userData) {
                      return <Navigate to="/login" replace />;
                    }
                    
                    try {
                      const user = JSON.parse(userData);
                      if (user.role === 'admin') {
                        return <Navigate to="/admin" replace />;
                      } else {
                        return <Navigate to="/client-dashboard" replace />;
                      }
                    } catch (error) {
                      console.error('Error parsing user data:', error);
                      return <Navigate to="/login" replace />;
                    }
                  })()
                } 
              />

              {/* Redirect old dashboard path */}
              <Route 
                path="/dashboard" 
                element={
                  (() => {
                    const token = localStorage.getItem('token');
                    const userData = localStorage.getItem('user');
                    
                    if (!token || !userData) {
                      return <Navigate to="/login" replace />;
                    }
                    
                    try {
                      const user = JSON.parse(userData);
                      if (user.role === 'admin') {
                        return <Navigate to="/admin" replace />;
                      } else {
                        return <Navigate to="/client-dashboard" replace />;
                      }
                    } catch (error) {
                      console.error('Error parsing user data:', error);
                      return <Navigate to="/login" replace />;
                    }
                  })()
                } 
              />

              {/* Fallback - Redirect to appropriate dashboard */}
              <Route 
                path="*" 
                element={
                  (() => {
                    const token = localStorage.getItem('token');
                    const userData = localStorage.getItem('user');
                    
                    if (!token || !userData) {
                      return <Navigate to="/login" replace />;
                    }
                    
                    try {
                      const user = JSON.parse(userData);
                      if (user.role === 'admin') {
                        return <Navigate to="/admin" replace />;
                      } else {
                        return <Navigate to="/client-dashboard" replace />;
                      }
                    } catch (error) {
                      console.error('Error parsing user data:', error);
                      return <Navigate to="/login" replace />;
                    }
                  })()
                } 
              />
            </Routes>
          </div>
        </main>
      </div>
    </Router>
  );
}

export default App;