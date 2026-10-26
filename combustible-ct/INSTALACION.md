# Instalación en servidor – Pedidos de Combustible CT

Guía para dejar la aplicación funcionando en un servidor de la empresa, accesible desde el navegador por los usuarios, con base de datos persistente y envío real de correo.

## 1. Qué hay que pedir a TI

| Necesidad | Detalle |
|---|---|
| **Servidor** | Windows Server o Linux, con 1 vCPU, 1 GB de RAM y 5 GB de disco. Debe ser accesible desde la red de los usuarios (oficina, base y campo vía VPN si corresponde). |
| **Node.js 22** | Versión **22.13 o superior** (LTS). No requiere otra base de datos: usa un archivo SQLite. |
| **Nombre y certificado** | Un nombre interno (ej.: `combustible-ct.empresa.local`) y un certificado HTTPS. |
| **Correo** | Opción A: buzón de servicio (ej.: `pedidos.combustible@pan-energy.com`) con **SMTP AUTH** habilitado en Microsoft 365. Opción B: aplicación en Entra ID con permiso **Mail.Send** (Microsoft Graph). Detalle en el README, “Configuración del correo”. |
| **Firewall saliente** | Opción A: `smtp.office365.com` puerto **587**. Opción B: `login.microsoftonline.com` y `graph.microsoft.com` puerto **443**. |
| **Respaldo** | Copia diaria de la carpeta `data/`, donde está la base de datos. |

Elegir una de las tres formas de instalación siguientes, la que use habitualmente el área de TI.

---

## 2A. Windows Server (con IIS)

1. Instalar **Node.js 22 LTS** desde <https://nodejs.org> (instalador `.msi`, opciones por defecto).
2. Copiar la carpeta `combustible-ct` del repositorio a `C:\Apps\combustible-ct`.
3. En una consola (PowerShell) dentro de esa carpeta:
   ```powershell
   cd C:\Apps\combustible-ct
   npm ci --omit=dev
   copy .env.example .env
   notepad .env
   ```
   En `.env` completar: `APP_URL=https://<nombre-del-servidor>` (para los enlaces de “Olvidé la contraseña”), `HOST=127.0.0.1`, `COOKIE_SECURE=true` y las variables de correo (`SMTP_*` y `MAIL_FROM`, o `GRAPH_*`).
4. Crear el administrador y cargar los Well PAD:
   ```powershell
   npm run crear-admin
   npm run importar-pads -- datos\WP_por_Pozos.xlsx --aplicar
   ```
5. Probar a mano: `npm start` y abrir `http://localhost:3000` en el servidor. Cerrar con Ctrl+C.
6. **Dejarla como servicio de Windows** para que arranque sola. Con [NSSM](https://nssm.cc):
   ```powershell
   nssm install CombustibleCT "C:\Program Files\nodejs\node.exe" "--disable-warning=ExperimentalWarning server\index.js"
   nssm set CombustibleCT AppDirectory C:\Apps\combustible-ct
   nssm set CombustibleCT AppStdout C:\Apps\combustible-ct\data\servicio.log
   nssm set CombustibleCT AppStderr C:\Apps\combustible-ct\data\servicio.log
   nssm set CombustibleCT Start SERVICE_AUTO_START
   nssm start CombustibleCT
   ```
7. **Publicar por HTTPS con IIS:** instalar los módulos *URL Rewrite* y *Application Request Routing* (en ARR, habilitar “Enable proxy”). Crear un sitio con el certificado HTTPS y copiar `deploy\web.config` en la carpeta del sitio.
8. Abrir `https://<nombre-del-servidor>` desde una PC de usuario.

---

## 2B. Linux (systemd + Nginx)

```bash
# Node.js 22 (ejemplo para Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs nginx

sudo useradd --system --home /opt/combustible-ct combustible
sudo cp -r combustible-ct /opt/combustible-ct
cd /opt/combustible-ct
sudo npm ci --omit=dev
sudo cp .env.example .env && sudo nano .env      # APP_URL, HOST=127.0.0.1, COOKIE_SECURE=true y correo
sudo mkdir -p data && sudo chown -R combustible:combustible data .env
sudo chmod 600 .env

sudo -u combustible npm run crear-admin
sudo -u combustible npm run importar-pads -- datos/WP_por_Pozos.xlsx --aplicar

sudo cp deploy/combustible-ct.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now combustible-ct
sudo cp deploy/nginx.conf /etc/nginx/sites-enabled/combustible-ct.conf   # ajustar nombre y certificados
sudo nginx -t && sudo systemctl reload nginx
```

Ver el registro del servicio: `journalctl -u combustible-ct -f`.

---

## 2C. Docker

```bash
cd combustible-ct
cp .env.example .env        # completar APP_URL y correo; COOKIE_SECURE=true si hay HTTPS delante
docker compose build
docker compose run --rm app npm run crear-admin
docker compose run --rm app npm run importar-pads -- datos/WP_por_Pozos.xlsx --aplicar
docker compose up -d
```

La base queda en `./data` del host (volumen). Publicar el puerto 3000 detrás del proxy HTTPS de la empresa.

---

## 3. Verificación final

1. Ingresar con el administrador.
2. **Configuración**: debe decir “Proveedor … configurado”. Presionar **Enviar correo de prueba** y confirmar que llega a `mperez5@pan-energy.com`.
   Si falla, el mensaje indica la causa. Las más comunes:
   - `535 Authentication unsuccessful` / `SmtpClientAuthentication is disabled`: falta habilitar SMTP AUTH en el buzón, o la contraseña es incorrecta.
   - `ETIMEDOUT` / `ECONNREFUSED`: el firewall bloquea la salida al puerto 587.
   - `SendAsDenied`: `MAIL_FROM` no coincide con el buzón autenticado.
3. **Usuarios**: cargar el correo del administrador (para recibir los avisos de solicitudes) y crear los operadores, o pedirles que usen “Crear usuario nuevo” y aprobarlos.
4. Generar un pedido de prueba (indicarlo en Observaciones como “PRUEBA”) y verificar que llegue el correo. Después, cancelarlo con motivo “Prueba de instalación”.

## 4. Operación

- **Actualizar la app:** reemplazar los archivos (sin tocar `data/` ni `.env`), ejecutar `npm ci --omit=dev` y reiniciar el servicio. La base se actualiza sola al arrancar.
- **Nuevo listado de Well PAD:** Administración de PAD → Importar listado Excel.
- **Respaldo:** copiar `data/combustible-ct.db` (idealmente con el servicio detenido o con `sqlite3 combustible-ct.db ".backup respaldo.db"`).
- **Olvido de la contraseña de administrador:** `npm run crear-admin` con el mismo usuario la restablece.
