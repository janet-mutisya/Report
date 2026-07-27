const jwt = require('jsonwebtoken');

// ─── Verify JWT token ────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// ─── Only allow admin role ───────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// ─── Only allow client role ──────────────────────────────────────────────────
const requireClient = (req, res, next) => {
  if (!req.user || req.user.role !== 'client') {
    return res.status(403).json({ message: 'Client access required' });
  }
  next();
};

// ─── Allow both admin and client ─────────────────────────────────────────────
const requireAny = (req, res, next) => {
  if (!req.user || !['admin', 'client'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Authentication required' });
  }
  next();
};

module.exports = { auth, requireAdmin, requireClient, requireAny };