# Integración con Microsoft 365: envío de pedidos desde el Outlook del usuario

Guía para el área de TI. Mientras esta configuración no esté completa, la aplicación funciona igual. Para cada pedido genera el borrador del correo, con las opciones “Copiar texto” y “Abrir en Outlook”, y el envío directo queda **deshabilitado**.

## Qué hace la integración

1. La persona ingresa con **“Ingresar con Microsoft”** usando su cuenta corporativa. El ingreso pasa por Supabase Auth con el proveedor Azure (Microsoft Entra ID).
2. En ese ingreso, Microsoft entrega una autorización **delegada** para enviar correo en nombre de esa persona. La función de servidor `microsoft-link` verifica que la cuenta coincida con el usuario y guarda el token de renovación **cifrado (AES-GCM)** en un esquema de base de datos privado. Ese esquema no está publicado en la API ni es accesible desde el navegador.
3. Al confirmar un pedido, la función de servidor `send-order-email`:
   - valida la sesión, el rol (Logística o Administrador), el estado del pedido y que el envío esté habilitado;
   - comprueba que la cuenta de Microsoft sea la del usuario que confirma, para que nadie envíe con el correo de otra persona;
   - reserva el envío. Un pedido no puede tener dos envíos en curso o aceptados, así que un reintento no genera correos duplicados;
   - envía con Microsoft Graph `POST /me/sendMail` desde la cuenta del usuario. El correo queda en sus “Elementos enviados”;
   - registra el resultado real (remitente, destinatario, fecha, estado, identificador de Microsoft o error).
4. **Destinatario:** el que define un Administrador en la aplicación. Por defecto es `mperez5@pan-energy.com`. El navegador no puede elegir otro.
5. **Estado del pedido:** si Microsoft acepta el envío, el pedido queda “Aceptado por Microsoft 365”. Eso significa que Microsoft recibió el correo para entregarlo, no que el destinatario lo leyó. La aplicación nunca marca un pedido como entregado por haber enviado el correo.

## 1. Registro de la aplicación en Microsoft Entra ID

En <https://entra.microsoft.com> → **Identity → Applications → App registrations → New registration**:

| Campo | Valor |
|---|---|
| Name | `Fuel Management – Frac Operations` |
| Supported account types | **Accounts in this organizational directory only** (un solo inquilino) |
| Redirect URI | Plataforma **Web**: `https://<ref-del-proyecto>.supabase.co/auth/v1/callback` |

Después:

1. **Certificates & secrets → New client secret.** Anotar el *Value* (se muestra una sola vez) y agendar la renovación antes del vencimiento.
2. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, solo estas:
   - `openid`, `email`, `profile`: inicio de sesión;
   - `offline_access`: renovar la autorización sin volver a ingresar;
   - `User.Read`: verificar la identidad de la cuenta;
   - `Mail.Send`: enviar el correo **desde la cuenta del propio usuario**.

   Luego **Grant admin consent** para la organización.

   No se piden permisos de aplicación (*Application permissions*): la aplicación no puede enviar con buzones ajenos.
3. **Token configuration → Add optional claim → ID → `email`.** Si Supabase indica que el correo no está verificado, agregar también `xms_edov`.
4. **Recomendado.** En **Enterprise applications → (la aplicación) → Properties**, poner *Assignment required* = **Yes** y asignar solo el grupo de usuarios de la operación.

Datos que hay que entregar a quien administra Supabase:
- *Directory (tenant) ID*;
- *Application (client) ID*;
- *Client secret (Value)*.

## 2. Configuración en Supabase

1. **Authentication → Providers → Azure:** habilitar y completar:
   - **Client ID** y **Secret:** los del paso anterior;
   - **Azure Tenant URL:** `https://login.microsoftonline.com/<TENANT_ID>`.
2. **Authentication → URL Configuration:** la URL de la aplicación debe figurar en *Site URL* o *Redirect URLs*.
3. **Secretos de las funciones de servidor.** Con la CLI, desde la carpeta `fuel-management`:
   ```bash
   npx supabase secrets set \
     MS_TENANT_ID=<tenant-id> \
     MS_CLIENT_ID=<client-id> \
     MS_CLIENT_SECRET=<client-secret> \
     TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
   npx supabase functions deploy microsoft-link
   npx supabase functions deploy send-order-email
   ```
   `TOKEN_ENCRYPTION_KEY` cifra los tokens guardados. Si se cambia, los usuarios tienen que volver a ingresar con Microsoft para vincular su cuenta. No se guarda en la base de datos ni en el código.
4. **Frontend:** en `.env.local`, poner `VITE_AUTH_MICROSOFT=true` y volver a compilar y publicar. Aparece el botón “Ingresar con Microsoft”.

## 3. Prueba antes de habilitar en producción

1. **Destinatario de prueba:** en **Administración de Usuarios → Destinatario de los pedidos**, poner una casilla de prueba, por ejemplo la de quien prueba.
2. Ingresar con **“Ingresar con Microsoft”** con una cuenta de Logística. Debe aparecer “Cuenta de Outlook vinculada (…)”.
3. **Habilitar el envío:** un Administrador entra en **Administración de Usuarios → Envío de pedidos desde Outlook → Habilitar envío**.
4. Crear un pedido de prueba (escribir “PRUEBA” en Observaciones), registrarlo y abrir **Correo de solicitud → Enviar desde mi Outlook**.
5. Verificar:
   - que el mensaje llegue al destinatario de prueba;
   - que figure en “Elementos enviados” de quien envió;
   - que el pedido muestre “Aceptado por Microsoft 365”;
   - que un segundo intento informe que ya fue enviado.
6. **Cerrar la prueba:** cancelar el pedido de prueba con el motivo “Prueba de integración” y **restablecer el destinatario** a `mperez5@pan-energy.com`.

Si la organización no autoriza la integración, dejar el envío **deshabilitado**. El borrador y “Abrir en Outlook” siguen disponibles.

## Seguridad

- **Datos en el navegador:**
  - Nunca hay contraseñas, secretos ni tokens de renovación en tablas accesibles desde el navegador.
  - Los tokens que Microsoft entrega al ingresar se envían una sola vez a la función `microsoft-link`.
  - Supabase Auth los mantiene en la sesión del navegador hasta la próxima renovación de sesión, como hace con cualquier proveedor externo.
- **Datos en el servidor:**
  - El token de renovación se guarda cifrado. La clave vive solo en los secretos de las funciones.
  - El token de acceso existe solo en memoria durante cada envío.
- **Revocación:**
  - Cada usuario puede desvincularse.
  - TI puede revocar las sesiones del usuario en Entra ID. Al intentar enviar, la aplicación muestra “Su autorización de Microsoft venció o fue revocada” y borra la vinculación.
- **Auditoría:** cada envío queda en la tabla `email_dispatches` y en la auditoría general.

## Mensajes y causas

| Mensaje en la aplicación | Causa probable |
|---|---|
| “El envío desde Outlook no está configurado en el servidor” | Faltan secretos `MS_*` o `TOKEN_ENCRYPTION_KEY` en las funciones. |
| “El envío desde Outlook todavía no está habilitado” | Un Administrador no activó el envío. |
| “Para enviar desde su Outlook, salga e ingrese con su cuenta Microsoft” | El usuario ingresó con correo y contraseña, o su vinculación fue borrada. |
| “Microsoft no entregó la autorización de envío” | Falta el consentimiento de `offline_access` o `Mail.Send`. |
| “Su autorización de Microsoft venció o fue revocada” | Sesión revocada en Entra ID, contraseña cambiada o inactividad prolongada. |
| “Microsoft 365 no autorizó el envío desde su cuenta” | `Mail.Send` sin consentimiento, o política de Exchange que lo bloquea. |
| “Su cuenta no tiene un buzón de Exchange Online habilitado” | La cuenta no tiene licencia de buzón. |
| “La cuenta Microsoft no coincide con su usuario” | Se ingresó con una cuenta distinta del correo del usuario. |
