import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, User, Mail, Lock, Eye, EyeOff, AlertCircle, CheckCircle, Loader, ChevronRight } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function Signup() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: '',
    email:    '',
    password: '',
    confirm:  '',
  });

  const [showPw,  setShowPw]  = useState(false);
  const [showCf,  setShowCf]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const update = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const validate = () => {
    if (!form.username.trim())           return 'Username is required';
    if (form.username.trim().length < 3) return 'Username must be at least 3 characters';
    if (!form.email.trim())              return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Enter a valid email address';
    if (!form.password)                  return 'Password is required';
    if (form.password.length < 6)        return 'Password must be at least 6 characters';
    if (form.password !== form.confirm)  return 'Passwords do not match';
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { setError(err); return; }

    setLoading(true);
    setError('');

    try {
      // ✅ Matches POST /api/auth/register in auth.js
      const res  = await fetch(`${API}/auth/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username.trim(),
          email:    form.email.trim().toLowerCase(),
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Registration failed');
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') submit(); };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-10 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-5">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">Account Created</h2>
          <p className="text-gray-500 mb-6">
            Registered as <strong>{form.username}</strong> with <strong>Staff</strong> access.
          </p>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left mb-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">Need admin rights?</p>
            <p className="text-sm text-amber-700 mb-2">Run this SQL in SSMS to upgrade the account:</p>
            <pre className="bg-amber-100 rounded-lg p-3 text-xs text-amber-900 font-mono overflow-x-auto whitespace-pre-wrap break-all">
{`UPDATE [dbo].[m_usuarios]
SET usu_ntipo = 1
WHERE usu_cnombre = '${form.username}';`}
            </pre>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left mb-6 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Username</span>
              <span className="font-semibold text-gray-800">{form.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="font-semibold text-gray-800">{form.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Role</span>
              <span className="font-semibold text-gray-500">staff — usu_ntipo = 2</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setSuccess(false); setForm({ username: '', email: '', password: '', confirm: '' }); }}
              className="flex-1 py-3 border border-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition text-sm"
            >
              Add Another
            </button>
            <button
              onClick={() => navigate('/login')}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition text-sm flex items-center justify-center gap-1"
            >
              Sign In <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-8 items-center">

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 lg:p-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-4 shadow-lg">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Create an Account</h1>
            <p className="text-gray-500 text-sm mt-1">BM Security — Staff Portal</p>
          </div>

          <div className="space-y-5">

            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* Username */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text" name="username"
                  value={form.username} onChange={update} onKeyDown={onKeyDown}
                  placeholder="e.g. rirungu"
                  disabled={loading} autoComplete="username"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">You'll use this to log in — not your email</p>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email" name="email"
                  value={form.email} onChange={update} onKeyDown={onKeyDown}
                  placeholder="you@bmsecurity.com"
                  disabled={loading} autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50"
                />
              </div>
            </div>

            {/* Password + Confirm */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPw ? 'text' : 'password'} name="password"
                    value={form.password} onChange={update} onKeyDown={onKeyDown}
                    placeholder="Min. 6 chars"
                    disabled={loading}
                    className="w-full pl-9 pr-9 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50"
                  />
                  <button type="button" onClick={() => setShowPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Confirm</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showCf ? 'text' : 'password'} name="confirm"
                    value={form.confirm} onChange={update} onKeyDown={onKeyDown}
                    placeholder="Repeat password"
                    disabled={loading}
                    className={`w-full pl-9 pr-9 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition disabled:bg-gray-50
                      ${form.confirm && form.confirm !== form.password ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                  />
                  <button type="button" onClick={() => setShowCf(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                    {showCf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={submit} disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              {loading
                ? <><Loader className="w-5 h-5 animate-spin" /> Creating account…</>
                : 'Create Account'}
            </button>
          </div>

          <p className="text-center mt-5 text-sm text-gray-400">
            Already have an account?{' '}
            <button onClick={() => navigate('/login')} className="text-blue-600 hover:text-blue-700 font-medium">
              Sign in
            </button>
          </p>
        </div>

        {/* Info panel */}
        <div className="hidden lg:flex flex-col justify-center text-white space-y-6">
          <div className="pb-6 border-b border-white/20">
            <h2 className="text-2xl font-bold mb-2">Staff Registration</h2>
            <p className="text-blue-200 text-sm leading-relaxed">
              Register your account here. Admin rights are assigned separately via SSMS by the database administrator.
            </p>
          </div>

          <div className="space-y-4">
            {[
              { icon: '👤', title: 'Username-based login',    sub: 'Log in with your username — not your email address' },
              { icon: '🔐', title: 'Staff access by default', sub: 'New accounts start as staff; admin rights granted via SSMS' },
              { icon: '⚡', title: 'Instant activation',      sub: 'Your account is active immediately after registration' },
              { icon: '✏️',  title: 'Change password anytime', sub: 'Update your password from the portal at any time' },
            ].map(({ icon, title, sub }) => (
              <div key={title} className="flex items-start gap-3">
                <span className="text-xl shrink-0 mt-0.5">{icon}</span>
                <div>
                  <p className="font-semibold text-sm">{title}</p>
                  <p className="text-blue-200 text-xs mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white/10 backdrop-blur rounded-xl p-5 border border-white/20 text-sm">
            <p className="font-semibold mb-2">Grant admin rights in SSMS:</p>
            <pre className="bg-white/10 rounded-lg p-3 text-xs font-mono text-blue-100 overflow-x-auto whitespace-pre-wrap">
{`UPDATE [dbo].[m_usuarios]
SET usu_ntipo = 1
WHERE usu_cnombre = 'username';`}
            </pre>
            <p className="text-blue-300 text-xs mt-2">usu_ntipo: 1 = admin &nbsp;|&nbsp; 2 = staff</p>
          </div>

          <p className="text-center text-xs text-blue-200 pt-4 border-t border-white/20">
            Protected by BM Security · Trusted by businesses across Kenya
          </p>
        </div>

      </div>
    </div>
  );
}