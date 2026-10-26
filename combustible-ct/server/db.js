'use strict';
// Base de datos persistente (SQLite embebido en Node >= 22.13, módulo node:sqlite).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ORDER_STATUS = ['Borrador', 'Solicitado', 'Enviado a transportista', 'Entregado', 'Cancelado'];
const NOTIF_STATUS = ['Pendiente de envío', 'Enviado correctamente', 'Error de envío'];

const DEFAULT_SETTINGS = {
  mail_to: 'mperez5@pan-energy.com',
  mail_cc: '',
  unidad_operativa: 'Coiled Tubing',
};

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK (role IN ('operador','administrador')),
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      wells TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE,
      unit TEXT NOT NULL,
      pad_id INTEGER REFERENCES pads(id),
      pad_code TEXT NOT NULL,
      pad_wells TEXT NOT NULL DEFAULT '',
      pad_area TEXT NOT NULL DEFAULT '',
      liters INTEGER NOT NULL CHECK (liters > 0),
      request_date TEXT NOT NULL,
      required_date TEXT NOT NULL,
      observations TEXT NOT NULL DEFAULT '',
      requester_id INTEGER NOT NULL REFERENCES users(id),
      requester_name TEXT NOT NULL,
      status TEXT NOT NULL,
      notification_status TEXT NOT NULL,
      cancel_reason TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_orders_request_date ON orders(request_date);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS order_counters (
      year INTEGER PRIMARY KEY,
      last INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      recipients TEXT NOT NULL,
      subject TEXT NOT NULL,
      success INTEGER NOT NULL,
      message_id TEXT,
      error TEXT,
      triggered_by INTEGER REFERENCES users(id),
      triggered_by_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notif_order ON notifications(order_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // v2: pozo de destino del pedido (copia histórica, igual que el PAD).
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  if (!cols.includes('well')) db.exec("ALTER TABLE orders ADD COLUMN well TEXT NOT NULL DEFAULT ''");
  // v3: alta de usuarios con aprobación del administrador y restablecimiento de contraseña.
  const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!ucols.includes('approval_status')) {
    db.exec(`ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'aprobado';
      ALTER TABLE users ADD COLUMN approved_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN approved_at TEXT;
      ALTER TABLE users ADD COLUMN reject_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN reset_requested_at TEXT;`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );`);
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function audit(db, user, action, entity, entityId, details = {}) {
  db.prepare('INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?)')
    .run(user ? user.id : null, user ? user.full_name : 'sistema', action, entity, entityId ?? null, JSON.stringify(details));
}

function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

// Número único: CT-AAAA-NNNNN, correlativo por año, asignado dentro de la transacción.
function nextOrderNumber(db, year) {
  db.prepare('INSERT INTO order_counters (year, last) VALUES (?, 0) ON CONFLICT(year) DO NOTHING').run(year);
  db.prepare('UPDATE order_counters SET last = last + 1 WHERE year = ?').run(year);
  const { last } = db.prepare('SELECT last FROM order_counters WHERE year = ?').get(year);
  return `CT-${year}-${String(last).padStart(5, '0')}`;
}

// Lista de pozos de un PAD (se guardan separados por coma en pads.wells).
function splitWells(s) {
  const seen = new Set();
  return String(s || '').split(/[,;\n]/).map((w) => w.trim()).filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));
}

const WHOLE_PAD = 'PAD completo (varios pozos)';

module.exports = { splitWells, WHOLE_PAD, open, tx, audit, getSettings, nextOrderNumber, ORDER_STATUS, NOTIF_STATUS };
