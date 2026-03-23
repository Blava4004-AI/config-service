import fs from 'fs';
import { EventEmitter } from 'events';

/**
 * Homelab Config Service Client
 *
 * Usage:
 *   import { ConfigClient } from './config-client.js'
 *   const config = new ConfigClient({
 *     serviceUrl: 'http://localhost:5195',
 *     appName: 'my-app',
 *     localFallback: './config.toml',
 *     retryInterval: 60000,
 *     appMeta: { display_name: 'My App', version: '1.0.0', base_url: '' }
 *   })
 *   await config.load()
 *   config.get('api.port', 3000)
 */

export class ConfigClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.serviceUrl = opts.serviceUrl || 'http://localhost:5195';
    this.appName = opts.appName;
    this.localFallback = opts.localFallback || './config.toml';
    this.retryInterval = opts.retryInterval || 60000;
    this.pollInterval = opts.pollInterval || 30000;
    this.appMeta = opts.appMeta || {};
    this._cache = {};
    this._connected = false;
    this._pollTimer = null;
    this._retryTimer = null;
  }

  async load() {
    try {
      await this._connectAndRegister();
      this._connected = true;
      this._startPolling();
    } catch {
      this._connected = false;
      this._loadLocal();
      this._startRetry();
    }
  }

  get(key, defaultValue) {
    const val = this._cache[key];
    return val !== undefined ? val : defaultValue;
  }

  getAll() {
    return { ...this._cache };
  }

  isConnected() {
    return this._connected;
  }

  stop() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._retryTimer) clearInterval(this._retryTimer);
  }

  async _connectAndRegister() {
    const localConfig = this._readLocal();
    const body = {
      config: localConfig,
      meta: this.appMeta,
    };

    const res = await fetch(`${this.serviceUrl}/api/config/${this.appName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = await res.json();
    this._cache = config;
  }

  async _fetchConfig() {
    const res = await fetch(`${this.serviceUrl}/api/config/${this.appName}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  _startPolling() {
    if (this._retryTimer) { clearInterval(this._retryTimer); this._retryTimer = null; }
    this._pollTimer = setInterval(async () => {
      try {
        const config = await this._fetchConfig();
        for (const [key, value] of Object.entries(config)) {
          if (JSON.stringify(this._cache[key]) !== JSON.stringify(value)) {
            this._cache[key] = value;
            this.emit('change', key, value);
          }
        }
        // Check for removed keys
        for (const key of Object.keys(this._cache)) {
          if (!(key in config)) {
            delete this._cache[key];
            this.emit('change', key, undefined);
          }
        }
      } catch {
        this._connected = false;
        clearInterval(this._pollTimer);
        this._pollTimer = null;
        this._startRetry();
      }
    }, this.pollInterval);
  }

  _startRetry() {
    if (this._retryTimer) return;
    this._retryTimer = setInterval(async () => {
      try {
        await this._connectAndRegister();
        this._connected = true;
        clearInterval(this._retryTimer);
        this._retryTimer = null;
        this._startPolling();
        this.emit('connected');
      } catch {
        // still down, keep retrying
      }
    }, this.retryInterval);
  }

  _readLocal() {
    try {
      if (!fs.existsSync(this.localFallback)) return {};
      // Dynamic import for TOML since this is a standalone client
      // Inline simple TOML flatten for portability
      const raw = fs.readFileSync(this.localFallback, 'utf-8');
      return this._parseTomlFlat(raw);
    } catch {
      return {};
    }
  }

  _loadLocal() {
    this._cache = this._readLocal();
  }

  /**
   * Simple TOML parser that flattens to dot-path keys.
   * Handles basic TOML: [sections], key = value, strings, numbers, booleans.
   * For full TOML support, use @iarna/toml in your project.
   */
  _parseTomlFlat(raw) {
    const result = {};
    let section = '';
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }

      const kvMatch = trimmed.match(/^(\w[\w.-]*)\s*=\s*(.+)$/);
      if (kvMatch) {
        const key = section ? `${section}.${kvMatch[1].trim()}` : kvMatch[1].trim();
        let val = kvMatch[2].trim();

        // Parse value
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
        else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
        else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }

        result[key] = val;
      }
    }
    return result;
  }
}
