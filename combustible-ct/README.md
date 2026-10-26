# Gestión de Pedidos de Combustible – Unidad Coiled Tubing

Aplicación web responsive para registrar, notificar por correo y consultar los pedidos de combustible de la unidad Coiled Tubing.

- **Backend:** Node.js (>= 22.13) + Express. Base de datos **SQLite** persistente (módulo `node:sqlite`, sin dependencias nativas).
- **Correo real:** SMTP corporativo (Nodemailer) **o** Microsoft Graph API (Microsoft 365). No hay envío simulado.
- **Frontend:** SPA en HTML/CSS/JS sin frameworks, servida por el mismo servidor. Español, fechas DD/MM/AAAA, litros con separador de miles.

## Puesta en marcha

```bash
cd combustible-ct
npm install
cp .env.example .env        # completar la configuración de correo (ver abajo)
npm run crear-admin         # crea el primer usuario administrador (pide usuario, nombre y contraseña)
npm start                   # http://localhost:3000
```

Al iniciar, la consola informa si el correo quedó configurado y, si no, qué variables faltan.

Pasos iniciales dentro de la aplicación (como administrador):

1. **Administración de PAD** → cargar los PAD reales (código, área/yacimiento, pozos asociados). La aplicación **no trae PAD precargados**.
2. **Usuarios** → crear los usuarios con perfil *Operador* o *Administrador*.
3. **Configuración** → verificar el destinatario (por defecto `mperez5@pan-energy.com`), opcionalmente agregar CC, y usar **Enviar correo de prueba**.

## Configuración del correo (requisito pendiente de completar)

Las credenciales se cargan **solo en el servidor**, en el archivo `.env` (excluido del repositorio por `.gitignore`) o como variables de entorno del servicio. Nunca llegan al navegador.

Se necesita que TI habilite **una** de estas dos opciones:

### Opción A – SMTP corporativo (`MAIL_PROVIDER=smtp`)

| Variable | Ejemplo / descripción |
|---|---|
| `SMTP_HOST` | `smtp.office365.com` (o el relay SMTP interno) |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` para STARTTLS en 587; `true` para TLS directo en 465 |
| `SMTP_USER` / `SMTP_PASS` | Cuenta de servicio autorizada a enviar (dejar vacíos si el relay no requiere autenticación) |
| `MAIL_FROM` | `Pedidos Combustible CT <pedidos.combustible@pan-energy.com>` |

En Microsoft 365, la cuenta de servicio debe tener habilitado *SMTP AUTH* (Authenticated SMTP), y `MAIL_FROM` debe ser ese buzón o uno sobre el que tenga permiso *Send As*.

### Opción B – Microsoft Graph (`MAIL_PROVIDER=graph`) – recomendada si SMTP AUTH está deshabilitado

1. En Entra ID (Azure AD) registrar una aplicación y crear un *client secret*.
2. Otorgar el permiso de **aplicación** `Mail.Send` (Microsoft Graph) con consentimiento de administrador.
3. Recomendado: limitar la app a un único buzón con una *Application Access Policy* de Exchange.
4. Completar `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` y `GRAPH_SENDER` (buzón remitente).

Si el correo no está configurado o falla, el pedido **igual se registra**, queda con notificación *Error de envío* (“Pendiente de notificación”) y se puede **reintentar** desde el resultado del pedido o desde el detalle en el Historial, sin crear otro pedido. Cada intento queda registrado (destinatarios, asunto, resultado y error).

## Funcionalidades

- **Inicio:** indicadores (pedidos generados, litros solicitados, pendientes de entrega, notificados correctamente, errores de notificación), litros por PAD, evolución de la demanda mensual/semanal, últimos pedidos y accesos directos.
- **Nuevo Pedido:** unidad operativa, PAD (solo activos), litros, fecha de solicitud automática (editable solo por administradores), fecha requerida, observaciones y solicitante. Botones *Enviar solicitud*, *Guardar borrador* y *Limpiar formulario*. Pantalla de confirmación con PAD, litros y fecha requerida antes de enviar. Clave de idempotencia por formulario para evitar pedidos duplicados por doble clic o reintentos de red.
- **Correo:** destinatario `mperez5@pan-energy.com` (configurable), asunto `[PEDIDO DE COMBUSTIBLE CT] – <PAD> – <DD/MM/AAAA>`, cuerpo HTML + texto con número de pedido, unidad, PAD, litros, fecha/hora de solicitud, fecha requerida, solicitante, observaciones y estado.
- **Historial de Pedidos:** búsqueda por número o PAD, filtros por rango de fechas, estado, notificación y solicitante, orden por número, fecha, fecha requerida, PAD y litros, detalle completo con intentos de notificación y registro de eventos, reenvío de correo, exportación CSV compatible con Excel (UTF-8 con BOM, separador `;`).
- **Estados del pedido:** Borrador → Solicitado → Enviado a transportista → Entregado; Cancelado (con motivo obligatorio). El estado de notificación (Pendiente de envío / Enviado correctamente / Error de envío) se gestiona por separado. Un correo exitoso pasa el pedido de *Solicitado* a *Enviado a transportista*; **nunca** a *Entregado*, que se marca manualmente.
- **Administración de PAD:** alta, modificación, activación y desactivación. Los pedidos guardan una copia del nombre, área y pozos del PAD al momento de la solicitud.
- **Usuarios, Configuración y Auditoría** (solo administradores).

### Permisos

| Acción | Operador | Administrador |
|---|---|---|
| Crear pedidos y consultar historial / exportar | ✔ | ✔ |
| Modificar o cancelar pedido propio en Borrador o Solicitado | ✔ | ✔ (cualquiera) |
| Modificar o cancelar pedido ya *Enviado a transportista* | ✘ | ✔ |
| Marcar *Entregado* | pedido propio | ✔ |
| Reintentar / reenviar correo | ✔ | ✔ |
| Modificar fecha de solicitud | ✘ | ✔ |
| PAD, usuarios, configuración, auditoría | ✘ | ✔ |

Pedidos *Entregado* y *Cancelado* no se pueden modificar. Si se modifica un pedido ya notificado, su notificación vuelve a *Pendiente de envío* para reenviar los datos actualizados.

## Seguridad

- Contraseñas con hash `scrypt`; sesiones en base de datos con cookie `HttpOnly`/`SameSite=Strict` (agregar `COOKIE_SECURE=true` detrás de HTTPS); token CSRF en todas las operaciones de escritura; bloqueo temporal tras 5 intentos de inicio de sesión fallidos.
- Encabezados de seguridad (CSP sin scripts inline, `X-Frame-Options`, etc.).
- La exportación CSV neutraliza fórmulas para evitar inyección en Excel.
- Publicar detrás de un proxy HTTPS de la red corporativa (IIS, Nginx, etc.).

## Datos y respaldo

Todo se guarda en `DB_FILE` (por defecto `data/combustible-ct.db`): pedidos, PAD, usuarios, intentos de notificación y auditoría. Respaldar periódicamente ese archivo (con la app detenida o con `sqlite3 combustible-ct.db ".backup respaldo.db"`).

## Pruebas

```bash
npm test
```

Las pruebas usan una base en memoria y un servidor SMTP local **de prueba** (solo dentro de los tests) para verificar el envío por SMTP sin salir a Internet, además de validaciones, permisos, idempotencia, filtros, exportación, panel y reintentos ante error de envío.
