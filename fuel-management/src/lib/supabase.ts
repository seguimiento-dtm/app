import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Falta de configuración: la app muestra instrucciones en lugar de fallar. */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient = createClient(url || 'http://localhost', anonKey || 'sin-configurar', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const microsoftLoginEnabled = import.meta.env.VITE_AUTH_MICROSOFT === 'true';

/** Permisos delegados que se piden a Microsoft: identidad, envío de correo y renovación sin volver a ingresar. */
export const MICROSOFT_SCOPES = 'openid email profile offline_access User.Read Mail.Send';

/** Llama a una función de servidor y devuelve su respuesta JSON, también cuando responde con error. */
export async function invokeFunction<T extends { message?: string }>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (!error) return data as T;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try { return (await ctx.json()) as T; } catch { /* respuesta sin JSON */ }
  }
  return { status: 'error', message: /Failed to fetch|NetworkError/i.test(error.message) ? 'No se pudo contactar al servidor.' : error.message } as unknown as T;
}
