// Microsoft Entra ID / Microsoft Graph con permisos delegados (el correo sale de la cuenta del usuario).

export const GRAPH_SCOPES = 'offline_access User.Read Mail.Send';

export interface MsEnv { MS_TENANT_ID: string; MS_CLIENT_ID: string; MS_CLIENT_SECRET: string }
type Fetch = typeof fetch;

export class GraphError extends Error {
  constructor(public code: string, message: string, public httpStatus: number) { super(message); }
}

/** Renueva el token de acceso. Entra ID puede rotar el token de renovación: se devuelve el nuevo. */
export async function refreshAccessToken(f: Fetch, env: MsEnv, refreshToken: string) {
  const r = await f(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken, scope: GRAPH_SCOPES,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant' || j.error === 'interaction_required') {
      throw new GraphError('autorizacion_vencida', 'Su autorización de Microsoft venció o fue revocada. Salga e ingrese nuevamente con Microsoft.', 401);
    }
    throw new GraphError('microsoft_token', `Microsoft no emitió el acceso (${j.error ?? r.status}). Consulte con TI la configuración de la aplicación.`, 502);
  }
  return { accessToken: j.access_token as string, refreshToken: (j.refresh_token as string | undefined) ?? refreshToken };
}

/** Cuenta del token (para impedir que un usuario envíe con la cuenta de otro). */
export async function getMe(f: Fetch, accessToken: string): Promise<{ email: string; upn: string; name: string }> {
  const r = await f('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw classify(r.status, await r.json().catch(() => ({})));
  const j = await r.json();
  return { email: String(j.mail ?? '').toLowerCase(), upn: String(j.userPrincipalName ?? '').toLowerCase(), name: String(j.displayName ?? '') };
}

export async function sendMail(f: Fetch, accessToken: string, msg: { to: string; subject: string; html: string }): Promise<string | null> {
  const r = await f('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: { subject: msg.subject, body: { contentType: 'HTML', content: msg.html }, toRecipients: [{ emailAddress: { address: msg.to } }] },
      saveToSentItems: true,
    }),
  });
  if (r.status !== 202) throw classify(r.status, await r.json().catch(() => ({})));
  return r.headers.get('request-id');
}

/** Traduce el rechazo de Microsoft Graph a un mensaje claro. */
export function classify(status: number, body: { error?: { code?: string; message?: string } }): GraphError {
  const code = body?.error?.code ?? `http_${status}`;
  if (status === 401) return new GraphError(code, 'La sesión de Microsoft expiró. Salga e ingrese nuevamente con Microsoft.', 401);
  if (code === 'ErrorAccessDenied' || status === 403) return new GraphError(code, 'Microsoft 365 no autorizó el envío desde su cuenta (permiso Mail.Send no concedido). Consulte con TI.', 403);
  if (code === 'MailboxNotEnabledForRESTAPI' || code === 'ResourceNotFound') return new GraphError(code, 'Su cuenta no tiene un buzón de Exchange Online habilitado para enviar correo.', 409);
  if (status === 429) return new GraphError(code, 'Microsoft limitó temporalmente los envíos. Reintente en unos minutos.', 429);
  if (code === 'ErrorInvalidRecipients') return new GraphError(code, 'Microsoft rechazó la dirección del destinatario configurado.', 422);
  return new GraphError(code, `Microsoft Graph rechazó el envío (${code}).`, 502);
}

export function sameAccount(me: { email: string; upn: string }, expected: string): boolean {
  const e = expected.trim().toLowerCase();
  return !!e && (me.email === e || me.upn === e);
}
