const VALID_ROLES = new Set(['user', 'admin']);
const UNAUTHORIZED_BODY = { error: 'Unauthorized' };

export function authenticateToken(tokenService) {
  if (!tokenService || typeof tokenService.verifyToken !== 'function') {
    throw new TypeError('authenticateToken requires a TokenService with verifyToken.');
  }

  return (req, res, next) => {
    const authorization = req.get('Authorization');
    const match = typeof authorization === 'string'
      ? /^Bearer\s+(\S+)$/i.exec(authorization)
      : null;
    if (!match) return res.status(401).json(UNAUTHORIZED_BODY);

    let payload;
    try {
      payload = tokenService.verifyToken(match[1]);
    } catch {
      return res.status(401).json(UNAUTHORIZED_BODY);
    }

    if (!payload
      || typeof payload.sub !== 'string'
      || !payload.sub.trim()
      || !VALID_ROLES.has(payload.role)) {
      return res.status(401).json(UNAUTHORIZED_BODY);
    }

    req.user = { id: payload.sub, role: payload.role };
    return next();
  };
}
