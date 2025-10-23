import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import WeeklyReport from "./pages/WeeklyReport";
import BackupSync from "./pages/BackupSync";
import { Database, FileText, Menu, X } from "lucide-react";
import { useState } from "react";

function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        {/* Navigation */}
        <nav className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              {/* Logo/Brand */}
              <div className="flex items-center">
                <h1 className="text-white text-2xl font-bold">BM Security</h1>
              </div>

              {/* Desktop Navigation */}
              <div className="hidden md:flex space-x-4">
                <Link
                  to="/"
                  className="flex items-center gap-2 text-white hover:bg-white/10 px-4 py-2 rounded-lg transition-colors"
                >
                  <FileText className="w-5 h-5" />
                  Weekly Report
                </Link>
                <Link
                  to="/backup-sync"
                  className="flex items-center gap-2 text-white hover:bg-white/10 px-4 py-2 rounded-lg transition-colors"
                >
                  <Database className="w-5 h-5" />
                  Backup Sync
                </Link>
              </div>

              {/* Mobile Menu Button */}
              <div className="md:hidden">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="text-white hover:bg-white/10 p-2 rounded-lg transition-colors"
                >
                  {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
              </div>
            </div>

            {/* Mobile Navigation */}
            {menuOpen && (
              <div className="md:hidden pb-4 space-y-2">
                <Link
                  to="/"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 text-white hover:bg-white/10 px-4 py-2 rounded-lg transition-colors"
                >
                  <FileText className="w-5 h-5" />
                  Weekly Report
                </Link>
                <Link
                  to="/backup-sync"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 text-white hover:bg-white/10 px-4 py-2 rounded-lg transition-colors"
                >
                  <Database className="w-5 h-5" />
                  Backup Sync
                </Link>
              </div>
            )}
          </div>
        </nav>

        {/* Routes */}
        <Routes>
          <Route path="/" element={<WeeklyReport />} />
          <Route path="/backup-sync" element={<BackupSync />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;