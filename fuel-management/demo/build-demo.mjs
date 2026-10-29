// Genera una página única de DEMO (sin servidor) con la aplicación real compilada y un servidor simulado.
// Uso: node demo/build-demo.mjs [salida.html]
import { build as viteBuild } from 'vite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'demo', 'fuel-management-demo.html');
const build = join(root, 'demo', '.build');

Object.assign(process.env, { VITE_SUPABASE_URL: 'https://demo.supabase.local', VITE_SUPABASE_ANON_KEY: 'demo', VITE_DEMO: 'true', VITE_AUTH_MICROSOFT: 'false' });
await viteBuild({
  root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn',
  build: { outDir: build, emptyOutDir: true, chunkSizeWarningLimit: 2000, rollupOptions: { output: { inlineDynamicImports: true } } },
});

// Maestro real de PADs y pozos, tomado de la migración de carga inicial (fuente: datos/WP_por_Pozos.xlsx).
const seedSql = readFileSync(join(root, 'supabase', 'migrations', readdirSync(join(root, 'supabase', 'migrations')).find((f) => f.includes('carga_inicial'))), 'utf8');
const [padsPart, wellsPart] = seedSql.split('insert into public.wells');
const pairs = (s) => [...s.matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)'\)/g)].map((m) => [m[1].replace(/''/g, "'"), m[2].replace(/''/g, "'")]);
const catalog = { pads: pairs(padsPart).map(([code]) => code), wells: pairs(wellsPart) };

const assets = join(build, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8'));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
if (js.length !== 1) throw new Error(`Se esperaba un único archivo JS y hay ${js.length}.`);
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const mock = readFileSync(join(root, 'demo', 'mock-backend.js'), 'utf8');

const html = `<title>Fuel Management Demo</title>
<meta name="theme-color" content="#0C1D33">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
${css}
:root{color-scheme:light}
body{background:#F8FAFC}
#demo-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;background:#FEF3C7;color:#78350F;border-bottom:1px solid #FCD34D;
  padding:8px max(16px,env(safe-area-inset-right,0px)) 8px max(16px,env(safe-area-inset-left,0px));font:13px/1.45 "IBM Plex Sans",system-ui,sans-serif;position:relative;z-index:20}
#demo-bar b{letter-spacing:.06em}
#demo-bar code{background:rgba(255,255,255,.7);border-radius:4px;padding:0 4px;font-family:"IBM Plex Mono",monospace;font-size:12px}
#demo-bar button{margin-left:auto;border:1px solid #D97706;background:#fff;color:#78350F;border-radius:6px;padding:4px 10px;font:600 12.5px "IBM Plex Sans",sans-serif;cursor:pointer}
#demo-bar button:hover{background:#FFFBEB}
#demo-notice{position:fixed;left:max(16px,env(safe-area-inset-left,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:90;max-width:min(440px,calc(100vw - 32px));
  background:#78350F;color:#fff;border-radius:10px;padding:10px 14px;font:14px "IBM Plex Sans",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)}
</style>
<div id="demo-bar" role="note">
  <b>DEMO</b>
  <span>Datos de ejemplo · no envía correos · usuarios <code>admin@demo.test</code> <code>logistica@demo.test</code> <code>operaciones@demo.test</code> <code>supervision@demo.test</code> · contraseña <code>prueba</code></span>
  <button type="button" onclick="window.__fuelDemoReset()">Restablecer datos del demo</button>
</div>
<div id="demo-notice" role="status" hidden></div>
<div id="root"></div>
<script>window.__DEMO_CATALOG__ = ${JSON.stringify(catalog)};</script>
<script>
${safe(mock)}
</script>
<script type="module">
${safe(js[0])}
</script>
`;
writeFileSync(out, html);
console.log(`Demo generada: ${out} (${catalog.pads.length} PADs, ${catalog.wells.length} pozos, ${(html.length / 1024).toFixed(0)} KB)`);
