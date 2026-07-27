import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader, Shield, KeyRound } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' };
}

function PasswordStrength({ password }) {
  if (!password) return null;
  const checks = [
    { label: '6+ characters', pass: password.length >= 6 },
    { label: 'Uppercase',     pass: /[A-Z]/.test(password) },
    { label: 'Number',        pass: /[0-9]/.test(password) },
    { label: 'Special char',  pass: /[^A-Za-z0-9]/.test(password) },
  ];
  const score  = checks.filter(c => c.pass).length;
  const colors = ['#ef4444','#f97316','#eab308','#16a34a'];
  const labels = ['Weak','Fair','Good','Strong'];
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display:'flex', gap:4, marginBottom:6 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ height:3, flex:1, borderRadius:99, background: i < score ? colors[score-1] : '#e0e7ff', transition:'background .3s' }} />
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 12px' }}>
          {checks.map(({ label, pass }) => (
            <span key={label} style={{ fontSize:'0.72rem', color: pass ? '#16a34a' : '#9ca3af', display:'flex', alignItems:'center', gap:3 }}>
              {pass ? '✓' : '○'} {label}
            </span>
          ))}
        </div>
        {score > 0 && <span style={{ fontSize:'0.72rem', fontWeight:700, color: colors[score-1] }}>{labels[score-1]}</span>}
      </div>
    </div>
  );
}

export default function ChangePassword({ isFirstLogin = false }) {
  const navigate  = useNavigate();
  const user      = JSON.parse(localStorage.getItem('user') || '{}');
  const firstLogin = isFirstLogin || user.mustChangePassword === true;

  const [form,    setForm]    = useState({ currentPassword:'', newPassword:'', confirmPassword:'' });
  const [show,    setShow]    = useState({ current:false, new:false, confirm:false });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState(false);

  const update = (e) => { setForm(p => ({ ...p, [e.target.name]: e.target.value })); setError(''); };
  const toggleShow = (f) => setShow(p => ({ ...p, [f]: !p[f] }));

  const submit = async () => {
    const { currentPassword, newPassword, confirmPassword } = form;
    if (!currentPassword || !newPassword || !confirmPassword) return setError('All fields are required');
    if (newPassword.length < 6) return setError('New password must be at least 6 characters');
    if (newPassword !== confirmPassword) return setError('New passwords do not match');
    if (newPassword === currentPassword) return setError('New password must differ from your current password');
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API}/auth/change-password`, { method:'PUT', headers:authHeaders(), body:JSON.stringify({ currentPassword, newPassword }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to change password');
      localStorage.setItem('user', JSON.stringify({ ...user, mustChangePassword:false }));
      window.dispatchEvent(new Event('storage'));
      setSuccess(true);
      setTimeout(() => navigate(user.role === 'client' ? '/client-dashboard' : '/admin', { replace:true }), 2200);
    } catch (err) { setError(err.message || 'Something went wrong.'); }
    finally { setLoading(false); }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') submit(); };

  if (success) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="cp-root">
          <div className="cp-success">
            <div className="cp-success-icon"><CheckCircle size={36} color="#16a34a" /></div>
            <h2 className="cp-success-title">Password Updated</h2>
            <p className="cp-success-sub">Your account is secured. Redirecting you now…</p>
            <Loader size={20} className="cp-spin" style={{ color:'#16a34a', margin:'16px auto 0', display:'block' }} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="cp-root">
        <div className="cp-layout">

          {/* ── Form card ── */}
          <div className="cp-card">
            <div className="cp-card-header">
              <div className="cp-key-icon"><KeyRound size={20} color="#1d4ed8" /></div>
              <div>
                <h1 className="cp-card-title">{firstLogin ? 'Set Your Password' : 'Change Password'}</h1>
                <p className="cp-card-sub">{firstLogin ? 'Required before you can access the portal' : 'Update your account password'}</p>
              </div>
            </div>

            {firstLogin && (
              <div className="cp-warning">
                <AlertCircle size={15} color="#d97706" style={{ flexShrink:0, marginTop:1 }} />
                <div>
                  <p className="cp-warning-title">First login — password change required</p>
                  <p className="cp-warning-sub">Enter the temporary password from your welcome email, then choose a new one.</p>
                </div>
              </div>
            )}

            <div className="cp-fields">
              {error && (
                <div className="cp-alert">
                  <AlertCircle size={15} color="#dc2626" style={{ flexShrink:0, marginTop:1 }} />
                  <span>{error}</span>
                </div>
              )}

              {[
                { key:'current', label: firstLogin ? 'Temporary Password (from email)' : 'Current Password' },
                { key:'new',     label:'New Password',     strength:true },
                { key:'confirm', label:'Confirm New Password', match:true },
              ].map(({ key, label, strength, match }) => (
                <div className="cp-field" key={key}>
                  <label className="cp-label">{label}</label>
                  <div className="cp-input-wrap">
                    <span className="cp-icon"><Lock size={15} /></span>
                    <input className="cp-input"
                      type={show[key] ? 'text' : 'password'}
                      name={key === 'current' ? 'currentPassword' : key === 'new' ? 'newPassword' : 'confirmPassword'}
                      value={form[key === 'current' ? 'currentPassword' : key === 'new' ? 'newPassword' : 'confirmPassword']}
                      onChange={update} onKeyDown={onKeyDown}
                      placeholder="••••••••" disabled={loading}
                      autoComplete={key === 'current' ? 'current-password' : 'new-password'}
                      style={{ paddingRight:42 }} />
                    <button className="cp-eye" type="button" tabIndex={-1} onClick={() => toggleShow(key)}>
                      {show[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {strength && <PasswordStrength password={form.newPassword} />}
                  {match && form.confirmPassword && (
                    <p style={{ fontSize:'0.72rem', marginTop:5, color: form.newPassword === form.confirmPassword ? '#16a34a' : '#dc2626' }}>
                      {form.newPassword === form.confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                    </p>
                  )}
                </div>
              ))}

              <button className="cp-btn-primary" onClick={submit} disabled={loading}>
                {loading
                  ? <><Loader size={15} className="cp-spin" /> Updating…</>
                  : firstLogin ? 'Set Password & Continue' : 'Update Password'}
              </button>

              {!firstLogin && (
                <button className="cp-btn-cancel" type="button" onClick={() => navigate(-1)}>Cancel</button>
              )}
            </div>
          </div>

          {/* ── Tips panel ── */}
          <div className="cp-info">
            <div className="cp-info-top">
              <h2 className="cp-info-title">Password Security Tips</h2>
              <p className="cp-info-desc">A strong password protects your security data.</p>
            </div>

            <div className="cp-tips">
              {[
                { icon:'✓', tip:'Use at least 6 characters (8+ recommended)', warn:false },
                { icon:'✓', tip:'Mix uppercase and lowercase letters',          warn:false },
                { icon:'✓', tip:'Include numbers and special characters',       warn:false },
                { icon:'✗', tip:"Don't reuse passwords from other sites",       warn:true  },
                { icon:'✗', tip:"Don't share your password with anyone",        warn:true  },
              ].map(({ icon, tip, warn }) => (
                <div key={tip} className="cp-tip">
                  <span className={`cp-tip-dot${warn ? ' warn' : ''}`}>{icon}</span>
                  <p className="cp-tip-text" style={{ color: warn ? '#b91c1c' : '#4b5563' }}>{tip}</p>
                </div>
              ))}
            </div>

            <div className="cp-secure-box">
              <div className="cp-secure-row"><Shield size={15} color="#1d4ed8" /><p className="cp-secure-title">Your session is secure</p></div>
              <p className="cp-secure-sub">This connection is encrypted. Your new password takes effect immediately.</p>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
  .cp-root { min-height:100vh; background:#f0f4ff; display:flex; align-items:center; justify-content:center; padding:32px 16px; font-family:'Sora',sans-serif; }
  .cp-layout { display:grid; grid-template-columns:1fr 1fr; gap:36px; width:100%; max-width:920px; align-items:start; }
  @media(max-width:768px){ .cp-layout{grid-template-columns:1fr} .cp-info{display:none} }
  .cp-card { background:#fff; border-radius:20px; padding:36px 32px; box-shadow:0 4px 28px rgba(29,78,216,0.09),0 1px 4px rgba(0,0,0,0.04); border:1px solid #e0e7ff; }
  .cp-card-header { display:flex; align-items:center; gap:14px; margin-bottom:20px; }
  .cp-key-icon { width:44px; height:44px; border-radius:12px; background:#eff6ff; border:1px solid #bfdbfe; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .cp-card-title { font-family:'Instrument Serif',serif; font-size:1.3rem; color:#111827; margin:0 0 2px; }
  .cp-card-sub   { font-size:0.75rem; color:#9ca3af; margin:0; }
  .cp-warning { display:flex; align-items:flex-start; gap:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:12px 14px; margin-bottom:20px; }
  .cp-warning-title { font-size:0.8rem; font-weight:600; color:#92400e; margin:0 0 3px; }
  .cp-warning-sub   { font-size:0.75rem; color:#b45309; margin:0; line-height:1.5; }
  .cp-fields { display:flex; flex-direction:column; gap:16px; }
  .cp-alert  { display:flex; align-items:flex-start; gap:9px; background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:11px 14px; font-size:0.8rem; color:#b91c1c; line-height:1.5; }
  .cp-field  { display:flex; flex-direction:column; }
  .cp-label  { font-size:0.7rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280; margin-bottom:6px; }
  .cp-input-wrap { position:relative; }
  .cp-icon { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:#9ca3af; display:flex; pointer-events:none; }
  .cp-eye  { position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#9ca3af; background:none; border:none; cursor:pointer; padding:0; display:flex; transition:color .15s; }
  .cp-eye:hover { color:#4b5563; }
  .cp-input { width:100%; padding:11px 13px 11px 38px; background:#f8faff; border:1.5px solid #e0e7ff; border-radius:10px; color:#111827; font-size:0.875rem; font-family:'Sora',sans-serif; outline:none; transition:border-color .2s,box-shadow .2s,background .2s; box-sizing:border-box; }
  .cp-input::placeholder { color:#c4cfe8; }
  .cp-input:focus { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.12); background:#fff; }
  .cp-input:disabled { opacity:.55; cursor:not-allowed; }
  .cp-btn-primary { width:100%; padding:12px; background:linear-gradient(135deg,#1d4ed8,#2563eb); color:#fff; font-size:0.875rem; font-weight:600; font-family:'Sora',sans-serif; border:none; border-radius:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 14px rgba(29,78,216,0.3); transition:opacity .2s,transform .1s; margin-top:4px; }
  .cp-btn-primary:hover:not(:disabled) { opacity:.92; transform:translateY(-1px); }
  .cp-btn-primary:disabled { opacity:.6; cursor:not-allowed; transform:none; }
  .cp-btn-cancel { width:100%; padding:10px; background:transparent; border:1.5px solid #e0e7ff; border-radius:11px; color:#6b7280; font-size:0.875rem; font-weight:600; font-family:'Sora',sans-serif; cursor:pointer; transition:background .15s,color .15s; }
  .cp-btn-cancel:hover { background:#f0f4ff; color:#1d4ed8; }
  @keyframes cp-spin { to { transform:rotate(360deg); } }
  .cp-spin { animation:cp-spin .8s linear infinite; }
  .cp-info { display:flex; flex-direction:column; gap:28px; padding:8px 0; }
  .cp-info-top   { padding-bottom:24px; border-bottom:1px solid #e0e7ff; }
  .cp-info-title { font-family:'Instrument Serif',serif; font-size:1.6rem; color:#111827; margin:0 0 8px; }
  .cp-info-desc  { font-size:0.85rem; color:#6b7280; margin:0; line-height:1.65; }
  .cp-tips { display:flex; flex-direction:column; gap:12px; }
  .cp-tip  { display:flex; align-items:center; gap:12px; }
  .cp-tip-dot { width:26px; height:26px; border-radius:50%; background:#f0fdf4; border:1px solid #bbf7d0; color:#16a34a; font-size:0.75rem; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .cp-tip-dot.warn { background:#fef2f2; border-color:#fecaca; color:#dc2626; }
  .cp-tip-text { font-size:0.82rem; margin:0; line-height:1.5; }
  .cp-secure-box  { background:#f8faff; border:1px solid #e0e7ff; border-radius:12px; padding:16px 18px; }
  .cp-secure-row  { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .cp-secure-title{ font-size:0.85rem; font-weight:600; color:#1f2937; margin:0; }
  .cp-secure-sub  { font-size:0.78rem; color:#6b7280; margin:0; line-height:1.55; }
  .cp-success { background:#fff; border-radius:20px; padding:52px 40px; box-shadow:0 4px 28px rgba(29,78,216,0.09); border:1px solid #e0e7ff; max-width:420px; width:100%; text-align:center; }
  .cp-success-icon  { width:72px; height:72px; border-radius:50%; background:#f0fdf4; border:1.5px solid #bbf7d0; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
  .cp-success-title { font-family:'Instrument Serif',serif; font-size:1.7rem; color:#111827; margin:0 0 8px; }
  .cp-success-sub   { font-size:0.85rem; color:#6b7280; margin:0; line-height:1.6; }
`;