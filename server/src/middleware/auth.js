import jwt from 'jsonwebtoken';

export function createAuth(env) {
  return function auth(req, res, next) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    }
    const token = h.slice(7);
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      req.user = payload; // { id, wallet }
      next();
    } catch {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    }
  };
}

export function optionalAuth(env) {
  return function (req, _res, next) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return next();
    try {
      const payload = jwt.verify(h.slice(7), env.JWT_SECRET);
      req.user = payload;
    } catch {
      // Invalid token, continue without auth
    }
    next();
  };
}
