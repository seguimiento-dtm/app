// Vincula la cuenta Microsoft del usuario después de ingresar con Microsoft: guarda cifrado el token de
// renovación (solo en el servidor) para poder enviar pedidos en su nombre.
import { CORS, currentUser, json, missingConfig, type Deps } from '../_shared/http.ts';
import { encryptToken } from '../_shared/crypto.ts';
import { GraphError, getMe, sameAccount } from '../_shared/graph.ts';

export async function handleLink(req: Request, { db, fetch: f, env }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ linked: false, message: 'Método no permitido.' }, 405);
  const user = await currentUser(req, db);
  if (!user) return json({ linked: false, code: 'sesion_vencida', message: 'Su sesión expiró. Ingrese nuevamente.' }, 401);
  if (missingConfig(env).length) return json({ linked: false, code: 'no_configurado', message: 'El envío desde Outlook no está configurado en el servidor.' }, 503);

  const body = await req.json().catch(() => ({}));
  const providerToken = String(body?.provider_token ?? '');
  const refreshToken = String(body?.provider_refresh_token ?? '');
  if (!providerToken || !refreshToken) {
    return json({ linked: false, code: 'sin_token', message: 'Microsoft no entregó la autorización de envío. Verifique que TI haya concedido Mail.Send y offline_access.' }, 400);
  }
  try {
    const me = await getMe(f, providerToken);
    if (!user.email || !sameAccount(me, user.email)) {
      return json({ linked: false, code: 'cuenta_distinta', message: 'La cuenta Microsoft no coincide con el correo de su usuario.' }, 403);
    }
    const msEmail = me.email || me.upn;
    const r = await db.rpc('ms_token_put', { p_user_id: user.id, p_ms_email: msEmail, p_refresh_token_enc: await encryptToken(refreshToken, env.TOKEN_ENCRYPTION_KEY!) });
    if (r.error) return json({ linked: false, code: 'servidor', message: 'No se pudo guardar la vinculación.' }, 500);
    return json({ linked: true, ms_email: msEmail });
  } catch (e) {
    const g = e instanceof GraphError ? e : new GraphError('red', 'No se pudo contactar a Microsoft Graph.', 502);
    return json({ linked: false, code: g.code, message: g.message }, g.httpStatus);
  }
}
