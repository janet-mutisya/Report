import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import WeeklyReport from "./pages/WeeklyReport";
import BackupSync from "./pages/BackupSync";
import ReportScheduler from "./pages/ReportScheduler";
import PatrolScheduleManager from "./pages/patrolScheduleManager";
import { Database, FileText, Clock, Menu, X, Shield, MapPin } from "lucide-react";
import { useState } from "react";

function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        {/* Navigation */}
        <nav className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-lg relative overflow-hidden">
          {/* Animated background effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 to-purple-400/20 animate-pulse"></div>
          
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="flex justify-between items-center h-16">
              {/* Logo/Brand with hover effect */}
              <div className="flex items-center group cursor-pointer">
                <Shield className="w-8 h-8 text-white mr-3 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                <h1 className="text-white text-2xl font-bold tracking-wide transition-all duration-300 group-hover:tracking-wider">
                  BM Security
                </h1>
              </div>

              {/* Desktop Navigation */}
              <div className="hidden md:flex space-x-2">
                <Link
                  to="/"
                  className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <FileText className="w-5 h-5 transition-transform duration-300 group-hover:rotate-6" />
                  <span className="font-medium">Weekly Report</span>
                </Link>

                <Link
                  to="/patrol-schedule"
                  className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <MapPin className="w-5 h-5 transition-transform duration-300 group-hover:rotate-6" />
                  <span className="font-medium">Patrol Schedule</span>
                </Link>

                <Link
                  to="/backup-sync"
                  className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <Database className="w-5 h-5 transition-transform duration-300 group-hover:rotate-6" />
                  <span className="font-medium">Backup Sync</span>
                </Link>

                <Link
                  to="/scheduler"
                  className="flex items-center gap-2 text-white hover:bg-white/20 px-4 py-2 rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <Clock className="w-5 h-5 transition-transform duration-300 group-hover:rotate-6" />
                  <span className="font-medium">Report Scheduler</span>
                </Link>
              </div>

              {/* Mobile Menu Button with animation */}
              <div className="md:hidden">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="text-white hover:bg-white/20 p-2 rounded-lg transition-all duration-300 hover:scale-110 hover:shadow-lg backdrop-blur-sm border border-transparent hover:border-white/30"
                >
                  {menuOpen ? (
                    <X className="w-6 h-6 transition-transform duration-300 rotate-90" />
                  ) : (
                    <Menu className="w-6 h-6 transition-transform duration-300 hover:rotate-180" />
                  )}
                </button>
              </div>
            </div>

            {/* Mobile Navigation with slide animation */}
            {menuOpen && (
              <div className="md:hidden pb-4 space-y-2 animate-in slide-in-from-top duration-300">
                <Link
                  to="/"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-all duration-300 hover:translate-x-2 backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <FileText className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
                  <span className="font-medium">Weekly Report</span>
                </Link>

                <Link
                  to="/patrol-schedule"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-all duration-300 hover:translate-x-2 backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <MapPin className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
                  <span className="font-medium">Patrol Schedule</span>
                </Link>

                <Link
                  to="/backup-sync"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-all duration-300 hover:translate-x-2 backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <Database className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
                  <span className="font-medium">Backup Sync</span>
                </Link>

                <Link
                  to="/scheduler"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 text-white hover:bg-white/20 px-4 py-3 rounded-lg transition-all duration-300 hover:translate-x-2 backdrop-blur-sm border border-transparent hover:border-white/30 group"
                >
                  <Clock className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
                  <span className="font-medium">Report Scheduler</span>
                </Link>
              </div>
            )}
          </div>
        </nav>

        {/* Routes with fade transition */}
        <div className="animate-in fade-in duration-500">
          <Routes>
            <Route path="/" element={<WeeklyReport />} />
            <Route path="/patrol-schedule" element={<PatrolScheduleManager />} />
            <Route path="/backup-sync" element={<BackupSync />} />
            <Route path="/scheduler" element={<ReportScheduler />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;