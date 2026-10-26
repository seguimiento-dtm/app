'use strict';
const crypto = require('node:crypto');

const SESSION_HOURS = 12;
const COOKIE = 'ct_session';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?,?,?,?)').run(sha256(token), userId, csrf, expires);
  return { token, csrf, expires };
}

function cookieHeader(token, secure, maxAgeSec) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// Middleware: carga req.user si la cookie de sesión es válida.
function sessionMiddleware(db) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const row = db.prepare(`
        SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.username, u.full_name, u.email, u.role, u.active
        FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
      if (row && row.active && row.expires_at > new Date().toISOString()) {
        req.user = { id: row.id, username: row.username, full_name: row.full_name, email: row.email, role: row.role };
        req.session = { tokenHash: row.token_hash, csrf: row.csrf };
      }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sesión no iniciada o vencida.' });
  // Protección CSRF para métodos que modifican datos.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-csrf-token') !== req.session.csrf) {
    return res.status(403).json({ error: 'Token de seguridad inválido. Recargue la página.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'administrador') return res.status(403).json({ error: 'Acción reservada a administradores.' });
  next();
}

module.exports = {
  COOKIE, SESSION_HOURS, hashPassword, verifyPassword, validatePassword, createSession, cookieHeader,
  sessionMiddleware, requireAuth, requireAdmin, sha256,
};
