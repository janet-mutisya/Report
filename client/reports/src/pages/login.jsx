import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, User, Lock, AlertCircle, Loader, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../lib/api';

export default function Login() {
  const navigate  = useNavigate();
  const [form,    setForm]    = useState({ username: '', password: '' });
  const [showPw,  setShowPw]  = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const update = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const submit = async () => {
    const usernameVal = form.username.trim() || document.querySelector('[name="username"]')?.value?.trim() || '';
    const passwordVal = form.password        || document.querySelector('[name="password"]')?.value        || '';

    if (!usernameVal || !passwordVal) {
      setError('Username / email and password are required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body:   JSON.stringify({ username: usernameVal, password: passwordVal }),
      });

      if (!data.success) throw new Error(data.message || 'Login failed');

      localStorage.setItem('token', data.token);
      localStorage.setItem('user',  JSON.stringify(data.user));
      window.dispatchEvent(new Event('storage'));

      setSuccess(`Welcome, ${data.user.username || data.user.name || data.user.email}`);

      if (data.user.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }

      navigate(data.user.role === 'admin' ? '/admin' : '/client-dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') submit(); };

  return (
    <>
      <style>{STYLES}</style>
      <div className="pg-root">
        <div className="pg-layout">

          {/* ── Form card ── */}
          <div className="pg-card">
            <div className="pg-brand">
              <div className="pg-brand-icon"><Shield size={22} color="#1d4ed8" /></div>
              <div>
                <p className="pg-brand-name">BM Security Portal</p>
                <p className="pg-brand-sub">Guard Reporting &amp; Client Dashboard</p>
              </div>
            </div>

            <h2 className="pg-heading">Welcome back.</h2>
            <p className="pg-subheading">Sign in to access your dashboard</p>

            <div className="pg-fields">
              {error   && (
                <div className="pg-alert error">
                  <AlertCircle size={15} /><span>{error}</span>
                </div>
              )}
              {success && (
                <div className="pg-alert success">
                  <span>✓</span><span>{success} — redirecting…</span>
                </div>
              )}

              <div className="pg-field">
                <label className="pg-label">
                  Username <span className="pg-label-note">(or email for clients)</span>
                </label>
                <div className="pg-input-wrap">
                  <span className="pg-icon"><User size={15} /></span>
                  <input
                    className="pg-input"
                    type="text"
                    name="username"
                    value={form.username}
                    onChange={update}
                    onInput={update}
                    onKeyDown={onKeyDown}
                    placeholder="Enter your username or email"
                    disabled={loading}
                    autoComplete="username"
                  />
                </div>
                <p className="pg-hint">Admin: use your username &nbsp;·&nbsp; Clients: use your email address</p>
              </div>

              <div className="pg-field">
                <div className="pg-label-row">
                  <label className="pg-label" style={{ marginBottom: 0 }}>Password</label>
                  <button
                    className="pg-forgot"
                    type="button"
                    onClick={() => navigate('/forgot-password')}
                    disabled={loading}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="pg-input-wrap">
                  <span className="pg-icon"><Lock size={15} /></span>
                  <input
                    className="pg-input"
                    type={showPw ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={update}
                    onInput={update}
                    onKeyDown={onKeyDown}
                    placeholder="Enter your password"
                    disabled={loading}
                    autoComplete="current-password"
                    style={{ paddingRight: 42 }}
                  />
                  <button
                    className="pg-eye"
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPw(p => !p)}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                className="pg-btn-primary"
                type="button"
                onClick={submit}
                disabled={loading || !!success}
              >
                {loading
                  ? <><Loader size={15} className="pg-spin" /> Signing in…</>
                  : 'Sign In'
                }
              </button>

              <p className="pg-footer-note">Don't have an account? Contact your administrator.</p>
            </div>
          </div>

          {/* ── Info panel ── */}
          <div className="pg-info">
            <div className="pg-info-top">
              <h2 className="pg-info-title">Security Dashboard Access</h2>
              <p className="pg-info-desc">Real-time patrol monitoring, automated reports, and 24/7 security insights.</p>
            </div>

            <div className="pg-tips">
              {[
                { icon: '🔐', title: 'Admin login',             sub: 'Use your username to access the full management dashboard' },
                { icon: '📧', title: 'Client login',            sub: 'Clients log in with their registered email address' },
                { icon: '🔑', title: 'First login?',            sub: "You'll be prompted to set a new password before proceeding" },
                { icon: '🔒', title: 'Change password anytime', sub: 'Update your password from your account settings' },
              ].map(({ icon, title, sub }) => (
                <div key={title} className="pg-tip">
                  <span className="pg-tip-icon">{icon}</span>
                  <div>
                    <p className="pg-tip-title">{title}</p>
                    <p className="pg-tip-sub">{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pg-roles">
              <p className="pg-roles-heading">🔐 Access levels</p>
              <p className="pg-role-row"><span className="pg-badge">Admin</span> Full system access, user management, analytics</p>
              <p className="pg-role-row"><span className="pg-badge client">Client</span> VigiControl arrivals &amp; performance dashboard</p>
            </div>

            <p className="pg-legal">Protected by BM Security · Trusted by businesses across Kenya</p>
          </div>

        </div>
      </div>
    </>
  );
}

const STYLES = `
  .pg-root { min-height:100vh; background:#f0f4ff; display:flex; align-items:center; justify-content:center; padding:32px 16px; font-family:'Sora',sans-serif; }
  .pg-layout { display:grid; grid-template-columns:1fr 1fr; gap:36px; width:100%; max-width:980px; align-items:center; }
  @media(max-width:768px){ .pg-layout{grid-template-columns:1fr} .pg-info{display:none} }
  .pg-card { background:#fff; border-radius:20px; padding:40px 36px; box-shadow:0 4px 28px rgba(29,78,216,0.09),0 1px 4px rgba(0,0,0,0.04); border:1px solid #e0e7ff; }
  .pg-brand { display:flex; align-items:center; gap:12px; margin-bottom:28px; }
  .pg-brand-icon { width:46px; height:46px; border-radius:13px; background:#eff6ff; border:1px solid #bfdbfe; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .pg-brand-name { font-family:'Instrument Serif',serif; font-size:1.1rem; color:#111827; margin:0 0 2px; }
  .pg-brand-sub  { font-size:0.72rem; color:#9ca3af; margin:0; }
  .pg-heading    { font-family:'Instrument Serif',serif; font-size:2rem; color:#111827; margin:0 0 6px; line-height:1.15; }
  .pg-subheading { font-size:0.85rem; color:#6b7280; margin:0 0 28px; }
  .pg-fields { display:flex; flex-direction:column; gap:18px; }
  .pg-alert { display:flex; align-items:flex-start; gap:9px; padding:11px 14px; border-radius:10px; font-size:0.8rem; line-height:1.5; }
  .pg-alert.error   { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; }
  .pg-alert.success { background:#f0fdf4; border:1px solid #bbf7d0; color:#15803d; }
  .pg-field { display:flex; flex-direction:column; }
  .pg-label { font-size:0.7rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280; margin-bottom:6px; }
  .pg-label-note { text-transform:none; letter-spacing:0; font-weight:400; color:#9ca3af; }
  .pg-label-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
  .pg-hint { font-size:0.72rem; color:#9ca3af; margin-top:5px; }
  .pg-forgot { font-size:0.75rem; font-weight:600; color:#2563eb; background:none; border:none; cursor:pointer; padding:0; transition:color .15s; font-family:'Sora',sans-serif; }
  .pg-forgot:hover { color:#1d4ed8; }
  .pg-input-wrap { position:relative; }
  .pg-icon { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:#9ca3af; display:flex; pointer-events:none; }
  .pg-eye  { position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#9ca3af; background:none; border:none; cursor:pointer; padding:0; display:flex; transition:color .15s; }
  .pg-eye:hover { color:#4b5563; }
  .pg-input { width:100%; padding:11px 13px 11px 38px; background:#f8faff; border:1.5px solid #e0e7ff; border-radius:10px; color:#111827; font-size:0.875rem; font-family:'Sora',sans-serif; outline:none; transition:border-color .2s,box-shadow .2s,background .2s; box-sizing:border-box; }
  .pg-input::placeholder { color:#c4cfe8; }
  .pg-input:focus { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.12); background:#fff; }
  .pg-input:disabled { opacity:.55; cursor:not-allowed; }
  .pg-btn-primary { width:100%; padding:12px; background:linear-gradient(135deg,#1d4ed8,#2563eb); color:#fff; font-size:0.875rem; font-weight:600; font-family:'Sora',sans-serif; border:none; border-radius:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 14px rgba(29,78,216,0.3); transition:opacity .2s,transform .1s,box-shadow .2s; }
  .pg-btn-primary:hover:not(:disabled) { opacity:.92; transform:translateY(-1px); box-shadow:0 6px 20px rgba(29,78,216,0.38); }
  .pg-btn-primary:disabled { opacity:.6; cursor:not-allowed; transform:none; }
  @keyframes pg-spin { to { transform:rotate(360deg); } }
  .pg-spin { animation:pg-spin .8s linear infinite; }
  .pg-footer-note { text-align:center; font-size:0.75rem; color:#9ca3af; }
  .pg-info { display:flex; flex-direction:column; gap:28px; padding:8px 0; }
  .pg-info-title { font-family:'Instrument Serif',serif; font-size:1.7rem; color:#111827; margin:0 0 10px; line-height:1.2; }
  .pg-info-desc  { font-size:0.85rem; color:#6b7280; line-height:1.65; margin:0; }
  .pg-info-top   { padding-bottom:24px; border-bottom:1px solid #e0e7ff; }
  .pg-tips { display:flex; flex-direction:column; gap:16px; }
  .pg-tip  { display:flex; align-items:flex-start; gap:12px; }
  .pg-tip-icon  { font-size:1.1rem; flex-shrink:0; margin-top:1px; }
  .pg-tip-title { font-size:0.85rem; font-weight:600; color:#1f2937; margin:0 0 3px; }
  .pg-tip-sub   { font-size:0.78rem; color:#9ca3af; margin:0; line-height:1.5; }
  .pg-roles { background:#f8faff; border:1px solid #e0e7ff; border-radius:12px; padding:16px 18px; }
  .pg-roles-heading { font-size:0.72rem; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:#6b7280; margin:0 0 10px; }
  .pg-role-row  { font-size:0.8rem; color:#4b5563; margin:0 0 7px; display:flex; align-items:center; gap:8px; }
  .pg-role-row:last-child { margin-bottom:0; }
  .pg-badge { display:inline-block; padding:2px 9px; background:#1d4ed8; color:#fff; border-radius:20px; font-size:0.7rem; font-weight:600; flex-shrink:0; }
  .pg-badge.client { background:#0891b2; }
  .pg-legal { font-size:0.72rem; color:#d1d5db; text-align:center; padding-top:8px; border-top:1px solid #f3f4f6; margin:0; }
`;