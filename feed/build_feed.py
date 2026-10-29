#!/usr/bin/env python3
"""Arma el feed JSON de Seguimiento DTM a partir de los documentos de la colección "dtm".
Uso: python3 -I build_feed.py <carpeta_con_json_de_dtm> <salida.json>"""
import json, sys, os, glob, datetime as dt
TZ = dt.timezone(dt.timedelta(hours=-3))  # America/Buenos_Aires
TIPOS = {"C": "critica", "P": "paralela"}

def hm(t):
    try:
        h, m = str(t).split(":")[:2]; return int(h) * 60 + int(m)
    except Exception:
        return None

def num(v, d=0.0):
    try: return float(str(v).replace(",", "."))
    except Exception: return d

def log_days(t):
    return sorted(int(k) for k in (t.get("log") or {}) if str(k).isdigit())

def val_at(t, D):
    v = 0
    for k in log_days(t):
        if k <= D: v = max(0, min(100, num(t["log"][str(k)])))
    return v

def start_day(t):
    for k in log_days(t):
        if num(t["log"][str(k)]) > 0: return k
    return None

def end_day(t):
    for k in log_days(t):
        if num(t["log"][str(k)]) >= 100: return k
    return None

def iso(x): return x.isoformat(timespec="minutes") if x else None

def build_event(d):
    sm = (hm(d.get("horaInicio") or "00:00") or 0) % 1440
    try:
        y, mo, da = map(int, d["fechaInicio"].split("-"))
        ini = dt.datetime(y, mo, da, sm // 60, sm % 60, tzinfo=TZ)
    except Exception:
        ini = None
    tareas = d.get("tareas") or []
    n_dias = max([int(num(d.get("dias"), 1))] + [t.get("dia", 1) for t in tareas] + [k for t in tareas for k in log_days(t)])
    def day_start(i): return ini + dt.timedelta(days=i - 1) if ini else None
    # NPT: horas relativas al día operativo (empieza a la hora de inicio del DTM)
    npt = []
    for k, items in sorted((d.get("npt") or {}).items(), key=lambda kv: int(kv[0])):
        D = int(k)
        for it in items or []:
            a, b = hm(it.get("desde")), hm(it.get("hasta"))
            if a is None or b is None: continue
            oa, ob = (a - sm) % 1440, (b - sm) % 1440
            if ob == 0: ob = 1440
            if ob <= oa: continue
            s = day_start(D) + dt.timedelta(minutes=oa) if ini else None
            e = day_start(D) + dt.timedelta(minutes=ob) if ini else None
            npt.append({"dia": D, "desde": iso(s), "hasta": iso(e), "horas": round((ob - oa) / 60, 2), "detalle": it.get("detalle", "")})
    npt_total = round(sum(x["horas"] for x in npt), 2)
    # cierre y tiempos
    c = d.get("cierre") or {}
    fin = None
    if c.get("fecha"):
        try:
            y, mo, da = map(int, c["fecha"].split("-")); m = hm(c.get("hora") or "00:00") or 0
            fin = dt.datetime(y, mo, da, m // 60, m % 60, tzinfo=TZ)
        except Exception:
            fin = None
    tiempos = None
    if fin and ini:
        total = (fin - ini).total_seconds() / 3600
        npt_h = 0.0
        for x in npt:
            s, e = dt.datetime.fromisoformat(x["desde"]), dt.datetime.fromisoformat(x["hasta"])
            ov = (min(e, fin) - max(s, ini)).total_seconds() / 3600
            if ov > 0: npt_h += ov
        plan_h = num(d.get("dias")) * 24
        tiempos = {"total_horas": round(total, 2), "total_dias": round(total / 24, 2),
                   "npt_horas": round(npt_h, 2), "neto_horas": round(total - npt_h, 2), "neto_dias": round((total - npt_h) / 24, 2),
                   "plan_dias": num(d.get("dias")), "diferencia_total_dias": round((total - plan_h) / 24, 2),
                   "diferencia_neto_dias": round((total - npt_h - plan_h) / 24, 2)}
    T = len(tareas) or 1
    avance = round(sum(val_at(t, 10**6) for t in tareas) / T, 1)
    curva = []
    acum_plan = 0
    for i in range(1, n_dias + 1):
        acum_plan += sum(1 for t in tareas if t.get("dia") == i)
        curva.append({"dia": i, "inicio_dia": iso(day_start(i)), "plan_pct": round(acum_plan / T * 100, 1),
                      "real_pct": round(sum(val_at(t, i) for t in tareas) / T, 1),
                      "npt_horas": round(sum(x["horas"] for x in npt if x["dia"] == i), 2),
                      "novedades": (d.get("notas") or {}).get(str(i), "")})
    has_prog = any(num(v) > 0 for t in tareas for v in (t.get("log") or {}).values())
    estado = "cerrado" if fin else ("en_ejecucion" if has_prog else "sin_iniciar")
    return {
        "id": d.get("id"), "equipo": d.get("equipo", ""), "contratista": d.get("contratista", ""),
        "origen": d.get("origen", ""), "destino": d.get("destino", ""), "km": num(d.get("km")) if d.get("km") not in (None, "") else None,
        "inicio": iso(ini), "hora_inicio_definida": bool(d.get("horaInicio")), "dias_plan": num(d.get("dias")), "dias_evento": n_dias,
        "estado": estado, "cierre": iso(fin), "avance_real_pct": avance,
        "tareas_total": len(tareas), "tareas_completas": sum(1 for t in tareas if end_day(t)),
        "npt_total_horas": npt_total, "tiempos": tiempos, "curva_diaria": curva,
        "tareas": [{"id": t.get("id"), "nombre": t.get("nombre", ""), "tipo": TIPOS.get(t.get("tipo"), t.get("tipo")),
                    "fase": t.get("fase", ""), "dia_plan": t.get("dia"), "avance_pct": val_at(t, 10**6),
                    "dia_inicio_real": start_day(t), "dia_fin_real": end_day(t),
                    "desvio_dias": (end_day(t) - t["dia"]) if end_day(t) and t.get("dia") else None,
                    "avance_por_dia": {str(k): num(t["log"][str(k)]) for k in log_days(t)}, "observaciones": t.get("obs", "")} for t in tareas],
        "npt": npt,
        "actualizado": iso(dt.datetime.fromtimestamp(d["actualizado"] / 1000, TZ)) if d.get("actualizado") else None,
    }

def main(src, out):
    docs = []
    for f in sorted(glob.glob(os.path.join(src, "**", "*.json"), recursive=True)):
        try:
            x = json.load(open(f, encoding="utf-8"))
            x = x.get("data", x) if isinstance(x, dict) else x
            if isinstance(x, dict) and "tareas" in x: docs.append(x)
        except Exception as e:
            print("omitido", f, e, file=sys.stderr)
    evs = sorted((build_event(d) for d in docs), key=lambda e: (e["equipo"], e["inicio"] or ""))
    feed = {"fuente": "Seguimiento DTM - PAN AMERICAN ENERGY", "esquema": "seguimiento-dtm-feed/1",
            "generado": iso(dt.datetime.now(TZ)), "zona_horaria": "America/Buenos_Aires (UTC-03:00)",
            "cantidad_eventos": len(evs), "eventos": evs}
    json.dump(feed, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("eventos:", len(evs), "->", out)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
