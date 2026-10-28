# Fuel Management | Frac Operations

Gestión integral de combustible del Set de Fractura: pedidos, entregas, stock por PAD, consumos por etapa y reportes.

- **Frontend:** React + TypeScript + Vite + Tailwind CSS.
- **Backend:** Supabase (PostgreSQL, autenticación y seguridad por fila).

Las reglas operativas y los permisos se aplican **en la base de datos** (`supabase/migrations`), no solo en la interfaz.

## Estado — Fase 1 (base funcional)

| Componente | Estado | Cómo se verificó |
|---|---|---|
| Base de datos y relaciones (9 entidades) | Implementado | Migraciones aplicadas sobre PostgreSQL 16 (`npm run test:db`) |
| Reglas operativas (43.000 L por viaje, un consumo por etapa realizada, sin negativos, stock solo con entregas, verificación física aparte) | Implementado en la base | 70 comprobaciones automáticas |
| Stock por PAD y consolidado general (incluye transferencias entre PADs) | Implementado (vistas de cálculo) | Pruebas con datos de prueba en base descartable |
| Roles y seguridad por fila (Administrador, Operaciones, Logística, Supervisión) | Implementado | Cada rol probado contra lo que puede y no puede hacer |
| Auditoría automática (usuario, fecha, tipo y datos antes/después) | Implementado (triggers) | Probado |
| Maestro de PADs y pozos desde `datos/WP_por_Pozos.xlsx` | 92 PADs y 227 pozos (migración idempotente) | Probado, incluida la carga repetida sin duplicar |
| Ingreso, solicitud de acceso, recuperación de contraseña, aprobación de usuarios | Implementado | Compilación, tipos y revisión visual. **Falta probar contra un proyecto Supabase real.** |
| Pantallas: Dashboard, PADs y Pozos, Administración de Usuarios | Implementado y conectado a la base | Revisión visual en escritorio y celular |
| Pedidos, Historial, Etapas, Entregas, Inventario, Reporte | Pantalla informativa “próxima fase” | La base ya tiene las tablas, reglas y permisos |

**Pendiente de configuración externa:**
- Crear el proyecto Supabase.
- Más adelante, para la Fase 4, el registro de la aplicación en Microsoft Entra ID.

## Puesta en marcha

### 1. Proyecto Supabase
1. Crear un proyecto en <https://supabase.com> (región sugerida: São Paulo).
2. Aplicar las migraciones de `supabase/migrations`, en orden, con **una** de estas opciones:
   - **Supabase CLI:**
     ```bash
     npx supabase init
     npx supabase link --project-ref <ref>
     npx supabase db push
     ```
   - **SQL Editor del panel:** pegar y ejecutar cada archivo en orden (`…0001`, `…0002`, `…0003`, `…0004`).
3. En **Authentication → URL Configuration**:
   - **Site URL:** la dirección de la app.
   - **Redirect URLs:** agregar `https://<app>/restablecer`.

### 2. Primer administrador
1. Abrir la app y usar **Solicitar acceso** con su correo. Confirmar el correo con el enlace recibido.
2. En el **SQL Editor** de Supabase ejecutar, una sola vez:
   ```sql
   select public.bootstrap_admin('su.correo@empresa.com');
   ```
   Esta función no se puede llamar desde la aplicación y deja de funcionar cuando ya existe un administrador.
3. A partir de ahí, los demás usuarios piden acceso desde la pantalla de ingreso y el administrador los aprueba en **Administración de Usuarios**, asignándoles el rol.

### 3. Frontend
```bash
npm install
cp .env.example .env.local   # completar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:5173
npm run build                # genera dist/ para publicar
```
- **Claves:** solo se usa la clave pública `anon`. La clave `service_role` nunca va en el frontend.
- **Publicación:** `dist/` se publica en cualquier hosting estático. Se incluyen `public/_redirects` (Netlify) y `vercel.json` (Vercel) para que las rutas funcionen al recargar.

## Pruebas
```bash
npm test          # pruebas unitarias del frontend
npm run typecheck # tipos
npm run test:db   # migraciones + reglas + permisos en un PostgreSQL local descartable (requiere PostgreSQL 15+)
```
Las pruebas de base de datos crean datos de **prueba** (PADs `PRUEBA-…`, usuarios `@prueba.test`) en una base temporal que se elimina al terminar. Nunca se cargan en el proyecto real.

## Modelo de datos

| Tabla | Contenido |
|---|---|
| `profiles` | Usuario y rol. Sin rol o inactivo, no accede a ningún dato. |
| `pads`, `wells` | Maestro. Código estable único; cada pozo pertenece a un PAD. |
| `fracture_stages` | Etapa N.º X de un pozo: planificada, realizada o cancelada. |
| `fuel_orders` | `requested_liters` = viajes × capacidad por viaje (43.000 L, guardada en cada pedido). |
| `fuel_deliveries` | Entregas reales con remito único. Es el único ingreso de stock. |
| `fuel_consumption` | Un registro por etapa realizada. El pozo y el PAD salen de la etapa. |
| `inventory_movements` | Stock inicial, ajustes, salidas, transferencias entre PADs y verificaciones físicas. |
| `audit_logs` | Generado por triggers. |

**Cálculos** (vistas, sin totales guardados):
- `v_well_consumption` y `v_pad_consumption`: consumo y promedio por etapa.
- `v_stock_ledger`: libro de movimientos.
- `v_stock_by_pad`: stock estimado, verificación física y diferencia.
- `v_stock_total`: consolidado general.

**Fórmula del stock estimado:** stock inicial + entregas − consumos − salidas ± ajustes ± transferencias. La verificación física no modifica el estimado: se compara con él.
