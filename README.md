# Seguimiento DTM — Feed de datos

Feed JSON con todos los eventos DTM (Desmontaje, Transporte y Montaje) de la app **Seguimiento DTM** de PAN AMERICAN ENERGY.
Se actualiza automáticamente cada hora (solo cuando hay cambios).

## URL del feed

```
https://raw.githubusercontent.com/seguimiento-dtm/app/main/dtm.json
```

Lectura directa por HTTP GET, sin autenticación. Formato JSON (UTF-8), esquema `seguimiento-dtm-feed/1`.
Fechas en ISO 8601, hora de Argentina (UTC−03:00).

## Formato

| Campo | Descripción |
|---|---|
| `esquema` | Versión del formato: `seguimiento-dtm-feed/1`. |
| `generado` | Fecha y hora de la última actualización del feed. |
| `cantidad_eventos` | Cantidad de eventos incluidos. |
| `eventos[]` | Un elemento por evento DTM. |
| `eventos[].id` | Identificador único y estable del evento. |
| `equipo`, `contratista`, `origen`, `destino`, `km` | Datos generales del evento. |
| `inicio`, `hora_inicio_definida` | Inicio del día 1. Cada día operativo dura 24 h desde esa hora (si la hora no está definida se toma 00:00). |
| `dias_plan`, `dias_evento` | Días planificados y días totales registrados (incluye días agregados). |
| `estado` | `sin_iniciar`, `en_ejecucion` o `cerrado`. |
| `cierre` | Fecha y hora de cierre del DTM, o `null`. |
| `tiempos` | Tiempos finales (solo si está cerrado): `total_horas`, `total_dias`, `npt_horas`, `neto_horas`, `neto_dias`, `plan_dias`, `diferencia_total_dias`, `diferencia_neto_dias`. |
| `avance_real_pct` | Avance real del evento (promedio del avance de las tareas, 0 a 100). |
| `tareas_total`, `tareas_completas`, `npt_total_horas` | Totales del evento. |
| `curva_diaria[]` | Por día: `dia`, `inicio_dia`, `plan_pct`, `real_pct` (acumulados), `npt_horas`, `novedades`. |
| `tareas[]` | Por tarea: `id`, `nombre`, `tipo` (`critica`/`paralela`), `fase`, `dia_plan`, `avance_pct`, `dia_inicio_real`, `dia_fin_real`, `desvio_dias` (fin real − día plan), `avance_por_dia` (día → % acumulado), `observaciones`. |
| `npt[]` | Registros de NPT: `dia`, `desde`, `hasta`, `horas`, `detalle`. |
| `actualizado` | Última modificación del evento en la app. |

Usar `eventos[].id` y `tareas[].id` como claves para actualizar registros sin duplicarlos.

## Contenido del repositorio

- `dtm.json` — el feed.
- `feed/build_feed.py` — script que genera el feed a partir de la base de la app.
- `Seguimiento DTM.html` — copia de la app.

---
Creado por: **PÉREZ, Marcelo Damián** - Supervisor de DTM D&C - PAN AMERICAN ENERGY
