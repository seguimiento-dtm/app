// Envía un pedido de combustible desde la cuenta Outlook del usuario que lo confirma.
// Valida sesión, rol, pedido, configuración e identidad; registra el resultado real y evita duplicados.
import { CORS, currentUser, json, missingConfig, type Deps } from '../_shared/http.ts';
import { decryptToken, encryptToken } from '../_shared/crypto.ts';
import { GraphError, getMe, refreshAccessToken, sameAccount, sendMail } from '../_shared/graph.ts';
import { orderMailHtml, orderMailSubject, type OrderMailData } from '../_shared/orderMail.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleSendOrder(req: Request, { db, fetch: f, env }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ status: 'error', code: 'metodo', message: 'Método no permitido.' }, 405);

  const user = await currentUser(req, db);
  if (!user) return json({ status: 'error', code: 'sesion_vencida', message: 'Su sesión expiró. Ingrese nuevamente.' }, 401);

  const missing = missingConfig(env);
  if (missing.length) {
    return json({ status: 'error', code: 'no_configurado', message: 'El envío desde Outlook no está configurado en el servidor. Use el borrador del correo.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const orderId = String(body?.order_id ?? '');
  if (!UUID.test(orderId)) return json({ status: 'error', code: 'pedido_invalido', message: 'Pedido inválido.' }, 400);

  const tok = await db.rpc('ms_token_get', { p_user_id: user.id });
  const link = (Array.isArray(tok.data) ? tok.data[0] : tok.data) as { ms_email: string; refresh_token_enc: string } | undefined;
  if (tok.error || !link) {
    return json({ status: 'error', code: 'sin_vinculo', message: 'Para enviar desde su Outlook, salga e ingrese con su cuenta Microsoft.' }, 409);
  }

  // 1) Acceso a Microsoft Graph con la autorización del propio usuario.
  let accessToken: string;
  try {
    const refreshed = await refreshAccessToken(f, env as never, await decryptToken(link.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY!));
    accessToken = refreshed.accessToken;
    if (refreshed.refreshToken) {
      await db.rpc('ms_token_put', { p_user_id: user.id, p_ms_email: link.ms_email, p_refresh_token_enc: await encryptToken(refreshed.refreshToken, env.TOKEN_ENCRYPTION_KEY!) });
    }
  } catch (e) {
    if (e instanceof GraphError && e.code === 'autorizacion_vencida') await db.rpc('ms_token_delete', { p_user_id: user.id });
    const g = e instanceof GraphError ? e : new GraphError('microsoft_token', 'No se pudo obtener la autorización de Microsoft.', 502);
    return json({ status: 'error', code: g.code, message: g.message }, g.httpStatus);
  }

  // 2) La cuenta del token debe ser la vinculada por este usuario: nadie envía con el correo de otro.
  let sender: { email: string; upn: string; name: string };
  try {
    sender = await getMe(f, accessToken);
  } catch (e) {
    const g = e as GraphError;
    return json({ status: 'error', code: g.code, message: g.message }, g.httpStatus ?? 502);
  }
  if (!sameAccount(sender, link.ms_email) || (user.email && !sameAccount(sender, user.email))) {
    return json({ status: 'error', code: 'cuenta_distinta', message: 'La cuenta Microsoft no coincide con su usuario. Salga e ingrese con su propia cuenta.' }, 403);
  }
  const senderEmail = sender.email || sender.upn;

  // 3) Datos del pedido (del servidor, nunca del navegador) y reserva del envío.
  const ord = await db.from('v_orders').select('*').eq('id', orderId).maybeSingle();
  if (ord.error || !ord.data) return json({ status: 'error', code: 'pedido_inexistente', message: 'Pedido inexistente.' }, 404);
  const order = ord.data as OrderMailData;
  const subject = orderMailSubject(order);
  const begin = await db.rpc('begin_order_dispatch', { p_order_id: orderId, p_user_id: user.id, p_sender_email: senderEmail, p_subject: subject });
  if (begin.error) return json({ status: 'error', code: 'servidor', message: 'No se pudo registrar el envío. Reintente.' }, 500);
  const b = begin.data as { ok: boolean; code?: string; message?: string; dispatch_id: string; recipient: string; order: OrderMailData };
  if (!b.ok) return json({ status: 'error', code: b.code, message: b.message }, b.code === 'sin_permiso' ? 403 : 409);

  // 4) Envío real y registro del resultado.
  try {
    const requestId = await sendMail(f, accessToken, { to: b.recipient, subject, html: orderMailHtml(b.order, sender.name) });
    await db.rpc('finish_order_dispatch', { p_dispatch_id: b.dispatch_id, p_ok: true, p_request_id: requestId, p_error_code: null, p_error_message: null });
    return json({
      status: 'aceptado', dispatch_id: b.dispatch_id, sender: senderEmail, recipient: b.recipient,
      message: `Microsoft 365 aceptó el envío desde ${senderEmail} a ${b.recipient}. La recepción la confirma el destinatario.`,
    });
  } catch (e) {
    const g = e instanceof GraphError ? e : new GraphError('red', 'No se pudo contactar a Microsoft Graph. El pedido se conserva; puede reintentar.', 502);
    await db.rpc('finish_order_dispatch', { p_dispatch_id: b.dispatch_id, p_ok: false, p_request_id: null, p_error_code: g.code, p_error_message: g.message });
    return json({ status: 'error', code: g.code, message: g.message }, g.httpStatus);
  }
}
