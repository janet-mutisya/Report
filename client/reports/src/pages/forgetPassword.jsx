import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, AlertCircle, Loader, CheckCircle, Shield, ArrowLeft } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function ForgotPassword() {
  const navigate  = useNavigate();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [sent,    setSent]    = useState(false);

  const submit = async () => {
    if (!email.trim()) { setError('Please enter your email address'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API}/auth/forgot-password`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email: email.trim() }) });
      const data = await res.json();
      if (!res.ok && !data.success) throw new Error(data.message);
      setSent(true);
    } catch (err) { setError(err.message || 'Something went wrong. Please try again.'); }
    finally { setLoading(false); }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') submit(); };

  if (sent) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="fp-root">
          <div className="fp-success">
            <div className="fp-success-icon"><CheckCircle size={36} color="#1d4ed8" /></div>
            <h2 className="fp-success-title">Check Your Inbox</h2>
            <p className="fp-success-sub">
              If <strong>{email}</strong> is registered, a new temporary password has been sent.
            </p>
            <p className="fp-success-note">Use it to log in — you'll be prompted to set a new password immediately.</p>
            <div className="fp-tips-box">
              <p className="fp-tips-heading">Didn't receive it?</p>
              <p className="fp-tips-item">· Check your spam or junk folder</p>
              <p className="fp-tips-item">· Make sure you used the email linked to your account</p>
              <p className="fp-tips-item">· Contact your administrator if the issue persists</p>
            </div>
            <button className="fp-btn-primary" onClick={() => navigate('/login')}>Back to Login</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="fp-root">
        <div className="fp-layout">

          {/* ── Form card ── */}
          <div className="fp-card">
            <button className="fp-back" onClick={() => navigate('/login')}>
              <ArrowLeft size={14} /> Back to login
            </button>

            <div className="fp-card-header">
              <div className="fp-mail-icon"><Mail size={20} color="#1d4ed8" /></div>
              <div>
                <h1 className="fp-card-title">Forgot Your Password?</h1>
                <p className="fp-card-sub">We'll send a temporary password to your email</p>
              </div>
            </div>

            <div className="fp-fields">
              {error && (
                <div className="fp-alert">
                  <AlertCircle size={15} color="#dc2626" style={{ flexShrink:0, marginTop:1 }} />
                  <span>{error}</span>
                </div>
              )}

              <div className="fp-field">
                <label className="fp-label">Email Address</label>
                <div className="fp-input-wrap">
                  <span className="fp-icon"><Mail size={15} /></span>
                  <input className="fp-input" type="email" value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    onKeyDown={onKeyDown} placeholder="you@bmsecurity.com"
                    disabled={loading} autoComplete="email" />
                </div>
                <p className="fp-hint">Staff: use the email linked to your account · Clients: your registered email</p>
              </div>

              <button className="fp-btn-primary" onClick={submit} disabled={loading || !email.trim()}>
                {loading ? <><Loader size={15} className="fp-spin" /> Sending…</> : 'Send Temporary Password'}
              </button>

              <p className="fp-signin-note">
                Remember your password?{' '}
                <button className="fp-signin-link" onClick={() => navigate('/login')}>Sign in</button>
              </p>
            </div>
          </div>

          {/* ── Info panel ── */}
          <div className="fp-info">
            <div className="fp-info-top">
              <h2 className="fp-info-title">Password Recovery</h2>
              <p className="fp-info-desc">We'll get you back in within minutes.</p>
            </div>

            <div className="fp-steps">
              {[
                { n:'1', title:'Enter your email',             sub:'The email address linked to your staff or client account' },
                { n:'2', title:'Receive a temporary password', sub:'Sent instantly — check your inbox and spam folder' },
                { n:'3', title:'Log in & set a new password',  sub:"The portal will prompt you to change it immediately on login" },
              ].map(({ n, title, sub }) => (
                <div key={n} className="fp-step">
                  <div className="fp-step-num">{n}</div>
                  <div><p className="fp-step-title">{title}</p><p className="fp-step-sub">{sub}</p></div>
                </div>
              ))}
            </div>

            <div className="fp-security-box">
              <div className="fp-security-row"><Shield size={15} color="#1d4ed8" /><p className="fp-security-title">Security note</p></div>
              <p className="fp-security-sub">For your protection, we never confirm whether an email is registered. If nothing arrives, check your spam or contact your administrator.</p>
            </div>

            <p className="fp-legal">Protected by BM Security · Trusted by businesses across Kenya</p>
          </div>
        </div>
      </div>
    </>
  );
}

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
  .fp-root { min-height:100vh; background:#f0f4ff; display:flex; align-items:center; justify-content:center; padding:32px 16px; font-family:'Sora',sans-serif; }
  .fp-layout { display:grid; grid-template-columns:1fr 1fr; gap:36px; width:100%; max-width:920px; align-items:start; }
  @media(max-width:768px){ .fp-layout{grid-template-columns:1fr} .fp-info{display:none} }
  .fp-card { background:#fff; border-radius:20px; padding:36px 32px; box-shadow:0 4px 28px rgba(29,78,216,0.09),0 1px 4px rgba(0,0,0,0.04); border:1px solid #e0e7ff; }
  .fp-back { display:inline-flex; align-items:center; gap:6px; font-size:0.72rem; font-weight:600; letter-spacing:0.07em; text-transform:uppercase; color:#6b7280; background:none; border:none; cursor:pointer; padding:0; margin-bottom:24px; transition:color .15s; font-family:'Sora',sans-serif; }
  .fp-back:hover { color:#1d4ed8; }
  .fp-card-header { display:flex; align-items:center; gap:14px; margin-bottom:24px; }
  .fp-mail-icon { width:44px; height:44px; border-radius:12px; background:#eff6ff; border:1px solid #bfdbfe; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .fp-card-title { font-family:'Instrument Serif',serif; font-size:1.3rem; color:#111827; margin:0 0 2px; }
  .fp-card-sub   { font-size:0.75rem; color:#9ca3af; margin:0; }
  .fp-fields { display:flex; flex-direction:column; gap:16px; }
  .fp-alert  { display:flex; align-items:flex-start; gap:9px; background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:11px 14px; font-size:0.8rem; color:#b91c1c; line-height:1.5; }
  .fp-field  { display:flex; flex-direction:column; }
  .fp-label  { font-size:0.7rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280; margin-bottom:6px; }
  .fp-hint   { font-size:0.72rem; color:#9ca3af; margin-top:5px; }
  .fp-input-wrap { position:relative; }
  .fp-icon { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:#9ca3af; display:flex; pointer-events:none; }
  .fp-input { width:100%; padding:11px 13px 11px 38px; background:#f8faff; border:1.5px solid #e0e7ff; border-radius:10px; color:#111827; font-size:0.875rem; font-family:'Sora',sans-serif; outline:none; transition:border-color .2s,box-shadow .2s,background .2s; box-sizing:border-box; }
  .fp-input::placeholder { color:#c4cfe8; }
  .fp-input:focus { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.12); background:#fff; }
  .fp-input:disabled { opacity:.55; cursor:not-allowed; }
  .fp-btn-primary { width:100%; padding:12px; background:linear-gradient(135deg,#1d4ed8,#2563eb); color:#fff; font-size:0.875rem; font-weight:600; font-family:'Sora',sans-serif; border:none; border-radius:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 14px rgba(29,78,216,0.3); transition:opacity .2s,transform .1s; }
  .fp-btn-primary:hover:not(:disabled) { opacity:.92; transform:translateY(-1px); }
  .fp-btn-primary:disabled { opacity:.5; cursor:not-allowed; transform:none; }
  @keyframes fp-spin { to { transform:rotate(360deg); } }
  .fp-spin { animation:fp-spin .8s linear infinite; }
  .fp-signin-note { text-align:center; font-size:0.75rem; color:#9ca3af; }
  .fp-signin-link { font-weight:600; color:#2563eb; background:none; border:none; cursor:pointer; padding:0; font-family:'Sora',sans-serif; font-size:0.75rem; transition:color .15s; }
  .fp-signin-link:hover { color:#1d4ed8; }
  .fp-info { display:flex; flex-direction:column; gap:28px; padding:8px 0; }
  .fp-info-top   { padding-bottom:24px; border-bottom:1px solid #e0e7ff; }
  .fp-info-title { font-family:'Instrument Serif',serif; font-size:1.6rem; color:#111827; margin:0 0 8px; }
  .fp-info-desc  { font-size:0.85rem; color:#6b7280; margin:0; line-height:1.65; }
  .fp-steps { display:flex; flex-direction:column; gap:18px; }
  .fp-step  { display:flex; align-items:flex-start; gap:14px; }
  .fp-step-num   { width:28px; height:28px; border-radius:50%; background:#eff6ff; border:1.5px solid #bfdbfe; color:#1d4ed8; font-size:0.75rem; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .fp-step-title { font-size:0.85rem; font-weight:600; color:#1f2937; margin:0 0 3px; }
  .fp-step-sub   { font-size:0.78rem; color:#9ca3af; margin:0; line-height:1.5; }
  .fp-security-box  { background:#f8faff; border:1px solid #e0e7ff; border-radius:12px; padding:16px 18px; }
  .fp-security-row  { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .fp-security-title{ font-size:0.85rem; font-weight:600; color:#1f2937; margin:0; }
  .fp-security-sub  { font-size:0.78rem; color:#6b7280; margin:0; line-height:1.55; }
  .fp-legal { font-size:0.72rem; color:#d1d5db; text-align:center; padding-top:8px; border-top:1px solid #f3f4f6; margin:0; }
  .fp-success { background:#fff; border-radius:20px; padding:48px 40px; box-shadow:0 4px 28px rgba(29,78,216,0.09); border:1px solid #e0e7ff; max-width:460px; width:100%; text-align:center; }
  .fp-success-icon  { width:72px; height:72px; border-radius:50%; background:#eff6ff; border:1.5px solid #bfdbfe; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
  .fp-success-title { font-family:'Instrument Serif',serif; font-size:1.7rem; color:#111827; margin:0 0 8px; }
  .fp-success-sub   { font-size:0.85rem; color:#4b5563; margin:0 0 8px; line-height:1.6; }
  .fp-success-sub strong { color:#111827; }
  .fp-success-note  { font-size:0.8rem; color:#9ca3af; margin:0 0 20px; }
  .fp-tips-box     { background:#f8faff; border:1px solid #e0e7ff; border-radius:12px; padding:14px 16px; margin-bottom:20px; text-align:left; }
  .fp-tips-heading { font-size:0.75rem; font-weight:700; color:#6b7280; margin:0 0 8px; }
  .fp-tips-item    { font-size:0.78rem; color:#9ca3af; margin:0 0 5px; }
  .fp-tips-item:last-child { margin-bottom:0; }
`;