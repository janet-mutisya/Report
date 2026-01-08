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

// Main Navigation Component with Role-Based Menu
function MainNav() {
  const [menuOpen, setMenuOpen] = useState(false);
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
    <nav className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Brand */}
          <Link 
            to={isAdmin ? "/admin" : "/client-dashboard"} 
            className="flex items-center group"
          >
            <Shield className="w-8 h-8 text-white mr-3" />
            <h1 className="text-white text-2xl font-bold">
              BM Security
            </h1>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-2">
            {user ? (
              <>
                {/* Show different menus based on role */}
                {isAdmin ? (
                  // Admin Menu Items
                  <>
                    <Link
                      to="/admin"
                      className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                    >
                      <BarChart3 className="w-5 h-5" />
                      <span className="font-medium">Analytics</span>
                    </Link>

                    
                    <Link
                      to="/backup-sync"
                      className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                    >
                      <Database className="w-5 h-5" />
                      <span className="font-medium">Backup</span>
                    </Link>

                    <Link
                      to="/scheduler"
                      className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                    >
                      <Clock className="w-5 h-5" />
                      <span className="font-medium">Scheduler</span>
                    </Link>

                    <Link
                      to="/patrol-schedule"
                      className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                    >
                      <MapPin className="w-5 h-5" />
                      <span className="font-medium">Patrol</span>
                    </Link>

                    <Link
                      to="/admin/clients"
                      className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                    >
                      <Users className="w-5 h-5" />
                      <span className="font-medium">Clients</span>
                    </Link>
                  </>
                ) : (
                  // Client Menu Items
                  <>
                    <Link
                      to="/client-dashboard"
                      className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                    >
                      <BarChart3 className="w-5 h-5" />
                      <span className="font-medium">Dashboard</span>
                    </Link>
                  </>
                )}

                {/* User Profile & Logout */}
                <div className="flex items-center gap-3 ml-4 pl-4 border-l border-white/30">
                  <div className="text-white text-sm">
                    <div className="font-medium">{user.fullName || user.email}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {user.companyName && (
                        <span className="text-xs text-white/70">{user.companyName}</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        isAdmin 
                          ? 'bg-yellow-500 text-white' 
                          : 'bg-green-500 text-white'
                      }`}>
                        {isAdmin ? 'Admin' : 'Client'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-white hover:bg-white/20 px-3 py-2 rounded-lg transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </>
            ) : (
              // Public Menu (Login/Signup)
              <>
                <Link
                  to="/login"
                  className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
                >
                  <User className="w-5 h-5" />
                  <span className="font-medium">Login</span>
                </Link>
                <Link
                  to="/signup"
                  className="flex items-center gap-2 bg-white text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg transition-colors font-medium"
                >
                  <span>Sign Up</span>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
            >
              {menuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {menuOpen && (
          <div className="md:hidden pb-4 space-y-2">
            {user ? (
              <>
                {/* User Info */}
                <div className="text-white px-4 py-3 border-b border-white/20 mb-2">
                  <div className="font-medium">{user.fullName || user.email}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {user.companyName && (
                      <span className="text-xs text-white/70">{user.companyName}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      isAdmin 
                        ? 'bg-yellow-500 text-white' 
                        : 'bg-green-500 text-white'
                    }`}>
                      {isAdmin ? 'Admin' : 'Client'}
                    </span>
                  </div>
                </div>

                {/* Mobile Menu Items based on role */}
                {isAdmin ? (
                  // Admin Mobile Menu
                  <>
                    <Link
                      to="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                    >
                      <BarChart3 className="w-5 h-5" />
                      <span className="font-medium">Analytics Dashboard</span>
                    </Link>

                    <Link
                      to="/weekly-report"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                    >
                      <FileText className="w-5 h-5" />
                      <span className="font-medium">Weekly Reports</span>
                    </Link>

                    <Link
                      to="/backup-sync"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                    >
                      <Database className="w-5 h-5" />
                      <span className="font-medium">Backup & Sync</span>
                    </Link>

                    <Link
                      to="/scheduler"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                    >
                      <Clock className="w-5 h-5" />
                      <span className="font-medium">Report Scheduler</span>
                    </Link>

                    <Link
                      to="/patrol-schedule"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                    >
                      <MapPin className="w-5 h-5" />
                      <span className="font-medium">Patrol Schedule</span>
                    </Link>

                    <Link
                      to="/admin/clients"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                    >
                      <Users className="w-5 h-5" />
                      <span className="font-medium">Client Management</span>
                    </Link>
                  </>
                ) : (
                  // Client Mobile Menu
                  <Link
                    to="/client-dashboard"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                  >
                    <BarChart3 className="w-5 h-5" />
                    <span className="font-medium">My Dashboard</span>
                  </Link>
                )}

                {/* Logout Button */}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex items-center gap-3 text-white hover:bg-red-500/30 px-4 py-3 rounded-lg transition-colors w-full mt-4"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Logout</span>
                </button>
              </>
            ) : (
              // Public Mobile Menu
              <>
                <Link
                  to="/login"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-colors"
                >
                  <span className="font-medium">Login</span>
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 bg-white text-blue-600 hover:bg-blue-50 px-4 py-3 rounded-lg transition-colors font-medium"
                >
                  <span>Sign Up</span>
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <MainNav />
        
        <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
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
              path="/weekly-report" 
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <WeeklyReport />
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
        </main>
      </div>
    </Router>
  );
}

export default App;