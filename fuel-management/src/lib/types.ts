// Tipos de las filas que usa el frontend (espejo de supabase/migrations).
export type AppRole = 'administrador' | 'operaciones' | 'logistica' | 'supervision';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole | null;
  active: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Pad {
  id: string;
  code: string;
  name: string;
  area: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Well {
  id: string;
  pad_id: string;
  code: string;
  name: string;
  planned_stages: number | null;
  operational_status: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PadConsumption {
  pad_id: string;
  pad_code: string;
  wells: number;
  stages_done: number;
  stages_with_consumption: number;
  consumption_liters: number;
  avg_liters_per_stage: number | null;
}

export interface StockTotal {
  initial_liters: number;
  delivered_liters: number;
  consumed_liters: number;
  adjustments_liters: number;
  outflow_liters: number;
  estimated_liters: number;
}

export type OrderStatus = 'borrador' | 'solicitado' | 'enviado' | 'entregado_parcial' | 'entregado' | 'cancelado';
export type StageStatus = 'planificada' | 'realizada' | 'cancelada';
export type MovementType = 'stock_inicial' | 'ajuste_ingreso' | 'ajuste_egreso' | 'salida' | 'transferencia' | 'verificacion_fisica';

/** Fila de v_orders. */
export interface Order {
  id: string;
  order_number: string;
  pad_id: string;
  pad_code: string;
  pad_name: string;
  trips: number;
  trip_capacity_liters: number;
  requested_liters: number;
  required_date: string;
  status: OrderStatus;
  notification_status: 'no_enviado' | 'pendiente' | 'aceptado' | 'error';
  notes: string;
  cancel_reason: string;
  requested_by: string | null;
  requested_by_name: string | null;
  created_at: string;
  updated_at: string;
  delivered_liters: number;
  pending_liters: number;
  deliveries: number;
  last_delivery_at: string | null;
}

/** Fila de v_deliveries. */
export interface Delivery {
  id: string;
  order_id: string;
  order_number: string;
  pad_id: string;
  pad_code: string;
  delivered_at: string;
  liters: number;
  document_number: string;
  carrier: string;
  notes: string;
  received_by: string | null;
  received_by_name: string | null;
  created_at: string;
}

/** Fila de v_stages. */
export interface Stage {
  id: string;
  well_id: string;
  well_code: string;
  pad_id: string;
  pad_code: string;
  stage_number: number;
  status: StageStatus;
  planned_date: string | null;
  executed_at: string | null;
  notes: string;
  consumption_id: string | null;
  consumption_liters: number | null;
  consumption_notes: string | null;
  recorded_by_name: string | null;
}

/** Fila de v_movements. */
export interface Movement {
  id: string;
  movement_type: MovementType;
  pad_id: string;
  pad_code: string;
  to_pad_id: string | null;
  to_pad_code: string | null;
  liters: number;
  occurred_at: string;
  reason: string;
  created_by_name: string | null;
  created_at: string;
}

/** Fila de v_stock_by_pad. */
export interface StockByPad {
  pad_id: string;
  pad_code: string;
  pad_name: string;
  active: boolean;
  initial_liters: number;
  delivered_liters: number;
  consumed_liters: number;
  adjustments_liters: number;
  outflow_liters: number;
  transfers_net_liters: number;
  estimated_liters: number;
  verified_liters: number | null;
  verified_at: string | null;
  estimated_at_verification: number | null;
  verification_difference: number | null;
}

export interface LedgerRow {
  pad_id: string;
  occurred_at: string;
  delta: number;
  source: string;
  source_id: string;
}
