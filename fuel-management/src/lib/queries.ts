import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Order, Pad, Well } from './types';

/** Lanza el error de Supabase o devuelve los datos tipados. */
export async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  return data as T;
}

export const TRIP_CAPACITY_LITERS = 43000;

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog-lite'],
    queryFn: async () => {
      const [pads, wells] = await Promise.all([
        rows<Pad[]>(supabase.from('pads').select('*').order('code')),
        rows<Well[]>(supabase.from('wells').select('*').order('code')),
      ]);
      return { pads, wells };
    },
    staleTime: 5 * 60_000,
  });
}

export function useOrderRecipient() {
  return useQuery({
    queryKey: ['settings', 'order_recipient'],
    queryFn: async () => {
      const r = await rows<{ value: string } | null>(supabase.from('app_settings').select('value').eq('key', 'order_recipient').maybeSingle());
      return r?.value ?? '';
    },
    staleTime: 5 * 60_000,
  });
}

export function useOrders(filter: 'abiertos' | 'todos' = 'todos') {
  return useQuery({
    queryKey: ['orders', filter],
    queryFn: () => {
      let q = supabase.from('v_orders').select('*').order('created_at', { ascending: false });
      if (filter === 'abiertos') q = q.in('status', ['borrador', 'solicitado', 'enviado', 'entregado_parcial']);
      return rows<Order[]>(q);
    },
  });
}

/** Claves que dependen de pedidos, entregas, etapas o movimientos (para refrescar tras cambios). */
export const OPERATIONAL_KEYS = [['orders'], ['order'], ['deliveries'], ['stages'], ['stock'], ['movements'], ['dashboard'], ['catalog'], ['report']];
