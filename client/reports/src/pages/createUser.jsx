import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, User, Mail, Lock, Eye, EyeOff,
  AlertCircle, CheckCircle, Loader, ArrowLeft, UserPlus,
  Search, Building2, X, ChevronDown, MonitorPlay, Crown,
} from 'lucide-react';

const API = 'http://localhost:5000/api';

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  };
}

// ── Role config ───────────────────────────────────────────────
const ROLES = [
  {
    tipo:         3,
    key:          'client',
    label:        'Client',
    description:  'Portal access — arrivals & performance dashboard',
    icon:         Building2,
    color:        '#0891b2',
    needsAccount: true,
  },
  {
    tipo:         2,
    key:          'monitor',
    label:        'Monitor',
    description:  'Control room — situational awareness & live feeds',
    icon:         MonitorPlay,
    color:        '#7c3aed',
    needsAccount: false,
  },
  {
    tipo:         1,
    key:          'admin',
    label:        'Admin',
    description:  'Full system access — user management, analytics, settings',
    icon:         Crown,
    color:        '#1d4ed8',
    needsAccount: false,
  },
];

// ── Account search hook ───────────────────────────────────────
// Searches local m_cuentas via GET /api/auth/search?q=...
// This is the same table that /auth/admin/create validates cuentaId against,
// so IDs are guaranteed to match.
function useAccountSearch() {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const debounceRef = useRef(null);

  const search = useCallback((q) => {
    setQuery(q);
    setError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim() || q.trim().length < 2) { setResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        // ✅ FIX: Use GET /api/auth/search which queries m_cuentas directly.
        // Previously used POST /admin/search-accounts (external bmSecurityAPI),
        // whose IDs didn't exist in the local DB — causing "No account found
        // with cuentaId=XXXX" on create.
        const res = await fetch(
          `${API}/auth/search?q=${encodeURIComponent(q.trim())}`,
          { headers: authHeaders() },
        );
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Search failed');
        setResults(data.accounts || []);
      } catch (err) {
        setError(err.message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setError('');
    setLoading(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return { query, results, loading, error, search, clear };
}

// ── AccountPicker ─────────────────────────────────────────────
function AccountPicker({ selected, onSelect, disabled }) {
  const [open, setOpen] = useState(false);
  const { query, results, loading, error, search, clear } = useAccountSearch();
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (account) => { onSelect(account); setOpen(false); clear(); };
  const handleClear  = (e) => { e.stopPropagation(); onSelect(null); clear(); };
  const openDropdown = () => {
    if (disabled) return;
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div className="cu-field" ref={wrapRef}>
      <label className="cu-label">
        Client Account <span className="cu-required">required</span>
      </label>
      <div
        className={`cu-picker-trigger${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}
        onClick={openDropdown}
        role="combobox"
        aria-expanded={open}
      >
        <span className="cu-picker-icon"><Building2 size={15} /></span>
        {selected ? (
          <span className="cu-picker-selected">
            <span className="cu-picker-name">{selected.cue_cnombre}</span>
            <span className="cu-picker-meta">#{selected.cue_iid} · {selected.cue_cemail}</span>
          </span>
        ) : (
          <span className="cu-picker-placeholder">Search by company name or email…</span>
        )}
        <span className="cu-picker-actions">
          {selected && !disabled && (
            <button type="button" className="cu-picker-clear" onClick={handleClear} tabIndex={-1}>
              <X size={13} />
            </button>
          )}
          <ChevronDown size={14} className={`cu-picker-chevron${open ? ' rotated' : ''}`} />
        </span>
      </div>

      {open && (
        <div className="cu-dropdown">
          <div className="cu-dropdown-search">
            <Search size={14} className="cu-dropdown-search-icon" />
            <input
              ref={inputRef}
              className="cu-dropdown-input"
              type="text"
              placeholder="Type at least 2 characters…"
              value={query}
              onChange={(e) => search(e.target.value)}
              autoComplete="off"
            />
            {loading && <Loader size={13} className="cu-spin cu-dropdown-loader" />}
          </div>
          <div className="cu-dropdown-list">
            {error && (
              <div className="cu-dropdown-empty error">
                <AlertCircle size={14} /> {error}
              </div>
            )}
            {!error && query.trim().length >= 2 && !loading && results.length === 0 && (
              <div className="cu-dropdown-empty">No accounts found for &ldquo;{query}&rdquo;</div>
            )}
            {!error && query.trim().length < 2 && (
              <div className="cu-dropdown-empty hint">Start typing a company name or email address</div>
            )}
            {results.map((acc) => (
              <button
                key={acc.cue_iid}
                type="button"
                className="cu-dropdown-item"
                onClick={() => handleSelect(acc)}
              >
                <div className="cu-dropdown-item-avatar">
                  {(acc.cue_cnombre || '?')[0].toUpperCase()}
                </div>
                <div className="cu-dropdown-item-body">
                  <span className="cu-dropdown-item-name">{acc.cue_cnombre}</span>
                  <span className="cu-dropdown-item-sub">
                    {acc.cue_cemail}{acc.cue_ncuenta ? ` · Acct #${acc.cue_ncuenta}` : ''}
                  </span>
                </div>
                <span className="cu-dropdown-item-id">ID {acc.cue_iid}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="cu-hint">
        {selected
          ? `✓ Linked to account ID ${selected.cue_iid}`
          : 'The new user will be linked to this client account'}
      </p>
    </div>
  );
}

// ── Role Selector ─────────────────────────────────────────────
function RoleSelector({ value, onChange, disabled }) {
  return (
    <div className="cu-field">
      <label className="cu-label">Role</label>
      <div className="cu-role-grid">
        {ROLES.map((r) => {
          const Icon   = r.icon;
          const active = value === r.tipo;
          return (
            <button
              key={r.key}
              type="button"
              className={`cu-role-option${active ? ' active' : ''}`}
              style={{ '--role-color': r.color }}
              onClick={() => !disabled && onChange(r.tipo)}
              disabled={disabled}
            >
              <span className="cu-role-option-icon"><Icon size={16} /></span>
              <span className="cu-role-option-label">{r.label}</span>
              <span className="cu-role-option-desc">{r.description}</span>
              {active && <span className="cu-role-option-check">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function CreateUser() {
  const navigate = useNavigate();

  const [form,            setForm]            = useState({ username: '', email: '', password: '' });
  const [selectedTipo,    setSelectedTipo]    = useState(3);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [showPw,          setShowPw]          = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState('');
  const [created,         setCreated]         = useState(null);

  const selectedRole = ROLES.find(r => r.tipo === selectedTipo);

  const handleRoleChange = (tipo) => {
    setSelectedTipo(tipo);
    setSelectedAccount(null);
    setError('');
  };

  const update = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const validate = () => {
    if (!form.username.trim() || form.username.trim().length < 3)
      return 'Username must be at least 3 characters';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return 'Enter a valid email address';
    if (form.password.length < 6)
      return 'Temporary password must be at least 6 characters';
    if (selectedTipo === 3 && !selectedAccount)
      return 'Please select a client account';
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setLoading(true);
    setError('');
    try {
      const body = {
        username: form.username.trim(),
        email:    form.email.trim().toLowerCase(),
        password: form.password,
        tipo:     selectedTipo,
      };
      if (selectedTipo === 3 && selectedAccount) {
        body.cuentaId = Number(selectedAccount.cue_iid);
      }

      const res  = await fetch(`${API}/auth/admin/create`, {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to create account');

      setCreated({
        username:    form.username.trim(),
        email:       form.email.trim(),
        role:        selectedRole.label,
        roleKey:     selectedRole.key,
        roleColor:   selectedRole.color,
        accountName: selectedAccount?.cue_cnombre || null,
        accountId:   selectedAccount?.cue_iid     || null,
      });
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setCreated(null);
    setSelectedAccount(null);
    setSelectedTipo(3);
    setForm({ username: '', email: '', password: '' });
    setError('');
  };

  // ── Success screen ────────────────────────────────────────
  if (created) {
    return (
      <>
        <style>{STYLES}</style>
        <div className="cu-root">
          <div className="cu-success-card">
            <div className="cu-success-icon" style={{ '--role-color': created.roleColor }}>
              <CheckCircle size={36} color={created.roleColor} />
            </div>
            <h2 className="cu-success-title">Account Created</h2>
            <p className="cu-success-sub">
              Credentials sent to <strong>{created.email}</strong>.<br />
              {created.roleKey !== 'client'
                ? 'The user can log in immediately.'
                : 'The user must change their password on first login.'}
            </p>
            <div className="cu-summary">
              <SummaryRow label="Username" value={created.username} />
              <SummaryRow label="Email"    value={created.email} />
              <SummaryRow label="Role"     value={created.role} accent roleColor={created.roleColor} />
              {created.accountName && (
                <SummaryRow
                  label="Client Account"
                  value={`${created.accountName} (ID ${created.accountId})`}
                />
              )}
              {created.roleKey === 'client' && (
                <SummaryRow label="First login" value="Password change required ✓" success />
              )}
            </div>
            <div className="cu-success-actions">
              <button className="cu-btn-ghost"   onClick={reset}>Create Another</button>
              <button className="cu-btn-primary" onClick={() => navigate('/admin')}>Back to Dashboard</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Form ──────────────────────────────────────────────────
  return (
    <>
      <style>{STYLES}</style>
      <div className="cu-root">
        <div className="cu-layout">

          {/* ── Card ── */}
          <div className="cu-card">
            <button className="cu-back" onClick={() => navigate('/admin')}>
              <ArrowLeft size={14} /> Back to dashboard
            </button>

            <div className="cu-card-header">
              <div className="cu-shield-icon">
                <Shield size={20} color="#1d4ed8" />
              </div>
              <div>
                <h1 className="cu-card-title">Create User Account</h1>
                <p className="cu-card-sub">Admin access only · credentials sent by email</p>
              </div>
            </div>

            <div className="cu-notice">
              <AlertCircle size={15} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                The user receives a welcome email with a temporary password.
                {selectedTipo === 3 && ' Client users must change it on first login.'}
              </span>
            </div>

            <div className="cu-fields">
              {error && (
                <div className="cu-error">
                  <AlertCircle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{error}</span>
                </div>
              )}

              <RoleSelector value={selectedTipo} onChange={handleRoleChange} disabled={loading} />

              <Field label="Username" icon={<User size={15} />}>
                <input
                  className="cu-input"
                  type="text"
                  name="username"
                  value={form.username}
                  onChange={update}
                  disabled={loading}
                  placeholder={
                    selectedTipo === 2 ? 'e.g. monitor_john'
                    : selectedTipo === 1 ? 'e.g. admin_jane'
                    : 'Login username for this client'
                  }
                  autoComplete="off"
                />
              </Field>

              <Field label="Email Address" hint="Credentials will be sent here" icon={<Mail size={15} />}>
                <input
                  className="cu-input"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={update}
                  disabled={loading}
                  placeholder={
                    selectedTipo === 2 ? 'monitor@company.com'
                    : selectedTipo === 1 ? 'admin@company.com'
                    : 'client@company.com'
                  }
                  autoComplete="off"
                />
              </Field>

              {/* Account picker — only shown for client (tipo === 3) */}
              {selectedTipo === 3 && (
                <AccountPicker
                  selected={selectedAccount}
                  onSelect={setSelectedAccount}
                  disabled={loading}
                />
              )}

              <Field
                label="Temporary Password"
                hint={
                  selectedTipo === 3
                    ? 'Client must change this on first login'
                    : 'User can change this after logging in'
                }
                icon={<Lock size={15} />}
                suffix={
                  <button
                    type="button"
                    className="cu-eye"
                    tabIndex={-1}
                    onClick={() => setShowPw(p => !p)}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
              >
                <input
                  className="cu-input"
                  type={showPw ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={update}
                  disabled={loading}
                  placeholder="Min. 6 characters"
                  style={{ paddingRight: 40 }}
                />
              </Field>

              <button
                className="cu-btn-submit"
                style={{ '--role-color': selectedRole.color }}
                onClick={submit}
                disabled={loading}
              >
                {loading
                  ? <><Loader size={16} className="cu-spin" /> Creating account…</>
                  : <><UserPlus size={16} /> Create {selectedRole.label} Account &amp; Send Email</>
                }
              </button>
            </div>
          </div>

          {/* ── Info panel ── */}
          <div className="cu-info">
            <div className="cu-info-top">
              <h2 className="cu-info-title">Admin-Managed Access</h2>
              <p className="cu-info-desc">
                All accounts are provisioned by administrators only. Users receive credentials
                by email and can set a personal password after login.
              </p>
            </div>

            <div className="cu-steps">
              {[
                { n: '1', title: 'Select a role',           sub: 'Choose Admin, Monitor, or Client — each has different portal access and capabilities' },
                { n: '2', title: 'Fill in credentials',     sub: 'Set a username, email, and temporary password. Client accounts also link to an m_cuentas record' },
                { n: '3', title: 'System creates the user', sub: 'The account is inserted into m_usuarios with the correct usu_ntipo and usu_iidcuenta' },
                { n: '4', title: 'Welcome email is sent',   sub: 'User receives login credentials and a direct link to the portal or control room' },
              ].map(({ n, title, sub }) => (
                <div key={n} className="cu-step">
                  <div className="cu-step-num">{n}</div>
                  <div>
                    <p className="cu-step-title">{title}</p>
                    <p className="cu-step-sub">{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="cu-roles-panel">
              <p className="cu-roles-heading">Access levels</p>
              {ROLES.map(r => {
                const Icon = r.icon;
                return (
                  <p key={r.key} className="cu-role-row">
                    <span className="cu-role-badge" style={{ background: r.color }}>
                      <Icon size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      {r.label}
                    </span>
                    {r.description}
                  </p>
                );
              })}
            </div>

            <p className="cu-footer">Protected by BM Security · Trusted by businesses across Kenya</p>
          </div>

        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────
function Field({ label, hint, icon, suffix, children }) {
  return (
    <div className="cu-field">
      <label className="cu-label">{label}</label>
      <div className="cu-input-wrap">
        {icon && <span className="cu-icon">{icon}</span>}
        {children}
        {suffix}
      </div>
      {hint && <p className="cu-hint">{hint}</p>}
    </div>
  );
}

function SummaryRow({ label, value, accent, success, roleColor }) {
  return (
    <div className="cu-summary-row">
      <span className="cu-summary-label">{label}</span>
      <span
        className={`cu-summary-value${accent ? ' accent' : ''}${success ? ' success' : ''}`}
        style={accent && roleColor ? { color: roleColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');

  .cu-root {
    min-height: 100vh;
    background: #f0f4ff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    font-family: 'Sora', sans-serif;
  }

  .cu-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    width: 100%;
    max-width: 960px;
    align-items: start;
  }

  @media (max-width: 768px) {
    .cu-layout { grid-template-columns: 1fr; }
    .cu-info   { display: none; }
  }

  /* ── Card ── */
  .cu-card {
    background: #fff;
    border-radius: 20px;
    padding: 36px 32px;
    box-shadow: 0 4px 24px rgba(29,78,216,0.08), 0 1px 4px rgba(0,0,0,0.04);
    border: 1px solid #e0e7ff;
  }

  .cu-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #6b7280;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-bottom: 24px;
    transition: color .15s;
  }
  .cu-back:hover { color: #1d4ed8; }

  .cu-card-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 20px;
  }
  .cu-shield-icon {
    width: 44px; height: 44px;
    border-radius: 12px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .cu-card-title {
    font-family: 'Instrument Serif', serif;
    font-size: 1.35rem;
    color: #111827;
    margin: 0 0 2px;
  }
  .cu-card-sub { font-size: 0.75rem; color: #9ca3af; margin: 0; }

  .cu-notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 0.8rem;
    color: #1e40af;
    line-height: 1.5;
    margin-bottom: 24px;
  }
  .cu-error {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 0.8rem;
    color: #b91c1c;
    line-height: 1.5;
  }

  .cu-fields { display: flex; flex-direction: column; gap: 16px; }
  .cu-field  { display: flex; flex-direction: column; }
  .cu-label  {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7280;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .cu-required {
    font-size: 0.65rem;
    font-weight: 600;
    color: #dc2626;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 4px;
    padding: 1px 5px;
    letter-spacing: 0.04em;
  }
  .cu-hint { font-size: 0.72rem; color: #9ca3af; margin-top: 5px; }

  /* ── Role grid ── */
  .cu-role-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  @media (max-width: 500px) { .cu-role-grid { grid-template-columns: 1fr; } }

  .cu-role-option {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 12px;
    background: #f8faff;
    border: 1.5px solid #e0e7ff;
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    font-family: 'Sora', sans-serif;
    transition: border-color .2s, background .2s, box-shadow .2s;
  }
  .cu-role-option:hover:not(:disabled) {
    border-color: var(--role-color);
    background: #fff;
  }
  .cu-role-option.active {
    border-color: var(--role-color);
    background: #fff;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--role-color) 12%, transparent);
  }
  .cu-role-option:disabled { opacity: .55; cursor: not-allowed; }

  .cu-role-option-icon {
    width: 28px; height: 28px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--role-color) 12%, white);
    color: var(--role-color);
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 4px;
    flex-shrink: 0;
  }
  .cu-role-option.active .cu-role-option-icon {
    background: var(--role-color);
    color: #fff;
  }
  .cu-role-option-label { font-size: 0.8rem; font-weight: 700; color: #111827; }
  .cu-role-option-desc  { font-size: 0.67rem; color: #9ca3af; line-height: 1.4; }
  .cu-role-option-check {
    position: absolute;
    top: 8px; right: 9px;
    font-size: 0.65rem;
    font-weight: 800;
    color: var(--role-color);
  }

  /* ── Inputs ── */
  .cu-input-wrap { position: relative; }
  .cu-icon {
    position: absolute;
    left: 13px; top: 50%;
    transform: translateY(-50%);
    color: #9ca3af;
    display: flex;
    pointer-events: none;
  }
  .cu-eye {
    position: absolute;
    right: 12px; top: 50%;
    transform: translateY(-50%);
    color: #9ca3af;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    transition: color .15s;
  }
  .cu-eye:hover { color: #4b5563; }
  .cu-input {
    width: 100%;
    padding: 10px 13px 10px 38px;
    background: #f8faff;
    border: 1.5px solid #e0e7ff;
    border-radius: 10px;
    color: #111827;
    font-size: 0.875rem;
    font-family: 'Sora', sans-serif;
    outline: none;
    transition: border-color .2s, box-shadow .2s, background .2s;
    box-sizing: border-box;
  }
  .cu-input::placeholder { color: #c4cfe8; }
  .cu-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
    background: #fff;
  }
  .cu-input:disabled { opacity: .55; cursor: not-allowed; }

  /* ── Account picker ── */
  .cu-picker-trigger {
    width: 100%;
    padding: 10px 13px;
    background: #f8faff;
    border: 1.5px solid #e0e7ff;
    border-radius: 10px;
    color: #111827;
    font-size: 0.875rem;
    font-family: 'Sora', sans-serif;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: border-color .2s, box-shadow .2s, background .2s;
    box-sizing: border-box;
    position: relative;
    text-align: left;
    min-height: 42px;
  }
  .cu-picker-trigger:hover:not(.disabled) { border-color: #93c5fd; background: #fff; }
  .cu-picker-trigger.open {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
    background: #fff;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom-color: transparent;
  }
  .cu-picker-trigger.disabled { opacity: .55; cursor: not-allowed; }
  .cu-picker-icon     { color: #9ca3af; display: flex; flex-shrink: 0; }
  .cu-picker-selected { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .cu-picker-name     { font-size: 0.875rem; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cu-picker-meta     { font-size: 0.72rem; color: #6b7280; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cu-picker-placeholder { color: #c4cfe8; flex: 1; font-size: 0.875rem; }
  .cu-picker-actions  { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: auto; }
  .cu-picker-clear {
    background: none; border: none; cursor: pointer; padding: 2px;
    color: #9ca3af; display: flex; border-radius: 4px;
    transition: color .15s, background .15s;
  }
  .cu-picker-clear:hover { color: #dc2626; background: #fef2f2; }
  .cu-picker-chevron         { color: #9ca3af; transition: transform .2s; }
  .cu-picker-chevron.rotated { transform: rotate(180deg); }

  .cu-dropdown {
    position: relative; z-index: 50;
    background: #fff;
    border: 1.5px solid #3b82f6;
    border-top: none;
    border-bottom-left-radius: 10px;
    border-bottom-right-radius: 10px;
    box-shadow: 0 8px 24px rgba(29,78,216,0.12);
    overflow: hidden;
  }
  .cu-dropdown-search {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 13px;
    border-bottom: 1px solid #e0e7ff;
    background: #f8faff;
  }
  .cu-dropdown-search-icon { color: #9ca3af; flex-shrink: 0; }
  .cu-dropdown-input {
    flex: 1; border: none; background: transparent;
    font-family: 'Sora', sans-serif; font-size: 0.85rem; color: #111827; outline: none;
  }
  .cu-dropdown-input::placeholder { color: #c4cfe8; }
  .cu-dropdown-loader { color: #3b82f6; flex-shrink: 0; }
  .cu-dropdown-list   { max-height: 220px; overflow-y: auto; }
  .cu-dropdown-empty  {
    padding: 14px 16px; font-size: 0.8rem; color: #9ca3af;
    text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .cu-dropdown-empty.error { color: #dc2626; }
  .cu-dropdown-empty.hint  { color: #b0bac9; font-style: italic; }
  .cu-dropdown-item {
    width: 100%; display: flex; align-items: center; gap: 11px;
    padding: 10px 14px; border: none; background: transparent;
    cursor: pointer; text-align: left; font-family: 'Sora', sans-serif;
    transition: background .12s; border-bottom: 1px solid #f3f4f6;
  }
  .cu-dropdown-item:last-child { border-bottom: none; }
  .cu-dropdown-item:hover      { background: #eff6ff; }
  .cu-dropdown-item-avatar {
    width: 30px; height: 30px; border-radius: 8px;
    background: linear-gradient(135deg, #1d4ed8, #2563eb);
    color: #fff; font-size: 0.78rem; font-weight: 700;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .cu-dropdown-item-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .cu-dropdown-item-name { font-size: 0.85rem; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cu-dropdown-item-sub  { font-size: 0.72rem; color: #6b7280; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cu-dropdown-item-id   { font-size: 0.7rem; font-weight: 700; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 2px 7px; flex-shrink: 0; }

  /* ── Submit ── */
  .cu-btn-submit {
    width: 100%; padding: 12px;
    background: linear-gradient(135deg, var(--role-color, #1d4ed8), color-mix(in srgb, var(--role-color, #2563eb) 85%, white));
    color: #fff;
    font-size: 0.875rem; font-weight: 600;
    font-family: 'Sora', sans-serif;
    border: none; border-radius: 11px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    box-shadow: 0 4px 14px color-mix(in srgb, var(--role-color, #1d4ed8) 35%, transparent);
    transition: opacity .2s, transform .1s, box-shadow .2s;
    margin-top: 4px;
  }
  .cu-btn-submit:hover:not(:disabled) {
    opacity: .92;
    box-shadow: 0 6px 20px color-mix(in srgb, var(--role-color, #1d4ed8) 44%, transparent);
    transform: translateY(-1px);
  }
  .cu-btn-submit:disabled { opacity: .6; cursor: not-allowed; transform: none; }

  @keyframes spin { to { transform: rotate(360deg); } }
  .cu-spin { animation: spin .8s linear infinite; }

  /* ── Info panel ── */
  .cu-info { display: flex; flex-direction: column; gap: 28px; padding: 8px 0; }
  .cu-info-top { padding-bottom: 24px; border-bottom: 1px solid #e0e7ff; }
  .cu-info-title {
    font-family: 'Instrument Serif', serif;
    font-size: 1.6rem; color: #111827;
    margin: 0 0 10px; line-height: 1.2;
  }
  .cu-info-desc { font-size: 0.85rem; color: #6b7280; line-height: 1.65; margin: 0; }

  .cu-steps { display: flex; flex-direction: column; gap: 18px; }
  .cu-step  { display: flex; align-items: flex-start; gap: 14px; }
  .cu-step-num {
    width: 28px; height: 28px; border-radius: 50%;
    background: #eff6ff; border: 1.5px solid #bfdbfe;
    color: #1d4ed8; font-size: 0.75rem; font-weight: 700;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .cu-step-title { font-size: 0.85rem; font-weight: 600; color: #1f2937; margin: 0 0 3px; }
  .cu-step-sub   { font-size: 0.78rem; color: #9ca3af; margin: 0; line-height: 1.5; }

  .cu-roles-panel {
    background: #f8faff;
    border: 1px solid #e0e7ff;
    border-radius: 12px;
    padding: 16px 18px;
  }
  .cu-roles-heading {
    font-size: 0.72rem; font-weight: 700; letter-spacing: 0.07em;
    text-transform: uppercase; color: #6b7280; margin: 0 0 10px;
  }
  .cu-role-row {
    font-size: 0.8rem; color: #4b5563;
    margin: 0 0 8px; display: flex; align-items: center; gap: 8px; line-height: 1.4;
  }
  .cu-role-row:last-child { margin-bottom: 0; }
  .cu-role-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    color: #fff; border-radius: 20px;
    font-size: 0.7rem; font-weight: 600; flex-shrink: 0;
    white-space: nowrap;
  }

  .cu-footer {
    font-size: 0.72rem; color: #d1d5db; text-align: center;
    padding-top: 8px; border-top: 1px solid #f3f4f6; margin: 0;
  }

  /* ── Success ── */
  .cu-success-card {
    background: #fff; border-radius: 20px; padding: 48px 40px;
    box-shadow: 0 4px 24px rgba(29,78,216,0.08);
    border: 1px solid #e0e7ff;
    max-width: 460px; width: 100%; text-align: center;
  }
  .cu-success-icon {
    width: 72px; height: 72px; border-radius: 50%;
    background: color-mix(in srgb, var(--role-color, #1d4ed8) 10%, white);
    border: 1.5px solid color-mix(in srgb, var(--role-color, #1d4ed8) 25%, white);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 20px;
  }
  .cu-success-title {
    font-family: 'Instrument Serif', serif;
    font-size: 1.7rem; color: #111827; margin: 0 0 8px;
  }
  .cu-success-sub { font-size: 0.85rem; color: #6b7280; margin: 0 0 24px; line-height: 1.6; }
  .cu-success-sub strong { color: #1f2937; }
  .cu-summary {
    background: #f8faff; border: 1px solid #e0e7ff; border-radius: 12px;
    padding: 16px 18px; margin-bottom: 24px;
    text-align: left; display: flex; flex-direction: column; gap: 10px;
  }
  .cu-summary-row   { display: flex; justify-content: space-between; align-items: center; }
  .cu-summary-label { font-size: 0.78rem; color: #9ca3af; }
  .cu-summary-value { font-size: 0.78rem; font-weight: 600; color: #1f2937; }
  .cu-summary-value.success { color: #16a34a; }
  .cu-success-actions { display: flex; gap: 12px; }
  .cu-btn-ghost {
    flex: 1; padding: 11px;
    background: transparent; border: 1.5px solid #e0e7ff; border-radius: 11px;
    color: #6b7280; font-size: 0.875rem; font-weight: 600;
    font-family: 'Sora', sans-serif; cursor: pointer;
    transition: background .15s, color .15s;
  }
  .cu-btn-ghost:hover { background: #f0f4ff; color: #1d4ed8; }
  .cu-btn-primary {
    flex: 1; padding: 11px;
    background: linear-gradient(135deg, #1d4ed8, #2563eb);
    border: none; border-radius: 11px; color: #fff;
    font-size: 0.875rem; font-weight: 600;
    font-family: 'Sora', sans-serif; cursor: pointer;
    box-shadow: 0 4px 14px rgba(29,78,216,0.28);
    transition: opacity .15s, transform .1s;
  }
  .cu-btn-primary:hover { opacity: .9; transform: translateY(-1px); }
`;