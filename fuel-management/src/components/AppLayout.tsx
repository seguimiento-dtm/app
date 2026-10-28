import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, ClipboardList, Droplet, Fuel, Gauge, History, Layers, LogOut, MapPin, Menu, Truck, Users, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/roles';
import type { AppRole } from '../lib/types';
import { Spinner } from './ui';

export const NAV: { to: string; label: string; Icon: typeof Gauge; roles?: AppRole[] }[] = [
  { to: '/', label: 'Dashboard Operativo', Icon: Gauge },
  { to: '/pedidos', label: 'Pedidos de Combustible', Icon: Fuel },
  { to: '/historial', label: 'Historial de Pedidos', Icon: History },
  { to: '/pads', label: 'PADs y Pozos', Icon: MapPin },
  { to: '/etapas', label: 'Registro de Etapas', Icon: Layers },
  { to: '/entregas', label: 'Entregas de Combustible', Icon: Truck },
  { to: '/inventario', label: 'Inventario y Stock', Icon: ClipboardList },
  { to: '/reporte', label: 'Reporte Gerencial', Icon: BarChart3 },
  { to: '/usuarios', label: 'Administración de Usuarios', Icon: Users, roles: ['administrador'] },
];

/** Exige sesión y perfil aprobado. Los permisos reales los valida la base de datos. */
export function RequireAuth({ roles }: { roles?: AppRole[] }) {
  const { session, profile, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="min-h-screen bg-slate-50"><Spinner /></div>;
  if (!session) return <Navigate to="/ingresar" replace state={{ from: loc.pathname }} />;
  if (!profile || !profile.active || !profile.role) return <Navigate to="/pendiente" replace />;
  if (roles && !roles.includes(profile.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function AppLayout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const items = NAV.filter((n) => !n.roles || (profile?.role && n.roles.includes(profile.role)));

  const sidebar = (
    <aside className="flex h-full w-[272px] flex-col bg-navy-900 text-slate-300 [background-image:radial-gradient(120%_50%_at_0%_0%,rgba(30,154,76,.16),transparent_60%)]">
      <div className="px-5 pb-5 pt-6">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">Frac Operations</p>
        <p className="mt-2 flex items-center gap-2.5 font-display text-[21px] font-extrabold leading-none text-white">
          <Droplet className="h-5 w-5 fill-brand-500 text-brand-500" aria-hidden /> Fuel Management
        </p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3" aria-label="Secciones">
        <ul className="space-y-0.5">
          {items.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] font-medium transition-colors ${
                    isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-brand-500" aria-hidden />}
                    <Icon className={`h-[18px] w-[18px] flex-none ${isActive ? 'text-brand-500' : ''}`} aria-hidden />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="m-3 rounded-xl border border-white/10 bg-white/5 p-3.5 text-[13px]">
        <p className="truncate font-semibold text-white">{profile?.full_name || profile?.email}</p>
        <p className="text-slate-400">{profile?.role ? ROLE_LABEL[profile.role] : ''}</p>
        <button onClick={signOut}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1.5 text-[12.5px] text-slate-200 transition hover:border-white/40 hover:bg-white/10">
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Salir
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>
      <div className="sticky top-0 z-30 flex items-center gap-3 bg-navy-900 px-4 py-3 text-white lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-md p-1.5 hover:bg-white/10"><Menu className="h-6 w-6" /></button>
        <span className="font-display text-[17px] font-extrabold">Fuel Management</span>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="relative h-full w-[272px] shadow-2xl">
            {sidebar}
            <button onClick={() => setOpen(false)} aria-label="Cerrar menú" className="absolute right-3 top-5 rounded-md p-1 text-slate-300 hover:bg-white/10"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-7 sm:px-6 lg:px-10 lg:pt-10">
        <Outlet />
      </main>
    </div>
  );
}
