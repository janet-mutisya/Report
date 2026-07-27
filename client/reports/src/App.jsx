import {
  BrowserRouter as Router, Routes, Route, Link,
  Navigate, useNavigate, useLocation,
} from "react-router-dom";
import { useState, useEffect, useCallback, createContext, useContext } from "react";
import WeeklyReport          from "./pages/WeeklyReport";
import ReportScheduler       from "./pages/ReportScheduler";
import PatrolScheduleManager from "./pages/patrolScheduleManager";
import CreateUser            from "./pages/createUser";
import Login                 from "./pages/login";
import ForgotPassword        from "./pages/forgetPassword";
import ChangePassword        from "./pages/resetPassword";
import Dashboard             from "./pages/Dashboard";
import AdminDashboard        from "./pages/AdminDashboard";
import MonitorDashboard      from "./pages/monitorDashboard";
import ReportArchive         from "./pages/ReportArchive";
import {
  Clock, Menu, X, Shield, MapPin,
  LogOut, Users, BarChart3, UserPlus, KeyRound,
  LayoutDashboard, Monitor, Archive,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function getStoredUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}
function getStoredToken() {
  return localStorage.getItem("token") || null;
}

function getRoleHome(user) {
  if (!user) return "/login";
  const role = (user.role || "").toLowerCase();
  if (role === "admin" || role === "staff") return "/admin";
  if (role === "monitor")                  return "/monitor";
  if (role === "client")                   return "/client-dashboard";
  return "/login";
}

function isAllowed(user, allowedRoles) {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  const role = (user?.role || "client").toLowerCase();
  return allowedRoles.map(r => r.toLowerCase()).includes(role);
}

// ─────────────────────────────────────────────────────────────
// Auth context
// ─────────────────────────────────────────────────────────────
const AuthCtx = createContext({ user: null, token: null, refresh: () => {} });
export function useAuth() { return useContext(AuthCtx); }

function AuthProvider({ children }) {
  const [token, setToken] = useState(getStoredToken);
  const [user,  setUser]  = useState(getStoredUser);

  const refresh = useCallback(() => {
    setToken(getStoredToken());
    setUser(getStoredUser());
  }, []);

  useEffect(() => {
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [refresh]);

  return (
    <AuthCtx.Provider value={{ user, token, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// Route guards
// ─────────────────────────────────────────────────────────────
function RootRedirect() {
  const { token, user } = useAuth();
  if (!token || !user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Navigate to={getRoleHome(user)} replace />;
}

function ProtectedRoute({ children, allowedRoles = [] }) {
  const { token, user } = useAuth();
  const location        = useLocation();

  if (!token || !user) return <Navigate to="/login" replace state={{ from: location }} />;

  if (user.mustChangePassword && location.pathname !== "/change-password")
    return <Navigate to="/change-password" replace />;

  if (!isAllowed(user, allowedRoles))
    return <Navigate to={getRoleHome(user)} replace />;

  return children;
}

// ─────────────────────────────────────────────────────────────
// Nav items
// ─────────────────────────────────────────────────────────────
const ADMIN_NAV = [
  { to: "/admin",             icon: BarChart3, label: "Analytics"        },
  { to: "/scheduler",         icon: Clock,     label: "Scheduler"        },
  { to: "/patrol-schedules",  icon: MapPin,    label: "Patrol Schedules" },
  { to: "/admin/clients",     icon: Users,     label: "Clients"          },
  { to: "/admin/create-user", icon: UserPlus,  label: "Create User"      },
  { to: "/report-archive",    icon: Archive,   label: "Report Archive"   },
];

const STAFF_NAV = [
  { to: "/admin",            icon: BarChart3, label: "Analytics"        },
  { to: "/patrol-schedules", icon: MapPin,    label: "Patrol Schedules" },
  { to: "/report-archive",   icon: Archive,   label: "Report Archive"   },
];

const MONITOR_NAV = [
  { to: "/monitor", icon: Monitor, label: "Control Room" },
];

const CLIENT_NAV = [
  { to: "/client-dashboard", icon: LayoutDashboard, label: "Dashboard"       },
  { to: "/change-password",  icon: KeyRound,        label: "Change Password" },
];

const NO_SIDEBAR_PATHS = new Set([
  "/login", "/forgot-password", "/change-password",
]);

// Monitor dashboard gets its own full-screen layout (no sidebar padding)
const FULLSCREEN_PATHS = new Set(["/monitor"]);

// ─────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────
function NavItem({ to, icon: Icon, label, onClick }) {
  const location = useLocation();
  const active   = location.pathname === to;
  return (
    <Link to={to} onClick={onClick}
      className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-colors font-medium
        ${active ? "bg-white/25 text-white" : "text-white hover:bg-white/20"}`}>
      {Icon && <Icon className="w-5 h-5 flex-shrink-0" />}
      <span>{label}</span>
    </Link>
  );
}

function Sidebar() {
  const [open, setOpen]   = useState(false);
  const { user, refresh } = useAuth();
  const navigate          = useNavigate();
  const location          = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  if (NO_SIDEBAR_PATHS.has(location.pathname)) return null;
  if (FULLSCREEN_PATHS.has(location.pathname)) return null;
  if (!user) return null;

  const role      = (user.role || "").toLowerCase();
  const isAdmin   = role === "admin";
  const isStaff   = role === "staff";
  const isMonitor = role === "monitor";
  const isClient  = role === "client";

  if (!isAdmin && !isStaff && !isMonitor && !isClient) return null;

  const close = () => setOpen(false);

  const handleLogout = () => {
    close();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    refresh();
    navigate("/login", { replace: true });
  };

  let navItems = [];
  if (isAdmin)        navItems = ADMIN_NAV;
  else if (isStaff)   navItems = STAFF_NAV;
  else if (isMonitor) navItems = MONITOR_NAV;
  else if (isClient)  navItems = CLIENT_NAV;

  const homeLink    = getRoleHome(user);
  const roleDisplay = isAdmin ? "Admin" : isStaff ? "Staff" : isMonitor ? "Monitor" : "Client";

  const brand = (
    <Link to={homeLink} className="flex items-center gap-3">
      <Shield className="w-8 h-8 text-white" />
      <span className="text-white text-xl font-bold tracking-tight">BM Security</span>
    </Link>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50
                      bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-lg">
        <div className="flex justify-between items-center h-16 px-4">
          {brand}
          <button onClick={() => setOpen(v => !v)}
            className="text-white hover:bg-white/20 p-2 rounded-lg transition-colors">
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={close} />
      )}

      {/* Sidebar panel */}
      <aside className={`
        fixed top-0 left-0 h-full w-64
        bg-gradient-to-b from-blue-600 via-indigo-600 to-purple-600
        shadow-xl z-40 flex flex-col
        transition-transform duration-300 ease-in-out
        ${open ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0
      `}>
        {/* Brand — desktop */}
        <div className="hidden lg:flex items-center h-16 px-6 border-b border-white/20">
          {brand}
        </div>

        {/* User badge */}
        <div className="px-6 py-4 border-b border-white/20">
          <p className="font-medium text-sm text-white truncate">
            {user.username || user.name || user.email}
          </p>
          <span className={`mt-2 text-xs px-2 py-1 rounded-full font-semibold inline-block
            ${isAdmin   ? "bg-yellow-500 text-white"  :
              isStaff   ? "bg-blue-400 text-white"    :
              isMonitor ? "bg-orange-500 text-white"  :
                          "bg-green-500 text-white"}`}>
            {roleDisplay}
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map(({ to, icon, label }) => (
            <NavItem key={to} to={to} icon={icon} label={label} onClick={close} />
          ))}
          {!isClient && !isMonitor && (
            <NavItem to="/change-password" icon={KeyRound} label="Change Password" onClick={close} />
          )}
          {isMonitor && (
            <NavItem to="/change-password" icon={KeyRound} label="Change Password" onClick={close} />
          )}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-white/20">
          <button onClick={handleLogout}
            className="flex items-center gap-3 text-white hover:bg-red-500/30
                       px-3 py-3 rounded-lg transition-colors w-full font-medium">
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────
function Layout({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  const role         = (user?.role || "").toLowerCase();
  const isPublic     = NO_SIDEBAR_PATHS.has(location.pathname);
  const isFullscreen = FULLSCREEN_PATHS.has(location.pathname);
  const hasSidebar   = !isPublic && !isFullscreen && !!user &&
    (role === "admin" || role === "staff" || role === "monitor" || role === "client");

  // Monitor dashboard: full viewport, no wrapper padding
  if (isFullscreen) {
    return (
      <div className="min-h-screen bg-gray-50">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className={hasSidebar ? "lg:ml-64 pt-16 lg:pt-0" : ""}>
        {hasSidebar
          ? <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">{children}</div>
          : children}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Layout>
          <Routes>

            {/* ── Public ── */}
            <Route path="/login"           element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />

            {/* ── Password change (all authenticated roles) ── */}
            <Route path="/change-password" element={<ChangePassword />} />

            {/* ── Monitor ONLY ── */}
            <Route path="/monitor"
              element={
                <ProtectedRoute allowedRoles={["monitor", "admin"]}>
                  <MonitorDashboard />
                </ProtectedRoute>
              }
            />

            {/* ── Client ONLY ── */}
            <Route path="/client-dashboard"
              element={
                <ProtectedRoute allowedRoles={["client"]}>
                  <Dashboard />
                </ProtectedRoute>
              }
            />

            {/* ── Admin + Staff ── */}
            <Route path="/admin"
              element={
                <ProtectedRoute allowedRoles={["admin", "staff"]}>
                  <WeeklyReport />
                </ProtectedRoute>
              }
            />
            <Route path="/patrol-schedules"
              element={
                <ProtectedRoute allowedRoles={["admin", "staff"]}>
                  <PatrolScheduleManager />
                </ProtectedRoute>
              }
            />
            <Route path="/report-archive"
              element={
                <ProtectedRoute allowedRoles={["admin", "staff"]}>
                  <ReportArchive />
                </ProtectedRoute>
              }
            />

            {/* ── Admin ONLY ── */}
            <Route path="/admin/clients"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/admin/create-user"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <CreateUser />
                </ProtectedRoute>
              }
            />
            <Route path="/scheduler"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <ReportScheduler />
                </ProtectedRoute>
              }
            />

            {/* ── Catch-all ── */}
            <Route path="/"          element={<RootRedirect />} />
            <Route path="/dashboard" element={<RootRedirect />} />
            <Route path="*"          element={<RootRedirect />} />

          </Routes>
        </Layout>
      </AuthProvider>
    </Router>
  );
}