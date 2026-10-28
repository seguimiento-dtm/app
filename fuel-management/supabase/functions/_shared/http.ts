// Utilidades HTTP comunes de las funciones de servidor.

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

/** Mínimo que usan las funciones del cliente de Supabase (facilita probarlas sin red). */
export interface Db {
  auth: { getUser(jwt: string): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown }> };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  };
}

export interface Deps {
  db: Db;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
}

export const MS_KEYS = ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY'] as const;
export const missingConfig = (env: Deps['env']) => MS_KEYS.filter((k) => !env[k]);

export async function currentUser(req: Request, db: Db) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  return error || !data.user ? null : data.user;
}
