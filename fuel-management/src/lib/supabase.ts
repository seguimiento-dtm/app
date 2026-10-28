import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Falta de configuración: la app muestra instrucciones en lugar de fallar. */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient = createClient(url || 'http://localhost', anonKey || 'sin-configurar', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const microsoftLoginEnabled = import.meta.env.VITE_AUTH_MICROSOFT === 'true';
