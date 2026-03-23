# Config Service

Centralized configuration management for homelab apps. Apps self-register their defaults, human edits are preserved, and everything falls back gracefully to local `config.toml` if the service is unreachable.

## Quick Start

```bash
cp config.example.toml config.toml
npm install
cd admin-ui && npm install && npm run build && cd ..
npm start
```

- **API:** http://localhost:5195
- **Admin UI:** http://localhost:5196

## API

```
GET  /health                    → service health
GET  /api/apps                  → list registered apps
DELETE /api/apps/:app           → remove an app
GET  /api/config/:app           → get config (flat key:value)
PUT  /api/config/:app           → self-register app + defaults
PATCH /api/config/:app/:key     → update a key
DELETE /api/config/:app/:key    → delete a key
GET  /api/audit?app=&limit=50   → audit log
```

## Client Library

Copy `client/config-client.js` into your app:

```js
import { ConfigClient } from './config-client.js'

const config = new ConfigClient({
  serviceUrl: 'http://localhost:5195',
  appName: 'my-app',
  localFallback: './config.toml',
  appMeta: { display_name: 'My App', version: '1.0.0' }
})

await config.load()
config.get('api.port', 3000)
```

## License

MIT
