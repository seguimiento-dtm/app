import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from '../lib/roles';
import { errorMessage } from '../lib/errors';
import { dateTime } from '../lib/format';
import type { AppRole, Profile } from '../lib/types';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Spinner, useToast } from '../components/ui';

interface AuditRow {
  id: number;
  table_name: string;
  record_id: string | null;
  action: string;
  changed_by: string | null;
  changed_at: string;
}

const TABLE_LABEL: Record<string, string> = {
  profiles: 'Usuario', pads: 'PAD', wells: 'Pozo', fracture_stages: 'Etapa', fuel_orders: 'Pedido',
  fuel_deliveries: 'Entrega', fuel_consumption: 'Consumo', inventory_movements: 'Movimiento de stock',
};
const ACTION_LABEL: Record<string, string> = { insert: 'Alta', update: 'Modificación', delete: 'Baja' };

export default function UsersPage() {
  const { profile: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const r = await supabase.from('profiles').select('*').order('full_name');
      if (r.error) throw r.error;
      return r.data as Profile[];
    },
  });
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const r = await supabase.from('audit_logs').select('id, table_name, record_id, action, changed_by, changed_at').order('changed_at', { ascending: false }).limit(100);
      if (r.error) throw r.error;
      return r.data as AuditRow[];
    },
  });
  const [editing, setEditing] = useState<Profile | null>(null);

  const update = useMutation({
    mutationFn: async (v: { id: string; role: AppRole | null; active: boolean }) => {
      const r = await supabase.rpc('admin_update_user', { target: v.id, new_role: v.role, new_active: v.active });
      if (r.error) throw r.error;
      return r.data as Profile;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      toast(`${p.full_name || p.email}: ${p.active ? `activo como ${ROLE_LABEL[p.role as AppRole]}` : 'sin acceso'}.`, 'success');
      setEditing(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const all = users.data ?? [];
  const pending = all.filter((u) => !u.active && !u.approved_at);
  const rest = all.filter((u) => u.active || u.approved_at);
  const nameOf = (id: string | null) => (id ? all.find((u) => u.id === id)?.full_name ?? 'Usuario' : 'Sistema');

  return (
    <>
      <PageHeader eyebrow="Accesos" title="Administración de Usuarios"
        description="Las personas solicitan acceso desde la pantalla de ingreso. Un administrador las aprueba y asigna el rol; sin rol no ven ningún dato." />
      {users.isLoading && <Spinner />}
      {users.error && <Alert tone="error">{errorMessage(users.error)}</Alert>}

      {users.data && (
        <div className="space-y-6">
          {pending.length > 0 && (
            <Card className="border-brand-100 ring-4 ring-brand-50">
              <h2 className="mb-4 font-display text-lg font-bold text-navy-950">Solicitudes pendientes ({pending.length})</h2>
              <ul className="divide-y divide-slate-100">
                {pending.map((u) => <PendingRow key={u.id} user={u} busy={update.isPending} onApprove={(role) => update.mutate({ id: u.id, role, active: true })} />)}
              </ul>
            </Card>
          )}

          <Card flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13.5px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Aprobado</th><th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rest.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-4 py-3"><p className="font-semibold text-navy-900">{u.full_name || '—'}{u.id === me?.id && <span className="ml-2 text-xs font-normal text-slate-500">(usted)</span>}</p><p className="text-slate-500">{u.email}</p></td>
                      <td className="px-4 py-3">{u.role ? ROLE_LABEL[u.role] : '—'}</td>
                      <td className="px-4 py-3">{u.active ? <Badge tone="green">Activo</Badge> : <Badge>Sin acceso</Badge>}</td>
                      <td className="px-4 py-3 text-slate-600">{u.approved_at ? <>{dateTime(u.approved_at)}<br /><span className="text-slate-500">{nameOf(u.approved_by)}</span></> : '—'}</td>
                      <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => setEditing(u)} disabled={u.id === me?.id}>Modificar</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-display text-lg font-bold text-navy-950">Registro de auditoría</h2>
            <p className="mb-4 text-sm text-slate-600">Últimas 100 altas, modificaciones y bajas, registradas automáticamente por la base de datos.</p>
            {audit.error && <Alert tone="error">{errorMessage(audit.error)}</Alert>}
            {audit.data && audit.data.length === 0 && <EmptyState title="Sin movimientos registrados todavía" />}
            {audit.data && audit.data.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead><tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500"><th className="px-3.5 py-2.5">Fecha</th><th className="px-3.5 py-2.5">Usuario</th><th className="px-3.5 py-2.5">Acción</th><th className="px-3.5 py-2.5">Registro</th></tr></thead>
                  <tbody>
                    {audit.data.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-3.5 py-2 tabular-nums">{dateTime(a.changed_at)}</td>
                        <td className="px-3.5 py-2">{nameOf(a.changed_by)}</td>
                        <td className="px-3.5 py-2">{ACTION_LABEL[a.action] ?? a.action}</td>
                        <td className="px-3.5 py-2 text-slate-600">{TABLE_LABEL[a.table_name] ?? a.table_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {editing && <EditUser user={editing} busy={update.isPending} onClose={() => setEditing(null)} onSave={(role, active) => update.mutate({ id: editing.id, role, active })} />}
    </>
  );
}

function PendingRow({ user, busy, onApprove }: { user: Profile; busy: boolean; onApprove: (role: AppRole) => void }) {
  const [role, setRole] = useState<AppRole>('operaciones');
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[200px] flex-1">
        <p className="font-semibold text-navy-900">{user.full_name || '—'}</p>
        <p className="text-sm text-slate-500">{user.email} · solicitado {dateTime(user.created_at)}</p>
      </div>
      <div className="w-56">
        <Select aria-label={`Rol para ${user.full_name}`} className="min-h-[38px] py-1.5 text-sm" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
      </div>
      <Button variant="primary" size="sm" loading={busy} onClick={() => onApprove(role)}>Aprobar</Button>
    </li>
  );
}

function EditUser({ user, busy, onClose, onSave }: { user: Profile; busy: boolean; onClose: () => void; onSave: (role: AppRole, active: boolean) => void }) {
  const [role, setRole] = useState<AppRole>(user.role ?? 'operaciones');
  const [active, setActive] = useState(user.active);
  return (
    <Modal open title={`Modificar ${user.full_name || user.email}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => onSave(role, active)}>Guardar</Button></>}>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-navy-900">Rol</legend>
        {ROLES.map((r) => (
          <label key={r} className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 transition ${role === r ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-400'}`}>
            <input type="radio" name="role" className="mt-1 accent-brand-600" checked={role === r} onChange={() => setRole(r)} />
            <span><span className="block font-semibold text-navy-900">{ROLE_LABEL[r]}</span><span className="text-sm text-slate-600">{ROLE_DESCRIPTION[r]}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="mt-5 flex items-center gap-2 text-sm font-semibold text-navy-900">
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={active} onChange={(e) => setActive(e.target.checked)} /> Acceso habilitado
      </label>
    </Modal>
  );
}
