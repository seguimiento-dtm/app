import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Droplet } from 'lucide-react';
import { supabase, microsoftLoginEnabled } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { Alert, Button, Field, Input } from '../../components/ui';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-navy-900 px-4 py-10 [background-image:radial-gradient(70%_60%_at_85%_10%,rgba(30,154,76,.22),transparent_60%),radial-gradient(60%_60%_at_0%_100%,rgba(37,80,127,.6),transparent_70%)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(80%_70%_at_50%_40%,#000_30%,transparent_80%)]" />
      <div className="relative w-full max-w-[440px] rounded-2xl bg-white p-7 shadow-2xl sm:p-9">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <Droplet className="h-4 w-4 fill-brand-600 text-brand-600" aria-hidden /> Fuel Management | Frac Operations
        </p>
        <h1 className="mt-3 font-display text-[26px] font-extrabold leading-tight text-navy-950">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-slate-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-5 text-sm font-semibold text-navy-700">{footer}</div>}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { session, profile, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string; notice?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) return <Navigate to={profile?.active ? loc.state?.from || '/' : '/pendiente'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else nav(loc.state?.from || '/', { replace: true });
  }

  async function microsoft() {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: window.location.origin } });
    if (err) setError(errorMessage(err));
  }

  return (
    <AuthShell title="Ingresar" subtitle="Gestión integral de combustible del Set de Fractura."
      footer={<><Link to="/recuperar" className="hover:underline">Olvidé la contraseña</Link><Link to="/registro" className="hover:underline">Solicitar acceso</Link></>}>
      {loc.state?.notice && <Alert tone="success" className="mb-5">{loc.state.notice}</Alert>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Correo electrónico" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" loading={busy} className="w-full min-h-[48px]">Ingresar</Button>
        {microsoftLoginEnabled && (
          <Button type="button" onClick={microsoft} className="w-full min-h-[48px]">Ingresar con Microsoft</Button>
        )}
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', password2: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.full_name.trim() || !form.email.trim()) return setError('Complete su nombre y correo.');
    if (form.password.length < 10) return setError('La contraseña debe tener al menos 10 caracteres.');
    if (form.password !== form.password2) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { full_name: form.full_name.trim() }, emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    if (data.session) nav('/pendiente', { replace: true });
    else nav('/ingresar', { replace: true, state: { notice: 'Le enviamos un correo para confirmar su dirección. Después, un administrador debe aprobar su acceso y asignarle un rol.' } });
  }

  return (
    <AuthShell title="Solicitar acceso" subtitle="Un administrador revisará la solicitud y le asignará un rol."
      footer={<Link to="/ingresar" className="hover:underline">Volver al ingreso</Link>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Nombre y apellido" htmlFor="r-name" required><Input id="r-name" autoComplete="name" value={form.full_name} onChange={set('full_name')} /></Field>
        <Field label="Correo corporativo" htmlFor="r-email" required><Input id="r-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Contraseña" htmlFor="r-pw" required hint="Mínimo 10 caracteres."><Input id="r-pw" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} /></Field>
        <Field label="Repetir contraseña" htmlFor="r-pw2" required><Input id="r-pw2" type="password" autoComplete="new-password" value={form.password2} onChange={set('password2')} /></Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" loading={busy} className="w-full min-h-[48px]">Enviar solicitud</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError('Ingrese su correo.');
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/restablecer` });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else setSent(true);
  }

  return (
    <AuthShell title="Olvidé la contraseña" subtitle="Le enviaremos un enlace para elegir una contraseña nueva."
      footer={<Link to="/ingresar" className="hover:underline">Volver al ingreso</Link>}>
      {sent ? (
        <Alert tone="success" title="Revise su correo">Si la dirección corresponde a un usuario, recibirá un enlace para restablecer la contraseña.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Correo electrónico" htmlFor="f-email"><Input id="f-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" variant="primary" loading={busy} className="w-full min-h-[48px]">Enviar enlace</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const nav = useNavigate();
  const { session, loading } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) return setError('La contraseña debe tener al menos 10 caracteres.');
    if (pw !== pw2) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(errorMessage(err));
    await supabase.auth.signOut();
    nav('/ingresar', { replace: true, state: { notice: 'Contraseña actualizada. Ingrese con la contraseña nueva.' } });
  }

  return (
    <AuthShell title="Contraseña nueva" footer={<Link to="/ingresar" className="hover:underline">Volver al ingreso</Link>}>
      {!loading && !session ? (
        <Alert tone="warning" title="Enlace vencido o inválido">Vuelva a usar “Olvidé la contraseña” para recibir un enlace nuevo.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Contraseña nueva" htmlFor="n-pw" hint="Mínimo 10 caracteres."><Input id="n-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Repetir contraseña" htmlFor="n-pw2"><Input id="n-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" variant="primary" loading={busy} className="w-full min-h-[48px]">Guardar contraseña</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function PendingPage() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const t = setInterval(refreshProfile, 30000);
    return () => clearInterval(t);
  }, [refreshProfile]);
  if (!loading && !session) return <Navigate to="/ingresar" replace />;
  if (profile?.active && profile.role) return <Navigate to="/" replace />;
  return (
    <AuthShell title="Acceso pendiente de aprobación" subtitle={profile?.email}>
      <Alert tone="info">
        Su usuario fue creado. Un administrador debe aprobarlo y asignarle un rol (Operaciones, Logística, Supervisión o Administrador) antes de que pueda ver la información.
      </Alert>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" loading={checking} onClick={async () => { setChecking(true); await refreshProfile(); setChecking(false); }}>Volver a comprobar</Button>
        <Button onClick={signOut}>Salir</Button>
      </div>
    </AuthShell>
  );
}
