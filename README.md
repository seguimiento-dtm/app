# Seguimiento DTM y Rastreo DTM

Dos aplicaciones web de un solo archivo (se abren directo en el navegador, sin instalar nada):

| Archivo | Para qué sirve |
|---|---|
| `Seguimiento DTM.html` | Seguimiento diario del DTM (Desmontaje, Transporte y Montaje): tareas, avance, NPT y reporte ejecutivo. |
| `Rastreo DTM.html` | Rastreo de las cargas del equipo en tránsito: origen, destino, ruta de la compañía de torre, viajes por camión y alertas. |

## Rastreo DTM (fase 1, prototipo sin servidor)

- **Mapa en vivo** con imagen satelital o mapa de calles, origen (O), destino (D), radio de llegada y la ruta establecida.
- **Ubicación del origen y del destino**: clic en el mapa, coordenadas o link de Google Maps pegados, o un archivo KML/KMZ (se toma el punto con el mismo nombre que la locación).
- **Ruta de la compañía de torre**: dibujada en el mapa o importada desde KML, KMZ, GPX o GeoJSON.
- **Cargas** (lista típica de un equipo, editable) con viajes de plan y día previsto; **camiones** con patente, transportista y chofer.
- **Viajes**: la salida y la llegada se detectan solas cuando el camión sale del radio del origen y entra en el del destino.
- **Alertas**: desvío de la ruta mayor a la tolerancia (500 m por defecto), camión detenido más de 30 minutos fuera de las locaciones, y camión sin señal.
- **Fuentes de posición** (hasta integrar el GPS propio de PAE en la fase 2):
  - simulador (para probar, con velocidad x1 a x300, desvío y detención simulados);
  - GPS del celular del chofer («Usar mi GPS»);
  - CSV exportado del portal de rastreo, con columnas patente/dominio, fecha y hora, latitud y longitud;
  - registro manual de salida, posición y llegada.

## Vínculo entre las dos apps

Cada viaje cuenta en el **día de plan de su llegada**, según la fecha y hora de inicio del DTM.

- **Mismo navegador**: si las dos apps se abren en el mismo navegador y desde la misma ubicación, Rastreo DTM toma la fecha, la hora y los días del DTM elegido al crear el traslado. Seguimiento DTM muestra los viajes en cada día solo, sin pasos extra.
- **Distinto navegador, equipo o usuario**: en Rastreo DTM, pestaña *Viajes por día de plan*, botón **Descargar archivo de viajes**. En Seguimiento DTM, botón **Importar viajes**. El DTM se identifica por el mismo equipo y la misma fecha de inicio.

En Seguimiento DTM los viajes aparecen así:

- en la tira de días;
- en los indicadores del día («Viajes realizados del día»);
- en la sección **Viajes del día (Rastreo DTM)**;
- en el resumen del reporte ejecutivo.
