'use strict';
// Genera una página única de PRUEBA (sin servidor) para revisar diseño y flujo:
//   node demo/build-demo.js <salida.html>
// Incluye el frontend real, una API simulada en el navegador y los Well PAD de datos/WP_por_Pozos.xlsx.
const fs = require('node:fs');
const path = require('node:path');
const padImport = require('../server/pad-import');

(async () => {
  const root = path.join(__dirname, '..');
  const out = process.argv[2] || path.join(root, 'demo', 'combustible-ct-demo.html');
  const parsed = await padImport.parse(fs.readFileSync(path.join(root, 'datos', 'WP_por_Pozos.xlsx')), 'WP_por_Pozos.xlsx');
  const pads = [...parsed.pads].map(([code, wells]) => ({ code, wells }));
  const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const mock = fs.readFileSync(path.join(__dirname, 'mock-api.js'), 'utf8');
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  const html = `<title>Pedidos de Combustible CT</title>
<meta name="theme-color" content="#0B2545">
<style>
${css}
:root{color-scheme:light}
#demoBar{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;background:#F2A900;color:#1F1600;padding:7px max(16px,env(safe-area-inset-left,0px)) 7px max(16px,env(safe-area-inset-right,0px));font-size:13px;position:relative;z-index:70}
#demoBar b{letter-spacing:.06em}
#demoBar code{background:rgba(255,255,255,.55);padding:0 4px;border-radius:3px}
#demoBar label{margin-left:auto;display:flex;gap:6px;align-items:center}
#demoBar select,#demoBar button{font-size:13px;border:1px solid rgba(0,0,0,.25);border-radius:5px;background:#fff;padding:3px 8px;cursor:pointer}
@media (max-width:900px){#demoBar label{margin-left:0}}
</style>
<div id="demoBar"></div>
<div id="root"><div class="empty">Cargando…</div></div>
<div class="toasts" id="toasts" aria-live="polite"></div>
<script>window.__DEMO_PADS__ = ${JSON.stringify(pads)};</script>
<script>
${safe(mock)}
</script>
<script>
${safe(app)}
</script>
`;
  fs.writeFileSync(out, html);
  console.log(`Demo generada: ${out} (${pads.length} Well PAD)`);
})();
