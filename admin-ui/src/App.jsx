import React, { useState, useEffect, useCallback } from 'react';

const API = '/api';

function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 300000;
}

// Dashboard
function Dashboard({ onSelectApp }) {
  const [apps, setApps] = useState([]);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch(`${API}/apps`).then(r => r.json()).then(setApps).catch(() => {});
    fetch('/health').then(r => r.json()).then(setHealth).catch(() => {});
  }, []);

  return (
    <div>
      <h1>Dashboard</h1>
      {health && (
        <div style={{ marginBottom: 20, color: 'var(--text-secondary)', fontSize: 14 }}>
          Service v{health.version} · Uptime {Math.floor(health.uptime / 60)}m · {health.appCount} apps registered
        </div>
      )}
      {apps.length === 0 ? (
        <div className="empty">No apps registered yet. Apps will appear here when they connect.</div>
      ) : (
        <div className="cards">
          {apps.map(app => (
            <div key={app.app} className="card" onClick={() => onSelectApp(app.app)}>
              <h3>
                <span className={`status-dot ${isOnline(app.last_seen) ? 'online' : 'offline'}`} />
                {app.display_name || app.app}
              </h3>
              <div className="meta">
                <span>App ID: <code>{app.app}</code></span>
                {app.version && <span>Version: {app.version}</span>}
                <span>Keys: {app.config_count || 0}</span>
                <span>Last seen: {timeAgo(app.last_seen)}</span>
                <span>
                  <span className={`badge ${isOnline(app.last_seen) ? 'badge-online' : 'badge-offline'}`}>
                    {isOnline(app.last_seen) ? 'online' : 'offline'}
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// App Config page
function AppConfig({ appName, onBack }) {
  const [configs, setConfigs] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [showSecrets, setShowSecrets] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState('string');
  const [newDesc, setNewDesc] = useState('');
  const [newSecret, setNewSecret] = useState(false);

  const loadConfigs = useCallback(() => {
    fetch(`${API}/config-details/${appName}`).then(r => r.json()).then(setConfigs).catch(() => {});
  }, [appName]);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  const startEdit = (key, value) => {
    setEditing(key);
    setEditValue(typeof value === 'string' ? value : JSON.stringify(value));
  };

  const saveEdit = async (key) => {
    let parsed;
    try { parsed = JSON.parse(editValue); } catch { parsed = editValue; }
    await fetch(`${API}/config/${appName}/${key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: parsed }),
    });
    setEditing(null);
    loadConfigs();
  };

  const toggleSecret = async (row) => {
    await fetch(`${API}/config/${appName}/${row.key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.parse(row.value), is_secret: row.is_secret ? false : true }),
    });
    loadConfigs();
  };

  const deleteKey = async (key) => {
    if (!confirm(`Delete key "${key}"?`)) return;
    await fetch(`${API}/config/${appName}/${key}`, { method: 'DELETE' });
    loadConfigs();
  };

  const addKey = async () => {
    if (!newKey) return;
    let parsed;
    if (newType === 'number') parsed = Number(newValue);
    else if (newType === 'boolean') parsed = newValue === 'true';
    else if (newType === 'json') { try { parsed = JSON.parse(newValue); } catch { parsed = newValue; } }
    else parsed = newValue;

    await fetch(`${API}/config/${appName}/${newKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: parsed, is_secret: newSecret, description: newDesc }),
    });
    setShowAddModal(false);
    setNewKey(''); setNewValue(''); setNewDesc(''); setNewSecret(false); setNewType('string');
    loadConfigs();
  };

  return (
    <div>
      <div className="toolbar">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1 style={{ margin: 0 }}>{appName}</h1>
        <button onClick={() => setShowAddModal(true)}>+ Add Key</button>
      </div>
      {configs.length === 0 ? (
        <div className="empty">No configuration keys yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th>Type</th>
              <th>Secret</th>
              <th>Description</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {configs.map(row => {
              const val = (() => { try { return JSON.parse(row.value); } catch { return row.value; } })();
              const display = row.is_secret && !showSecrets[row.key] ? '•••••' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
              return (
                <tr key={row.key}>
                  <td><code>{row.key}</code></td>
                  <td>
                    {editing === row.key ? (
                      <input
                        className="inline-edit"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(row.key); if (e.key === 'Escape') setEditing(null); }}
                        autoFocus
                      />
                    ) : (
                      <span onClick={() => startEdit(row.key, val)} style={{ cursor: 'pointer' }}>
                        {display}
                      </span>
                    )}
                    {row.is_secret && (
                      <button className="eye-btn" onClick={() => setShowSecrets(s => ({ ...s, [row.key]: !s[row.key] }))}>
                        {showSecrets[row.key] ? '🙈' : '👁'}
                      </button>
                    )}
                  </td>
                  <td><span className="badge badge-type">{row.value_type}</span></td>
                  <td>
                    <label className="toggle">
                      <input type="checkbox" checked={!!row.is_secret} onChange={() => toggleSecret(row)} />
                      <span className="toggle-slider" />
                    </label>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{row.description || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{timeAgo(row.updated_at)}</td>
                  <td>
                    <button className="danger small" onClick={() => deleteKey(row.key)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Config Key</h3>
            <div className="form-group">
              <label>Key (dot-path)</label>
              <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="api.port" />
            </div>
            <div className="form-group">
              <label>Value</label>
              <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="5176" />
            </div>
            <div className="form-group">
              <label>Type</label>
              <select value={newType} onChange={e => setNewType(e.target.value)}>
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="json">json</option>
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional description" />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="toggle" style={{ marginBottom: 0 }}>
                <input type="checkbox" checked={newSecret} onChange={e => setNewSecret(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
              <span style={{ fontSize: 13 }}>Secret</span>
            </div>
            <div className="form-actions">
              <button className="back-btn" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button onClick={addKey}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Audit Log
function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [appFilter, setAppFilter] = useState('');
  const [apps, setApps] = useState([]);

  useEffect(() => {
    fetch(`${API}/apps`).then(r => r.json()).then(data => setApps(data.map(a => a.app))).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (appFilter) params.set('app', appFilter);
    params.set('limit', '100');
    fetch(`${API}/audit?${params}`).then(r => r.json()).then(setLogs).catch(() => {});
  }, [appFilter]);

  return (
    <div>
      <h1>Audit Log</h1>
      <div className="toolbar">
        <select value={appFilter} onChange={e => setAppFilter(e.target.value)}>
          <option value="">All Apps</option>
          {apps.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {logs.length === 0 ? (
        <div className="empty">No audit entries yet.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Time</th><th>App</th><th>Key</th><th>Event</th><th>Old Value</th><th>New Value</th></tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td><code>{log.app}</code></td>
                <td><code>{log.key || '—'}</code></td>
                <td><span className={`event-tag event-${log.event}`}>{log.event}</span></td>
                <td style={{ fontSize: 13 }}>{log.old_value || '—'}</td>
                <td style={{ fontSize: 13 }}>{log.new_value || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Settings
function Settings() {
  const [settings, setSettings] = useState({ requireToken: false, token: '', allowSelfRegister: true });
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load settings from config service's own config
    fetch(`${API}/config/config-service`).then(r => r.json()).then(data => {
      setSettings({
        requireToken: data['api.auth.require_token'] || false,
        token: data['api.auth.token'] || '',
        allowSelfRegister: data['settings.allow_self_register'] !== false,
      });
    }).catch(() => {});
  }, []);

  const generateToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) token += chars[Math.floor(Math.random() * chars.length)];
    setSettings(s => ({ ...s, token }));
  };

  const save = async () => {
    const updates = [
      { key: 'api.auth.require_token', value: settings.requireToken },
      { key: 'api.auth.token', value: settings.token, is_secret: true },
      { key: 'settings.allow_self_register', value: settings.allowSelfRegister },
    ];
    for (const u of updates) {
      await fetch(`${API}/config/config-service/${u.key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: u.value, is_secret: u.is_secret }),
      });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h1>Settings</h1>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 24, maxWidth: 500 }}>
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <label className="toggle" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={settings.requireToken} onChange={e => setSettings(s => ({ ...s, requireToken: e.target.checked }))} />
            <span className="toggle-slider" />
          </label>
          <div>
            <div style={{ fontWeight: 600 }}>Require Auth Token</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>API requests must include Bearer token</div>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 20 }}>
          <label>API Token</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={showToken ? 'text' : 'password'}
              value={settings.token}
              onChange={e => setSettings(s => ({ ...s, token: e.target.value }))}
              style={{ flex: 1 }}
            />
            <button className="eye-btn" onClick={() => setShowToken(!showToken)}>{showToken ? '🙈' : '👁'}</button>
            <button onClick={generateToken} style={{ fontSize: 12 }}>Generate</button>
          </div>
        </div>

        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <label className="toggle" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={settings.allowSelfRegister} onChange={e => setSettings(s => ({ ...s, allowSelfRegister: e.target.checked }))} />
            <span className="toggle-slider" />
          </label>
          <div>
            <div style={{ fontWeight: 600 }}>Allow Self-Registration</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Apps can register themselves via PUT</div>
          </div>
        </div>

        <div className="form-actions">
          <button onClick={save}>{saved ? '✓ Saved' : 'Save Settings'}</button>
        </div>
      </div>
    </div>
  );
}

// Main App
export default function App() {
  const [page, setPage] = useState('dashboard');
  const [selectedApp, setSelectedApp] = useState(null);

  const navigate = (p) => { setPage(p); setSelectedApp(null); };
  const selectApp = (app) => { setSelectedApp(app); setPage('app-config'); };

  return (
    <div className="app">
      <nav className="sidebar">
        <h2>⚙️ Config Service</h2>
        <a className={page === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')}>📊 Dashboard</a>
        <a className={page === 'audit' ? 'active' : ''} onClick={() => navigate('audit')}>📋 Audit Log</a>
        <a className={page === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}>🔧 Settings</a>
      </nav>
      <main className="content">
        {page === 'dashboard' && <Dashboard onSelectApp={selectApp} />}
        {page === 'app-config' && selectedApp && <AppConfig appName={selectedApp} onBack={() => navigate('dashboard')} />}
        {page === 'audit' && <AuditLog />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
