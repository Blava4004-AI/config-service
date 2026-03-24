# homelab-config (Python)

Python client for the [Homelab Config Service](../README.md).

## Install

```bash
# From the repo (editable, recommended for homelab use)
pip install -e /path/to/config-service/python

# Or build and install a wheel
cd /path/to/config-service/python
pip install .
```

## Quick Start

```python
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
db_host = config.get("database.host", "localhost")
```

## Local Fallback (`config.toml`)

If the config service is unreachable on startup, the client falls back to a
local `config.toml`. Keys are flattened to dot-path format matching TOML sections:

```toml
[api]
port = 8000
debug = false

[database]
host = "localhost"
port = 5432
name = "mydb"
```

These become `api.port`, `api.debug`, `database.host`, etc.

## Options

| Parameter       | Type     | Default                    | Description                                              |
|-----------------|----------|----------------------------|----------------------------------------------------------|
| `app_name`      | str      | *(required)*               | Namespace for this app's config in the service           |
| `service_url`   | str      | `http://localhost:5195`    | Base URL of the config service                           |
| `local_fallback`| str      | `./config.toml`            | Path to local TOML fallback file                         |
| `poll_interval` | int      | `30`                       | Seconds between background polls                         |
| `retry_interval`| int      | `60`                       | Seconds between reconnect attempts when disconnected     |
| `app_meta`      | dict     | `{}`                       | Metadata sent on registration (`display_name`, `version`, `base_url`) |
| `on_change`     | callable | `None`                     | Callback `fn(key, new_value)` fired when a value changes |
| `token`         | str      | `None`                     | Bearer token if auth is enabled on the service           |
| `timeout`       | float    | `5.0`                      | HTTP request timeout in seconds                          |

## Change Callbacks

```python
def on_config_change(key, value):
    print(f"Config changed: {key} = {value}")

config = ConfigClient(
    app_name="my-service",
    on_change=on_config_change,
)
config.load()
```

## Requirements

- Python 3.9+
- `httpx`
- `tomli` (only needed on Python < 3.11; `tomllib` is built-in on 3.11+)
