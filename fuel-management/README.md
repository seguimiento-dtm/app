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
| Pedidos, Historial, Etapas, Entregas, Inventario, Reporte | Implementado en la Fase 2 (ver abajo) | — |

## Estado — Fase 2 (operación)

| Sección | Qué hace | Reglas que aplica la base |
|---|---|---|
| Pedidos de Combustible | Alta por viajes con volumen calculado y confirmación; borrador; pedidos abiertos con avance | Viajes × 43.000 L; PAD activo; numeración automática |
| Historial de Pedidos | Búsqueda, filtros, orden, detalle con entregas, exportación CSV | Sin borrado; transiciones borrador → solicitado → enviado; cancelación con motivo y solo sin entregas |
| Correo del pedido | Borrador con destinatario configurable, “Copiar texto” y “Abrir en Outlook” en la cuenta del usuario | El envío automático por Microsoft 365 queda para la Fase 4 |
| Registro de Etapas | Etapas por pozo, planificación 1..N, registro de etapa realizada con consumo en una operación, corrección de litros, cancelación | Un consumo por etapa; no en canceladas; fecha no futura; pozo activo |
| Entregas de Combustible | Registro contra pedido abierto, litros sugeridos, remito, corrección | Remito único; solo pedidos vigentes; el pedido pasa a entregado parcial/total |
| Inventario y Stock | Stock por PAD y consolidado, verificación física y diferencia, movimientos con saldo, exportación | Stock inicial único por PAD; ajustes/salidas/transferencias con motivo; sin edición ni borrado |
| Reporte Gerencial | Período y PAD: consumo, promedio, entregado, solicitado y cumplimiento; evolución semanal; detalle por PAD; CSV | Calculado desde los registros |
| Administración | Destinatario de los pedidos (parámetro auditado) | Solo administrador |

Verificación de la Fase 2:
- 27 comprobaciones nuevas de base de datos (transiciones, etapas, permisos, vistas).
- Compilación y tipos sin errores.
- Revisión visual de las seis pantallas en escritorio y celular.

## Estado — Fase 3 (importador del maestro)

En **PADs y Pozos → Importar Excel** (solo Administrador). Pasos: archivo (.xlsx o .csv, arrastrar o seleccionar) → hoja → mapeo de columnas (detección automática por nombre, editable) → vista previa → validación sin guardar → confirmación → resultado con reporte descargable.

| Regla | Cómo se aplica |
|---|---|
| Identificación por código estable | PADs y pozos se buscan por código (sin distinguir mayúsculas); el nombre visible no es clave. |
| Sin duplicados | Filas repetidas en el archivo se informan como “Duplicado”; reimportar el mismo archivo no crea ni cambia nada. |
| Un pozo, un PAD | Un pozo que figura en dos PADs del archivo, o que ya existe en otro PAD, se rechaza con su número de fila. |
| Actualización de datos maestros | Nombre, etapas planificadas y estado operativo se actualizan si vienen informados; los vacíos conservan el valor actual. Un PAD inactivo informado se reactiva. |
| Historia intacta | No se borran PADs ni pozos; no se tocan pedidos, entregas, consumos, etapas ni inventario. |
| Estructura insegura | Se detiene antes de enviar: falta la columna del PAD, columnas repetidas, sin datos, más de 5.000 filas o columna del PAD mayormente vacía. |
| Transacción | Las filas válidas se importan en una sola operación; las filas con error se omiten. |
| Seguridad | Solo Administrador. Las filas viajan como datos a `import_master`; no se arma SQL con el contenido del archivo. |
| Registro | `import_logs`: usuario, fecha, archivo, hoja, filas, altas, actualizaciones, duplicados y errores (con número de fila). Visible para Administrador y Supervisión. |

Verificación de la Fase 3:
- 27 comprobaciones de base de datos, incluida la validación del Excel real: 1.273 filas, 227 pozos sin cambios, 1.005 duplicados y 41 filas sin PAD.
- 4 pruebas unitarias de lectura y mapeo, también con el Excel real.
- Revisión visual del asistente completo con respuestas reales de la base.

## Estado — Fase 4 (envío desde el Outlook del usuario)

Implementado y **deshabilitado por defecto**, hasta que TI complete la configuración de Microsoft Entra ID. La guía para TI está en **[INTEGRACION_MICROSOFT.md](INTEGRACION_MICROSOFT.md)**.

- **Ingreso con Microsoft:** pide solo los permisos delegados `openid email profile offline_access User.Read Mail.Send`. Al ingresar, la función `microsoft-link` vincula la cuenta: verifica que coincida con el usuario y guarda el token de renovación cifrado en un esquema privado.
- **Envío:** la función `send-order-email` valida sesión, rol, pedido, habilitación e identidad. Envía con Microsoft Graph desde la cuenta del usuario al destinatario configurado y registra el resultado en `email_dispatches`. El pedido queda “Aceptado por Microsoft 365”, nunca “Entregado”.
- **Duplicados:** un pedido no puede tener dos envíos en curso o aceptados. Un error permite reintentar, y un intento sin respuesta se cierra a los 10 minutos.
- **Interfaz:** “Enviar desde mi Outlook” con vista previa en el correo del pedido, historial de envíos en el detalle e interruptor de habilitación en Administración. Sin habilitación quedan el borrador, “Copiar texto” y “Abrir en Outlook”.

Verificación de la Fase 4:
- 25 comprobaciones de base de datos.
- 8 pruebas de las funciones de servidor con Microsoft simulado: envío aceptado, cuenta ajena, autorización vencida, rechazo de Graph, pedido ya enviado y falta de configuración.
- Revisión de tipos de las funciones (`npm run typecheck:functions`).
- **No se probó contra Microsoft 365 real:** requiere la configuración de TI y una cuenta autorizada (ver el plan de prueba en la guía).

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
     Las funciones de servidor del envío por Outlook se publican aparte (ver INTEGRACION_MICROSOFT.md).
   - **SQL Editor del panel:** pegar y ejecutar cada archivo en orden (`…0001` a `…0007`).
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
