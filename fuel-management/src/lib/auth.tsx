import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeFunction, supabase } from './supabase';
import type { Profile } from './types';

interface AuthState {
  /** Resultado de vincular la cuenta Microsoft al ingresar con Microsoft (para mostrar un aviso). */
  linkNotice: { tone: 'success' | 'warning'; text: string } | null;
  clearLinkNotice: () => void;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
/** Evita vincular dos veces la misma autorización en esta pestaña. */
let lastLinked: string | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkNotice, setLinkNotice] = useState<AuthState['linkNotice']>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    setProfile(error ? null : (data as Profile | null));
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Al volver de "Ingresar con Microsoft", Supabase entrega una sola vez los tokens del proveedor:
      // se envían a la función de servidor, que guarda cifrado el de renovación. No se guardan en el navegador.
      if (event === 'SIGNED_IN' && s?.provider_token && s.provider_refresh_token && s.provider_refresh_token !== lastLinked) {
        lastLinked = s.provider_refresh_token;
        const tokens = { provider_token: s.provider_token, provider_refresh_token: s.provider_refresh_token };
        setTimeout(() => {
          invokeFunction<{ linked?: boolean; ms_email?: string; message?: string }>('microsoft-link', tokens).then((r) =>
            setLinkNotice(r.linked ? { tone: 'success', text: `Cuenta de Outlook vinculada (${r.ms_email}). Puede enviar pedidos desde su correo.` }
              : { tone: 'warning', text: r.message ?? 'No se pudo vincular la cuenta de Outlook.' }));
        }, 0);
      }
      // Se difiere para no consultar dentro del callback de Supabase Auth.
      setTimeout(() => {
        loadProfile(s).finally(() => setLoading(false));
      }, 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value: AuthState = {
    linkNotice,
    clearLinkNotice: () => setLinkNotice(null),
    session,
    profile,
    loading,
    refreshProfile: () => loadProfile(session),
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
