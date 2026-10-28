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
