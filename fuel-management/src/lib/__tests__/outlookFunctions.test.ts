// Flujos de las funciones de servidor del envío por Outlook, con Microsoft y Supabase simulados.
import { describe, expect, it } from 'vitest';
import { handleSendOrder } from '../../../supabase/functions/send-order-email/handler.ts';
import { handleLink } from '../../../supabase/functions/microsoft-link/handler.ts';
import { decryptToken, encryptToken } from '../../../supabase/functions/_shared/crypto.ts';
import type { Db } from '../../../supabase/functions/_shared/http.ts';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const ENV = { MS_TENANT_ID: 'tenant', MS_CLIENT_ID: 'client', MS_CLIENT_SECRET: 'secret', TOKEN_ENCRYPTION_KEY: KEY };
const ORDER_ID = '0b9d6f7e-1c2a-4b3c-8d4e-5f6a7b8c9d0e';
const ORDER = { id: ORDER_ID, order_number: 'PC-2026-00003', pad_code: 'LA-WP130', trips: 1, trip_capacity_liters: 43000, requested_liters: 43000,
  required_date: '2026-10-30', notes: '', requested_by_name: 'Logística Prueba' };

interface Call { fn: string; args: Record<string, unknown> }

function fakeDb(opts: { user?: { id: string; email: string } | null; link?: { ms_email: string; refresh_token_enc: string } | null; begin?: unknown }) {
  const calls: Call[] = [];
  const db: Db = {
    auth: { getUser: async () => ({ data: { user: opts.user ?? null }, error: null }) },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'ms_token_get') return { data: opts.link ? [opts.link] : [], error: null };
      if (fn === 'begin_order_dispatch') return { data: opts.begin ?? { ok: true, dispatch_id: 'd1', recipient: 'mperez5@pan-energy.com', order: ORDER }, error: null };
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ORDER, error: null }) }) }) }),
  };
  return { db, calls };
}

function fakeFetch(opts: { tokenError?: string; me?: { mail: string; userPrincipalName: string }; sendStatus?: number; sendError?: string }) {
  const sent: { url: string; body: string }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/oauth2/v2.0/token')) {
      return opts.tokenError ? new Response(JSON.stringify({ error: opts.tokenError }), { status: 400 })
        : new Response(JSON.stringify({ access_token: 'acceso', refresh_token: 'renovado' }), { status: 200 });
    }
    if (u.includes('/v1.0/me?')) return new Response(JSON.stringify({ displayName: 'Logística Prueba', ...(opts.me ?? { mail: 'log@empresa.test', userPrincipalName: 'log@empresa.test' }) }), { status: 200 });
    if (u.endsWith('/me/sendMail')) {
      sent.push({ url: u, body: String(init?.body) });
      const st = opts.sendStatus ?? 202;
      return st === 202 ? new Response(null, { status: 202, headers: { 'request-id': 'req-1' } })
        : new Response(JSON.stringify({ error: { code: opts.sendError ?? 'ErrorAccessDenied' } }), { status: st });
    }
    throw new Error('URL no simulada ' + u);
  }) as typeof fetch;
  return { f, sent };
}

const req = (body: unknown, auth = 'Bearer jwt') => new Request('http://x/send', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const USER = { id: 'u1', email: 'log@empresa.test' };

describe('cifrado de tokens', () => {
  it('cifra y descifra; el texto cifrado no contiene el token', async () => {
    const enc = await encryptToken('token-secreto', KEY);
    expect(enc).not.toContain('token-secreto');
    expect(await decryptToken(enc, KEY)).toBe('token-secreto');
  });
});

describe('send-order-email', () => {
  it('envía desde la cuenta del usuario al destinatario configurado y registra el resultado', async () => {
    const { db, calls } = fakeDb({ user: USER, link: { ms_email: 'log@empresa.test', refresh_token_enc: await encryptToken('rt', KEY) } });
    const { f, sent } = fakeFetch({});
    const r = await handleSendOrder(req({ order_id: ORDER_ID, recipient: 'atacante@x.test' }), { db, fetch: f, env: ENV });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.status).toBe('aceptado');
    expect(j.message).toMatch(/aceptó el envío/);
    const msg = JSON.parse(sent[0].body).message;
    expect(msg.toRecipients[0].emailAddress.address).toBe('mperez5@pan-energy.com'); // nunca el que manda el navegador
    expect(msg.subject).toBe('[PEDIDO DE COMBUSTIBLE] PC-2026-00003 – LA-WP130 – 30/10/2026');
    expect(calls.find((c) => c.fn === 'finish_order_dispatch')?.args).toMatchObject({ p_dispatch_id: 'd1', p_ok: true, p_request_id: 'req-1' });
    const put = calls.find((c) => c.fn === 'ms_token_put')!;
    expect(await decryptToken(String(put.args.p_refresh_token_enc), KEY)).toBe('renovado'); // token rotado, guardado cifrado
  });

  it('rechaza si la cuenta Microsoft no es la del usuario', async () => {
    const { db, calls } = fakeDb({ user: USER, link: { ms_email: 'log@empresa.test', refresh_token_enc: await encryptToken('rt', KEY) } });
    const { f, sent } = fakeFetch({ me: { mail: 'otra@empresa.test', userPrincipalName: 'otra@empresa.test' } });
    const r = await handleSendOrder(req({ order_id: ORDER_ID }), { db, fetch: f, env: ENV });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('cuenta_distinta');
    expect(sent).toHaveLength(0);
    expect(calls.some((c) => c.fn === 'begin_order_dispatch')).toBe(false);
  });

  it('autorización vencida: mensaje claro, desvincula y no envía', async () => {
    const { db, calls } = fakeDb({ user: USER, link: { ms_email: 'log@empresa.test', refresh_token_enc: await encryptToken('rt', KEY) } });
    const { f, sent } = fakeFetch({ tokenError: 'invalid_grant' });
    const r = await handleSendOrder(req({ order_id: ORDER_ID }), { db, fetch: f, env: ENV });
    expect(r.status).toBe(401);
    expect((await r.json()).message).toMatch(/venció o fue revocada/);
    expect(calls.some((c) => c.fn === 'ms_token_delete')).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('Microsoft rechaza el envío: registra el error y permite reintentar', async () => {
    const { db, calls } = fakeDb({ user: USER, link: { ms_email: 'log@empresa.test', refresh_token_enc: await encryptToken('rt', KEY) } });
    const { f } = fakeFetch({ sendStatus: 403, sendError: 'ErrorAccessDenied' });
    const r = await handleSendOrder(req({ order_id: ORDER_ID }), { db, fetch: f, env: ENV });
    expect(r.status).toBe(403);
    expect((await r.json()).message).toMatch(/Mail.Send/);
    expect(calls.find((c) => c.fn === 'finish_order_dispatch')?.args).toMatchObject({ p_ok: false, p_error_code: 'ErrorAccessDenied' });
  });

  it('pedido ya enviado: no se envía otra vez', async () => {
    const { db } = fakeDb({ user: USER, link: { ms_email: 'log@empresa.test', refresh_token_enc: await encryptToken('rt', KEY) },
      begin: { ok: false, code: 'ya_enviado', message: 'Este pedido ya fue enviado por log@empresa.test.' } });
    const { f, sent } = fakeFetch({});
    const r = await handleSendOrder(req({ order_id: ORDER_ID }), { db, fetch: f, env: ENV });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('ya_enviado');
    expect(sent).toHaveLength(0);
  });

  it('sin configuración, sin sesión o sin vinculación: mensajes claros', async () => {
    const { f } = fakeFetch({});
    expect((await (await handleSendOrder(req({ order_id: ORDER_ID }), { db: fakeDb({ user: USER }).db, fetch: f, env: {} })).json()).code).toBe('no_configurado');
    expect((await handleSendOrder(req({ order_id: ORDER_ID }, ''), { db: fakeDb({ user: null }).db, fetch: f, env: ENV })).status).toBe(401);
    expect((await (await handleSendOrder(req({ order_id: ORDER_ID }), { db: fakeDb({ user: USER, link: null }).db, fetch: f, env: ENV })).json()).code).toBe('sin_vinculo');
  });
});

describe('microsoft-link', () => {
  it('vincula solo la cuenta Microsoft del propio usuario y guarda el token cifrado', async () => {
    const { db, calls } = fakeDb({ user: USER });
    const { f } = fakeFetch({});
    const r = await handleLink(req({ provider_token: 'acceso', provider_refresh_token: 'rt-inicial' }), { db, fetch: f, env: ENV });
    expect((await r.json()).linked).toBe(true);
    const put = calls.find((c) => c.fn === 'ms_token_put')!;
    expect(put.args.p_ms_email).toBe('log@empresa.test');
    expect(String(put.args.p_refresh_token_enc)).not.toContain('rt-inicial');

    const other = fakeFetch({ me: { mail: 'otra@empresa.test', userPrincipalName: 'otra@empresa.test' } });
    const r2 = await handleLink(req({ provider_token: 'a', provider_refresh_token: 'b' }), { db: fakeDb({ user: USER }).db, fetch: other.f, env: ENV });
    expect(r2.status).toBe(403);
  });
});
