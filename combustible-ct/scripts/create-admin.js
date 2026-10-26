'use strict';
// Crea (o restablece) un usuario administrador. Uso interactivo:
//   npm run crear-admin
// o no interactivo: ADMIN_USER=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run crear-admin
const path = require('node:path');
const readline = require('node:readline/promises');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* opcional */ }
const dbm = require('../server/db');
const auth = require('../server/auth');

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, env) => process.env[env] || (await rl.question(q)).trim();
  const username = await ask('Usuario administrador: ', 'ADMIN_USER');
  const fullName = await ask('Nombre completo: ', 'ADMIN_NAME');
  const email = process.env.ADMIN_EMAIL ?? (await rl.question('Correo (opcional): ')).trim();
  const password = await ask('Contraseña (mín. 10 caracteres): ', 'ADMIN_PASSWORD');
  rl.close();
  const err = auth.validatePassword(password);
  if (!username || !fullName || err) { console.error(err || 'Usuario y nombre son obligatorios.'); process.exit(1); }
  const db = dbm.open(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'combustible-ct.db'));
  const prev = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (prev) {
    db.prepare("UPDATE users SET full_name=?, email=?, role='administrador', active=1, password_hash=? WHERE id=?")
      .run(fullName, email, auth.hashPassword(password), prev.id);
    dbm.audit(db, null, 'restablecer_admin', 'usuario', prev.id, { username });
    console.log(`Administrador "${username}" actualizado.`);
  } else {
    const r = db.prepare("INSERT INTO users (username, full_name, email, role, password_hash) VALUES (?,?,?,'administrador',?)")
      .run(username, fullName, email, auth.hashPassword(password));
    dbm.audit(db, null, 'alta_usuario', 'usuario', Number(r.lastInsertRowid), { username, role: 'administrador' });
    console.log(`Administrador "${username}" creado.`);
  }
})();
