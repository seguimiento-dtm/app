import { Alert, Card, PageHeader } from '../components/ui';

export interface UpcomingSection {
  eyebrow: string;
  title: string;
  phase: string;
  summary: string;
  ready: string[];
}

/** Sección todavía no habilitada: explica qué falta en lugar de mostrar datos inventados. */
export default function UpcomingPage({ s }: { s: UpcomingSection }) {
  return (
    <>
      <PageHeader eyebrow={s.eyebrow} title={s.title} description={s.summary} />
      <Alert tone="info" title={`Disponible en la ${s.phase}`}>
        Esta pantalla todavía no está habilitada. Las reglas de la base de datos ya están implementadas y probadas, para que la pantalla se conecte sin cambios de estructura.
      </Alert>
      <Card className="mt-6">
        <h2 className="mb-3 font-display text-lg font-bold text-navy-950">Ya preparado en la base de datos</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px] text-slate-700">
          {s.ready.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </Card>
    </>
  );
}

export const UPCOMING: Record<string, UpcomingSection> = {
  pedidos: {
    eyebrow: 'Logística', title: 'Pedidos de Combustible', phase: 'Fase 2',
    summary: 'Solicitudes de combustible por PAD, calculadas por cantidad de viajes, con envío desde Outlook del usuario.',
    ready: [
      'Volumen solicitado = viajes × 43.000 L, calculado por la base de datos.',
      'Número de pedido correlativo por año (PC-AAAA-NNNNN).',
      'Un pedido no suma stock: solo lo hacen las entregas efectivas.',
      'Solo Logística y Administrador pueden crear y modificar pedidos.',
    ],
  },
  historial: {
    eyebrow: 'Trazabilidad', title: 'Historial de Pedidos', phase: 'Fase 2',
    summary: 'Consulta, filtros y exportación de todos los pedidos, incluidos los cancelados.',
    ready: ['Los pedidos no se pueden borrar; se cancelan con motivo obligatorio.', 'Cada alta y modificación queda en la auditoría.'],
  },
  etapas: {
    eyebrow: 'Operaciones', title: 'Registro de Etapas', phase: 'Fase 2',
    summary: 'Etapas planificadas y realizadas por pozo, con el consumo de cada etapa.',
    ready: [
      'Un único registro de consumo por etapa y pozo (ej.: Pozo CASE-143, Etapa 1, 13.425 L).',
      'No se registra consumo en etapas planificadas o canceladas, ni consumos en cero o negativos.',
      'Una etapa con consumo no puede cancelarse ni cambiar de pozo.',
      'Consumo del PAD = suma de sus pozos; promedio = consumo / etapas realizadas con consumo.',
    ],
  },
  entregas: {
    eyebrow: 'Logística', title: 'Entregas de Combustible', phase: 'Fase 2',
    summary: 'Entregas reales asociadas a cada pedido, con remito y litros recibidos.',
    ready: [
      'Única fuente de ingreso de stock.',
      'No se aceptan entregas sobre pedidos en borrador o cancelados, ni remitos repetidos.',
      'El pedido pasa a “Entregado parcial” o “Entregado” según lo recibido.',
    ],
  },
  inventario: {
    eyebrow: 'Stock', title: 'Inventario y Stock', phase: 'Fase 2',
    summary: 'Stock estimado por PAD y consolidado general, con verificaciones físicas.',
    ready: [
      'Stock estimado = inicial + entregas − consumos − salidas ± ajustes ± transferencias.',
      'Transferencias entre PADs cuando el set se traslada.',
      'La verificación física se guarda aparte y muestra la diferencia con el estimado.',
      'Los movimientos no se borran: las correcciones se hacen con un ajuste con motivo.',
    ],
  },
  reporte: {
    eyebrow: 'Gerencia', title: 'Reporte Gerencial', phase: 'fase de reportes',
    summary: 'Indicadores de consumo, pedidos, entregas y stock para Supervisión y Gerencia.',
    ready: ['Vistas de consumo por pozo y por PAD, y de stock por PAD y consolidado.', 'Supervisión tiene acceso de solo lectura.'],
  },
};
