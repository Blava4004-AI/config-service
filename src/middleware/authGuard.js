const PERMISSION_LEVELS = { none: 0, read: 1, write: 2, admin: 3 }

function decodeJWT(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
}

function isTokenExpired(payload) {
  if (!payload || !payload.exp) return true
  return Date.now() >= payload.exp * 1000
}

export function createAuthGuard(options = {}) {
  const { appName, getConfig } = options

  return {
    requirePermission(minLevel) {
      return (req, res, next) => {
        const authEnabled = getConfig('auth.enabled', false)
        if (!authEnabled) return next()

        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Authentication required' })
        }

        const token = authHeader.split(' ')[1]
        const payload = decodeJWT(token)

        if (!payload || isTokenExpired(payload)) {
          return res.status(401).json({ error: 'Invalid or expired token' })
        }

        const userPerm = payload.permissions?.[appName] || payload.permissions?.['__default__'] || 'none'

        if (PERMISSION_LEVELS[userPerm] < PERMISSION_LEVELS[minLevel]) {
          return res.status(403).json({
            error: `Insufficient permissions. Requires '${minLevel}' access for '${appName}', you have '${userPerm}'`
          })
        }

        req.user = payload
        next()
      }
    },

    readOnly() { return this.requirePermission('read') },
    readWrite() { return this.requirePermission('write') },
    adminOnly() { return this.requirePermission('admin') },
  }
}
