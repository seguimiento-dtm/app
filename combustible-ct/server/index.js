'use strict';
const path = require('node:path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* sin .env: se usan las variables del entorno */ }

const dbm = require('./db');
const { createApp } = require('./app');
const { createMailer } = require('./mailer');

const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'combustible-ct.db');
const db = dbm.open(dbFile);
const mailer = createMailer(process.env);
const app = createApp({ db, mailer, secureCookies: String(process.env.COOKIE_SECURE).toLowerCase() === 'true', appUrl: process.env.APP_URL });

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const st = mailer.status();
  console.log(`Pedidos de Combustible CT escuchando en http://${host}:${port}`);
  console.log(`Base de datos: ${dbFile}`);
  if (!process.env.APP_URL) console.log('ATENCIÓN: falta APP_URL; “Olvidé la contraseña” no podrá enviar enlaces y solo avisará a los administradores.');
  if (!users) console.log('ATENCIÓN: no hay usuarios. Cree el administrador inicial con: npm run crear-admin');
  console.log(st.configured
    ? `Correo: proveedor ${st.provider} configurado.`
    : `ATENCIÓN: correo NO configurado (proveedor ${st.provider}). Faltan: ${st.missing.join(', ')}. Ver README.`);
});
