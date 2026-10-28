-- Pruebas del importador del maestro (continúa los datos de PRUEBA anteriores).

-- ------------------------------------------------------------ solo administrador
select tests.login('log@prueba.test');
set role authenticated;
select tests.throws($$select public.import_master('x.xlsx', 'Hoja1', '[{"row":2,"pad_code":"X"}]', true)$$, 'Solo un administrador', 'solo el administrador importa');
select tests.ok((select count(*) = 0 from public.import_logs), 'logística no ve el registro de importaciones');
reset role;

select tests.login('admin@prueba.test');
set role authenticated;
select tests.throws($$select public.import_master('x.xlsx', '', '[]', true)$$, 'no tiene filas', 'archivo sin filas: se detiene');
select tests.throws($$select public.import_master('x.xlsx', '', '{"a":1}', true)$$, 'formato esperado', 'estructura no interpretable: se detiene');

-- ------------------------------------------------------------ archivo de prueba con casos
create temp table caso as select $json$[
  {"row": 2,  "pad_code": "PRUEBA-IMP-1", "pad_name": "PAD importado 1", "well_code": "PRUEBA-IMP-W1", "well_name": "Pozo importado 1", "planned_stages": "18", "operational_status": "En completación"},
  {"row": 3,  "pad_code": "PRUEBA-IMP-1", "pad_name": "PAD importado 1", "well_code": "PRUEBA-IMP-W2", "planned_stages": 20},
  {"row": 4,  "pad_code": "PRUEBA-IMP-1", "pad_name": "PAD importado 1", "well_code": "PRUEBA-IMP-W2", "planned_stages": 20},
  {"row": 5,  "pad_code": "", "well_code": "Falla1"},
  {"row": 6,  "pad_code": "PRUEBA-IMP-2", "well_code": "PRUEBA-IMP-W1"},
  {"row": 7,  "pad_code": "PRUEBA-IMP-1", "well_code": "PRUEBA-IMP-W3", "planned_stages": "veinte"},
  {"row": 8,  "pad_code": "PRUEBA-PAD-A", "well_code": "PRUEBA-POZO-1", "planned_stages": "25"},
  {"row": 9,  "pad_code": "PRUEBA-PAD-B", "well_code": "LA-750(h)"},
  {"row": 10, "pad_code": "PRUEBA-IMP-3"},
  {"row": 11, "pad_code": "PRUEBA-PAD-B", "pad_name": "PAD de prueba B (reactivado)"}
]$json$::jsonb as j;
grant select on caso to authenticated;

create temp table antes as
  select (select count(*) from public.fracture_stages) st, (select count(*) from public.fuel_consumption) co, (select count(*) from public.fuel_orders) od,
         (select count(*) from public.fuel_deliveries) de, (select count(*) from public.inventory_movements) mv, (select count(*) from public.pads) pa, (select count(*) from public.wells) we;
grant select on antes to authenticated;

create temp table r1 as select public.import_master('maestro_prueba.xlsx', 'Hoja1', (select j from caso), true) as r;
grant select on r1 to authenticated;
select tests.ok((select (select count(*) from public.pads) = pa and (select count(*) from public.wells) = we from antes), 'la vista previa no modifica nada');
select tests.ok((select count(*) = 0 from public.import_logs), 'la vista previa no registra importación');
select tests.ok((select (r -> 'summary' ->> 'duplicates')::int = 1 from r1), 'detecta la fila repetida');
select tests.ok((select x ->> 'status' = 'duplicado' and x ->> 'message' like '%fila 3%' from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int = 4), 'informa con qué fila se repite');
select tests.ok((select x ->> 'status' = 'error' and x ->> 'message' like 'Falta el código del PAD%' from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int = 5), 'fila sin PAD: error con número de fila');
select tests.ok((select count(*) = 2 from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int in (2, 6) and x ->> 'message' like '%más de un PAD%'), 'pozo en dos PADs dentro del archivo: error en ambas filas');
select tests.ok((select x ->> 'message' like 'Etapas planificadas inválidas%' from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int = 7), 'etapas no numéricas: error');
select tests.ok((select x ->> 'status' = 'actualiza' from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int = 8), 'pozo existente identificado por código: actualización');
select tests.ok((select x ->> 'message' like '%ya existe en el PAD LA-WP130%' from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int = 9), 'un pozo no cambia de PAD por importación');
select tests.ok((select x ->> 'status' = 'nuevo' from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int = 10), 'fila solo con PAD: alta del PAD');
select tests.ok((select x ->> 'status' = 'actualiza' from r1, jsonb_array_elements(r -> 'rows') x where (x ->> 'row')::int = 11), 'PAD inactivo informado: se reactiva y actualiza');

-- ------------------------------------------------------------ importación confirmada
create temp table r2 as select public.import_master('maestro_prueba.xlsx', 'Hoja1', (select j from caso), false) as r;
grant select on r2 to authenticated;
select tests.ok((select (r -> 'summary' ->> 'pads_created')::int = 2 and (r -> 'summary' ->> 'wells_created')::int = 1
  and (r -> 'summary' ->> 'wells_updated')::int = 1 and (r -> 'summary' ->> 'pads_updated')::int = 1 and (r -> 'summary' ->> 'errors')::int = 5 from r2), 'resumen de altas, actualizaciones y errores');
select tests.ok((select p.code = 'PRUEBA-IMP-1' and p.name = 'PAD importado 1' and w.planned_stages = 20 from public.wells w join public.pads p on p.id = w.pad_id where w.code = 'PRUEBA-IMP-W2'),
  'los códigos de PAD y pozo mantienen su relación');
select tests.ok((select count(*) = 0 from public.wells where code in ('PRUEBA-IMP-W1', 'PRUEBA-IMP-W3')), 'las filas con error no se importan');
select tests.ok((select planned_stages = 25 and pad_id = (select id from public.pads where code = 'PRUEBA-PAD-A') from public.wells where code = 'PRUEBA-POZO-1'), 'actualiza datos maestros sin mover el pozo');
select tests.ok((select active and name = 'PAD de prueba B (reactivado)' from public.pads where code = 'PRUEBA-PAD-B'), 'reactiva el PAD informado');
select tests.ok((select (select count(*) from public.fracture_stages) = st and (select count(*) from public.fuel_consumption) = co and (select count(*) from public.fuel_orders) = od
  and (select count(*) from public.fuel_deliveries) = de and (select count(*) from public.inventory_movements) = mv from antes), 'etapas, consumos, pedidos, entregas e inventario intactos');
select tests.ok((select l.file_name = 'maestro_prueba.xlsx' and l.sheet_name = 'Hoja1' and l.rows_processed = 10 and l.errors = 5 and l.pads_created = 2
  and l.imported_by = auth.uid() and jsonb_array_length(l.error_rows) = 5 from public.import_logs l), 'registro de la importación: usuario, archivo, filas, altas y errores');
select tests.ok((select count(*) = 1 from public.audit_logs where table_name = 'pads' and action = 'insert' and new_data ->> 'code' = 'PRUEBA-IMP-1' and changed_by = auth.uid()), 'las altas quedan en la auditoría');

-- Segunda importación del mismo archivo: no duplica.
create temp table r3 as select public.import_master('maestro_prueba.xlsx', 'Hoja1', (select j from caso), false) as r;
grant select on r3 to authenticated;
select tests.ok((select (r -> 'summary' ->> 'pads_created')::int = 0 and (r -> 'summary' ->> 'wells_created')::int = 0
  and (r -> 'summary' ->> 'wells_updated')::int = 0 and (r -> 'summary' ->> 'pads_updated')::int = 0 from r3), 'reimportar el mismo archivo no crea ni cambia nada');
select tests.ok((select count(*) = 1 from public.pads where lower(code) = 'prueba-imp-1'), 'sin PADs duplicados');
reset role;

-- ------------------------------------------------------------ Excel maestro real (datos/WP_por_Pozos.xlsx)
create temp table excel as select pg_read_file(:'excel_rows_file')::jsonb as j;
grant select on excel to authenticated;
select tests.login('admin@prueba.test');
set role authenticated;
create temp table real as select public.import_master('WP_por_Pozos.xlsx', 'Cronograma', (select j from excel), true) as r;
grant select on real to authenticated;
reset role;
select tests.ok((select (r -> 'summary' ->> 'rows_processed')::int = 1273 and (r -> 'summary' ->> 'errors')::int = 41
  and (r -> 'summary' ->> 'pads_created')::int = 0 and (r -> 'summary' ->> 'wells_created')::int = 0 and (r -> 'summary' ->> 'wells_updated')::int = 0
  and (r -> 'summary' ->> 'duplicates')::int = 1273 - 41 - 227 from real),
  'Excel real: 1.273 filas, 41 sin PAD, ningún alta nueva (ya cargado)');
select tests.ok((select (r -> 'summary' ->> 'unchanged')::int = 227 from real), 'Excel real: 227 pozos sin cambios');
