"""
ConfigClient — Python client for the Homelab Config Service.

Mirrors the JS ConfigClient:
  - Registers the app and seeds default keys on startup (PUT /api/config/:app)
  - Polls for changes in the background (GET /api/config/:app)
  - Falls back to a local config.toml if the service is unreachable
  - Retries connection in the background until the service comes back

Usage:
    from homelab_config import ConfigClient

    config = ConfigClient(
        app_name="my-python-service",
        service_url="http://localhost:5195",
        local_fallback="./config.toml",
        app_meta={"display_name": "My Python Service", "version": "1.0.0"},
    )
    config.load()

    port = config.get("api.port", 8000)
    debug = config.get("api.debug", False)
"""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

import httpx

# tomllib is built-in on Python 3.11+; fall back to tomli for older versions
if sys.version_info >= (3, 11):
    import tomllib
else:
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ImportError:  # pragma: no cover
        tomllib = None  # type: ignore[assignment]


class ConfigClient:
    """
    Thread-safe config client for the Homelab Config Service.

    All `.get()` calls are safe to call from any thread at any time.
    Background polling and retries run as daemon threads and will not
    prevent the process from exiting.

    Args:
        app_name:        Identifier used to namespace this app's config.
        service_url:     Base URL of the config service (default: http://localhost:5195).
        local_fallback:  Path to a local config.toml used when the service is unreachable.
        poll_interval:   Seconds between background polls (default: 30).
        retry_interval:  Seconds between reconnect attempts when disconnected (default: 60).
        app_meta:        Optional metadata dict forwarded on registration
                         (e.g. {"display_name": "My App", "version": "1.0.0", "base_url": ""}).
        on_change:       Optional callback(key, new_value) called when a value changes
                         during polling.
        token:           Optional bearer token for services that have auth enabled.
        timeout:         HTTP request timeout in seconds (default: 5).
    """

    def __init__(
        self,
        app_name: str,
        service_url: str = "http://localhost:5195",
        local_fallback: str = "./config.toml",
        poll_interval: int = 30,
        retry_interval: int = 60,
        app_meta: dict | None = None,
        on_change: Callable[[str, Any], None] | None = None,
        token: str | None = None,
        timeout: float = 5.0,
    ) -> None:
        self.app_name = app_name
        self.service_url = service_url.rstrip("/")
        self.local_fallback = Path(local_fallback)
        self.poll_interval = poll_interval
        self.retry_interval = retry_interval
        self.app_meta = app_meta or {}
        self.on_change = on_change
        self.timeout = timeout

        self._headers: dict[str, str] = {"Content-Type": "application/json"}
        if token:
            self._headers["Authorization"] = f"Bearer {token}"

        self._cache: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._connected = False
        self._stop_event = threading.Event()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self) -> None:
        """
        Connect to the config service, register the app, and start
        background polling.  Falls back to local config.toml on failure
        and retries in the background.

        This method is intentionally synchronous so you can call it at
        startup before your app begins serving traffic.
        """
        try:
            self._connect_and_register()
            self._connected = True
            self._start_thread(self._poll_loop)
        except Exception as exc:
            print(f"[homelab-config] Service unreachable ({exc}), using local fallback")
            with self._lock:
                self._cache = self._read_local()
            self._start_thread(self._retry_loop)

    def get(self, key: str, default: Any = None) -> Any:
        """Return the value for *key*, or *default* if not set."""
        with self._lock:
            return self._cache.get(key, default)

    def get_all(self) -> dict[str, Any]:
        """Return a shallow copy of the full config dict."""
        with self._lock:
            return dict(self._cache)

    def is_connected(self) -> bool:
        """True if the client is currently connected to the config service."""
        return self._connected

    def stop(self) -> None:
        """Stop background polling and retry threads."""
        self._stop_event.set()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _start_thread(self, target: Callable) -> None:
        t = threading.Thread(target=target, daemon=True)
        t.start()

    def _connect_and_register(self) -> None:
        """PUT /api/config/:app — registers the app and seeds defaults."""
        local_config = self._read_local()
        body = {"config": local_config, "meta": self.app_meta}
        resp = httpx.put(
            f"{self.service_url}/api/config/{self.app_name}",
            json=body,
            headers=self._headers,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        with self._lock:
            self._cache = resp.json()

    def _fetch_config(self) -> dict[str, Any]:
        """GET /api/config/:app — fetch current config."""
        resp = httpx.get(
            f"{self.service_url}/api/config/{self.app_name}",
            headers=self._headers,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def _poll_loop(self) -> None:
        while not self._stop_event.wait(self.poll_interval):
            try:
                new_config = self._fetch_config()
                with self._lock:
                    old_config = self._cache
                    # Emit change events
                    if self.on_change:
                        for key, value in new_config.items():
                            if old_config.get(key) != value:
                                self._safe_call_on_change(key, value)
                        for key in old_config:
                            if key not in new_config:
                                self._safe_call_on_change(key, None)
                    self._cache = new_config
            except Exception:
                self._connected = False
                self._start_thread(self._retry_loop)
                return

    def _retry_loop(self) -> None:
        while not self._stop_event.wait(self.retry_interval):
            try:
                self._connect_and_register()
                self._connected = True
                self._start_thread(self._poll_loop)
                return
            except Exception:
                pass  # still down, keep retrying

    def _safe_call_on_change(self, key: str, value: Any) -> None:
        try:
            self.on_change(key, value)  # type: ignore[misc]
        except Exception as exc:
            print(f"[homelab-config] on_change callback raised: {exc}")

    def _read_local(self) -> dict[str, Any]:
        """Read the local config.toml fallback and flatten to dot-path keys."""
        if not self.local_fallback.exists():
            return {}
        if tomllib is None:
            print(
                "[homelab-config] Warning: tomllib/tomli not available — "
                "install 'tomli' for Python < 3.11 to use local fallback"
            )
            return {}
        try:
            with open(self.local_fallback, "rb") as f:
                raw = tomllib.load(f)
            return _flatten(raw)
        except Exception as exc:
            print(f"[homelab-config] Failed to read local fallback: {exc}")
            return {}


def _flatten(d: dict, prefix: str = "") -> dict[str, Any]:
    """Recursively flatten a nested dict to dot-path keys."""
    result: dict[str, Any] = {}
    for k, v in d.items():
        full_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            result.update(_flatten(v, full_key))
        else:
            result[full_key] = v
    return result
