'use strict';
/* Asesor · FG Agro — lógica sin pantalla (visitas, tratamientos, planes y cobros, enlace con los maestros,
   importación de las apps antiguas y tablas para Google Sheets). Sin datos dentro y sin DOM: se prueba con Node. */
(function (root) {
  const MX = root.MX || (typeof require !== 'undefined' ? require('./maestros.js') : null);
  const norm = (s) => MX.norm(s);

  /* ---------- fechas ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const hoyISO = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const aUTC = (t) => { const p = String(t).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
  const diffDias = (a, b) => Math.round((aUTC(a) - aUTC(b)) / 86400000);
  function sumarDias(t, n) {
    const d = new Date(aUTC(t) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  const fmtFecha = (t) => { if (!t) return ''; const p = String(t).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  const fechaDesdeES = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + pad(m[2]) + '-' + pad(m[1]) : (/^\d{4}-\d{2}-\d{2}/.test(String(s)) ? String(s).slice(0, 10) : ''); };

  /* ---------- planes y cobros (misma lógica que la app Clientes) ---------- */
  const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MC = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const ESTADOS = ['E', 'N', 'A'];
  const ESTADO_TXT = { E: 'Enviado', N: 'No enviado', A: 'No aplica' };
  const ym = (y, m) => y + '-' + pad(m + 1);
  const enRango = (c, y, m) => { const k = ym(y, m); return (!c.alta || k >= c.alta) && (!c.baja || k <= c.baja); };
  const cmpNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });

  function filas(st, y) {
    const t = (st.años || {})[y] || {};
    return st.clientes.filter((c) => t[c.id]).sort(cmpNombre).map((c) => ({ c, r: t[c.id] }));
  }
  const filasPlanes = (st, y, m) => filas(st, y).filter((x) => x.r.planes > 0 && enRango(x.c, y, m));
  function statsPlanes(st, y, m) {
    let planes = 0, env = 0, den = 0;
    const L = filasPlanes(st, y, m);
    L.forEach((x) => {
      planes += x.r.planes;
      const s = x.r.env[m];
      if (s === 'E') { env += x.r.planes; den += x.r.planes; } else if (s === 'N') den += x.r.planes;
    });
    return { clientes: L.length, planes, enviados: env, base: den, pct: den ? env / den : null };
  }
  const transcurridos = (y, hoy) => (y < hoy.y ? 12 : y > hoy.y ? 0 : hoy.m + 1);
  function statsCobros(st, y, m, hoy) {
    let cobradoAnio = 0, pendiente = 0, cobradoMes = 0, pendienteMes = 0;
    filas(st, y).forEach((x) => {
      for (let i = 0; i < 12; i++) {
        const imp = Number(x.r.imp[i]) || 0;
        if (x.r.cob[i]) { cobradoAnio += imp; if (i === m) cobradoMes += imp; }
        else if (enRango(x.c, y, i)) { pendiente += imp; if (i === m) pendienteMes += imp; }
      }
    });
    const n = transcurridos(y, hoy);
    return { cobradoAnio, media: n ? cobradoAnio / n : 0, cobradoMes, pendienteMes, pendiente };
  }
  function cambiarPrecio(st, id, y, nuevo, hoy) {
    const r = (st.años[y] || {})[id]; if (!r) return;
    const desde = y < hoy.y ? 12 : y > hoy.y ? 0 : hoy.m;
    r.precio = nuevo;
    for (let i = desde; i < 12; i++) if (!r.cob[i] && !r.man[i]) r.imp[i] = nuevo;
  }
  function nuevaFila(planes, precio) {
    const f = { planes, precio, env: [], imp: [], cob: [], man: [] };
    for (let i = 0; i < 12; i++) { f.imp.push(precio); f.cob.push(false); f.man.push(false); f.env.push('N'); }
    return f;
  }
  function crearAnio(st, y) {
    if (st.años[y]) return false;
    const prev = Object.keys(st.años).map(Number).filter((a) => a < y).sort((a, b) => a - b).pop();
    const t = {};
    if (prev != null) st.clientes.forEach((c) => {
      const r = st.años[prev][c.id]; if (!r) return;
      if (c.baja && c.baja < ym(y, 0)) return;
      t[c.id] = nuevaFila(r.planes, r.precio);
    });
    st.años[y] = t;
    return true;
  }

  /* ---------- frecuencia de visita ---------- */
  const DIAS_DEFECTO = { 1: 60, 2: 60, 3: 30, 4: 30, 5: 30, 6: 30, 7: 30, 8: 30, 9: 30, 10: 30, 11: 60, 12: 60 };
  function frecuencia(st, fecha) {
    const m = Number(String(fecha).slice(5, 7));
    const n = Number(((st.ajustes || {}).dias || {})[m] || DIAS_DEFECTO[m]);
    return n > 0 ? n : 30;
  }

  /* ---------- tratamientos: orden de mezcla ---------- */
  const FORM_TYPES = [
    { v: 'ph', label: 'Regulador de pH', badge: 'pH', order: 0 },
    { v: 'fert', label: 'Fertilizante / corrector', badge: 'FERT', order: 1 },
    { v: 'wp', label: 'Polvo mojable / granulado dispersable', badge: 'WP/WG', order: 2 },
    { v: 'sc', label: 'Suspensión concentrada', badge: 'SC', order: 3 },
    { v: 'otro', label: 'Otro', badge: '—', order: 3.5 },
    { v: 'sl', label: 'Soluble concentrado', badge: 'SL', order: 4 },
    { v: 'ec', label: 'Concentrado emulsionable', badge: 'EC', order: 5 },
    { v: 'ady', label: 'Adyuvante / coadyuvante', badge: 'ADY', order: 6 },
  ];
  const UNIDADES = ['L', 'kg', 'g', 'ml'];
  const formInfo = (v) => FORM_TYPES.find((t) => t.v === v) || FORM_TYPES[4];
  const unidad = (u) => (norm(u) === 'kg' ? 'kg' : UNIDADES.find((x) => norm(x) === norm(u)) || (u ? String(u) : 'L'));
  const ordenMezcla = (prods) => (prods || []).filter((p) => p && String(p.nombre || '').trim())
    .map((p, i) => ({ p, i })).sort((a, b) => formInfo(a.p.tipo).order - formInfo(b.p.tipo).order || a.i - b.i).map((x) => x.p);
  const dosisTxt = (p) => (String(p.dv || '').trim() ? String(p.dv).trim() + ' ' + unidad(p.du) : '');

  /* ---------- plagas ---------- */
  const NIVELES = ['', 'leve', 'media', 'alta'];
  function parsePlagas(texto) {
    const out = {};
    String(texto || '').split(',').forEach((x) => {
      const m = /^\s*(.*?)\s*(?:\((leve|media|alta)\))?\s*$/i.exec(x);
      const n = m && m[1].replace(/[()]/g, '').trim();
      if (n) out[n] = (m[2] || 'leve').toLowerCase();
    });
    return out;
  }
  const textoPlagas = (mapa) => Object.keys(mapa || {}).filter((n) => mapa[n]).map((n) => n + ' (' + mapa[n] + ')').join(', ');

  /* ---------- estado ---------- */
  function vacio() {
    return {
      v: 1, clientes: [], fincasNuevas: [], cultivosExtra: {}, visitas: [], trat: [], plantillas: [], productos: [],
      plagas: [], fenologias: [], cultivos: ['Limonero', 'Naranjo', 'Pomelo', 'Mandarino', 'Almendro', 'Albaricoquero', 'Melocotonero', 'Nectarino', 'Paraguayo', 'Olivo', 'Otro'],
      años: {}, ajustes: { marca: 'FG Agro', dias: { ...DIAS_DEFECTO } }, mxPend: [], importes: {},
    };
  }
  function migrar(s) {
    const b = vacio();
    if (!s || typeof s !== 'object') return b;
    const st = { ...b, ...s };
    st.ajustes = { ...b.ajustes, ...(s.ajustes || {}) };
    st.ajustes.dias = { ...DIAS_DEFECTO, ...((s.ajustes || {}).dias || {}) };
    for (const k of ['clientes', 'fincasNuevas', 'visitas', 'trat', 'plantillas', 'productos', 'plagas', 'fenologias', 'cultivos', 'mxPend']) if (!Array.isArray(st[k])) st[k] = b[k];
    for (const k of ['cultivosExtra', 'años', 'importes']) if (!st[k] || typeof st[k] !== 'object') st[k] = {};
    st.v = 1;
    return st;
  }
  const valido = (s) => !!(s && Array.isArray(s.clientes) && Array.isArray(s.visitas) && Array.isArray(s.trat) && s.años);

  /* ---------- listas ---------- */
  const uniq = (xs) => { const v = new Set(), o = []; for (const x of xs) { const t = String(x || '').trim(); const k = norm(t); if (t && !v.has(k)) { v.add(k); o.push(t); } } return o; };
  const limpiar = (n) => String(n || '').replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
  function altaPlaga(st, nombre) {
    nombre = limpiar(nombre); if (!nombre) return null;
    let p = st.plagas.find((x) => norm(x.nombre) === norm(nombre));
    if (!p) { p = { nombre, usos: {} }; st.plagas.push(p); }
    return p;
  }
  function altaFen(st, nombre) {
    nombre = limpiar(nombre); if (!nombre) return null;
    let f = st.fenologias.find((x) => norm(x.nombre) === norm(nombre));
    if (!f) { f = { nombre, usos: 0 }; st.fenologias.push(f); }
    return f;
  }
  function ordenPlagas(st, cultivo) {
    const tot = (p) => Object.values(p.usos || {}).reduce((a, b) => a + b, 0);
    return st.plagas.slice().sort((a, b) => ((b.usos || {})[cultivo] || 0) - ((a.usos || {})[cultivo] || 0) || tot(b) - tot(a) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  /* ---------- clientes y fincas ---------- */
  const cliente = (st, id) => st.clientes.find((c) => c.id === id) || null;
  const delAsesor = (st) => st.clientes.filter((c) => c.ases).sort(cmpNombre);
  const esAsesoria = (m) => (m.servicios || []).some((s) => norm(s).startsWith('asesor'));

  /* Fincas de un cliente: las del maestro (con los cultivos añadidos aquí) y las nuevas pendientes de alta. */
  function fincasDe(st, ix, cliId) {
    const c = cliente(st, cliId); if (!c) return [];
    const out = [];
    if (c.mid && ix) for (const f of ix.fin.values()) if (f.clienteId === c.mid) {
      out.push({ id: f.id, mid: f.id, cli: c.id, nombre: f.nombre, cultivos: uniq([...(f.cultivos || []), ...(st.cultivosExtra[f.id] || [])]), propia: !!f.propia, ha: f.ha });
    }
    for (const f of st.fincasNuevas) if (f.cli === c.id) out.push({ id: f.id, mid: null, cli: c.id, nombre: f.nombre, cultivos: uniq(f.cultivos || []), nueva: true });
    return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
  function finca(st, ix, finId) {
    if (!finId) return null;
    const nv = st.fincasNuevas.find((f) => f.id === finId);
    if (nv) return { id: nv.id, mid: null, cli: nv.cli, nombre: nv.nombre, cultivos: uniq(nv.cultivos || []), nueva: true };
    const f = ix && ix.fin.get(finId);
    if (!f) return null;
    const c = st.clientes.find((x) => x.mid && x.mid === f.clienteId);
    return { id: f.id, mid: f.id, cli: c ? c.id : null, nombre: f.nombre, cultivos: uniq([...(f.cultivos || []), ...(st.cultivosExtra[f.id] || [])]), propia: !!f.propia };
  }
  function ultimaVisita(st, finId) {
    let u = null, v0 = null;
    for (const v of st.visitas) if (v.fin === finId && (!u || v.fecha > u)) { u = v.fecha; v0 = v; }
    return v0;
  }
  function estadoFinca(st, finId, hoy) {
    const frec = frecuencia(st, hoy);
    const u = ultimaVisita(st, finId);
    if (!u) return { dias: null, toca: true, texto: 'Sin visitas', frec, ultima: null };
    const d = diffDias(hoy, u.fecha);
    return { dias: d, toca: d > frec, texto: d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días', frec, ultima: u };
  }
  const activo = (c, hoy) => !c.baja || c.baja >= String(hoy).slice(0, 7);
  /* Fincas de los clientes de Asesor (activos), con su estado de visita; las que más tiempo llevan sin visita primero. */
  function fincasEstado(st, ix, hoy) {
    const out = [];
    for (const c of delAsesor(st)) {
      if (!activo(c, hoy)) continue;
      for (const f of fincasDe(st, ix, c.id)) out.push({ f, c, e: estadoFinca(st, f.id, hoy) });
    }
    out.sort((a, b) => (b.e.dias == null ? 1e9 : b.e.dias) - (a.e.dias == null ? 1e9 : a.e.dias) || a.c.nombre.localeCompare(b.c.nombre, 'es') || a.f.nombre.localeCompare(b.f.nombre, 'es'));
    return out;
  }
  const seguimientos = (st, cliId) => st.visitas.filter((v) => v.accion && !v.hecho && (!cliId || v.cli === cliId))
    .sort((a, b) => (a.seg || a.fecha || '9999').localeCompare(b.seg || b.fecha || '9999') || (a.fecha || '').localeCompare(b.fecha || ''));
  const recientes = (xs) => xs.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.ts || 0) - (a.ts || 0));

  /* ---------- enlace con los maestros ---------- */
  function buscarFincaCli(st, ix, cliId, nombre) {
    const k = norm(nombre); if (!k) return null;
    const c = cliente(st, cliId);
    if (c && c.mid && ix) { const f = MX.buscarFinca(ix, nombre, (x) => x.clienteId === c.mid); if (f) return f.id; }
    const nv = st.fincasNuevas.find((f) => f.cli === cliId && norm(f.nombre) === k);
    return nv ? nv.id : null;
  }
  /* Une el cliente «de» en «a»: visitas, tratamientos, fincas nuevas y filas de planes y cobros. */
  /* Años en que los dos clientes tienen fila de planes y cobros (unirlos perdería datos) */
  const choqueAnios = (st, de, a) => Object.keys(st.años).filter((y) => st.años[y][de] && st.años[y][a]);
  function unirCliente(st, de, a) {
    if (de === a) return;
    const cd = cliente(st, de), ca = cliente(st, a); if (!cd || !ca) return;
    const ch = choqueAnios(st, de, a);
    if (ch.length) throw new Error(cd.nombre + ' y ' + ca.nombre + ' tienen los dos planes y cobros en ' + ch.join(', ') + ': quita uno de ellos antes de unirlos');
    st.visitas.forEach((v) => { if (v.cli === de) v.cli = a; });
    st.trat.forEach((t) => { if (t.cli === de) t.cli = a; });
    st.fincasNuevas.forEach((f) => { if (f.cli === de) f.cli = a; });
    for (const y of Object.keys(st.años)) {
      const t = st.años[y];
      if (t[de] && !t[a]) t[a] = t[de];
      delete t[de];
    }
    if (!ca.alta || (cd.alta && cd.alta < ca.alta)) ca.alta = cd.alta || ca.alta;
    if (cd.ases) ca.ases = true;
    st.mxPend = st.mxPend.filter((p) => !(p.tipo === 'cliente' && p.ref === de));
    st.clientes = st.clientes.filter((c) => c.id !== de);
  }
  /* Cambia el identificador de una finca (local → ID del maestro) en todo lo anotado. */
  function cambiarFinca(st, de, a, nombre) {
    st.visitas.forEach((v) => { if (v.fin === de) { v.fin = a; if (nombre) v.finNom = nombre; } });
    st.trat.forEach((t) => { if (t.fin === de) { t.fin = a; if (nombre) t.finNom = nombre; } });
    const nv = st.fincasNuevas.find((f) => f.id === de);
    if (nv) {
      st.cultivosExtra[a] = uniq([...(st.cultivosExtra[a] || []), ...(nv.cultivos || [])]);
      st.fincasNuevas = st.fincasNuevas.filter((f) => f.id !== de);
    }
    st.mxPend = st.mxPend.filter((p) => !(p.tipo === 'finca' && p.ref === de));
  }
  /* Pone el estado al día con los maestros recién leídos. Devuelve un resumen de cambios. */
  function aplicarMaestros(st, ix, nuevoId) {
    const r = { renombrados: 0, enlazados: 0, nuevos: 0, unidos: 0, fincas: 0 };
    for (const c of [...st.clientes]) {
      let m = c.mid ? ix.cli.get(c.mid) : null;
      if (!m && !c.mid) {
        m = MX.buscarCliente(ix, c.nombre);
        if (m && !st.mxPend.some((p) => p.tipo === 'cliente' && p.ref === c.id)) { c.mid = m.id; r.enlazados++; }
        else m = null;
      }
      if (m && c.nombre !== m.nombre) { c.nombre = m.nombre; r.renombrados++; }
    }
    // Dos fichas locales con el mismo cliente del maestro: se unen en una
    // (en orden de identificador, para que todos los aparatos unan igual)
    const porMid = new Map();
    for (const c of [...st.clientes].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      if (!c.mid) continue;
      if (porMid.has(c.mid) && !choqueAnios(st, c.id, porMid.get(c.mid)).length) { unirCliente(st, c.id, porMid.get(c.mid)); r.unidos++; } else if (!porMid.has(c.mid)) porMid.set(c.mid, c.id);
    }
    // Clientes del maestro con servicio de asesoría que aún no están: entran en Asesor
    for (const m of ix.cli.values()) {
      if (porMid.has(m.id) || !esAsesoria(m) || MX.deBaja(m)) continue;
      // Identificador fijo a partir del maestro: si dos aparatos lo añaden a la vez, es el mismo registro
      const idFijo = 'cm-' + m.id;
      st.clientes.push({ id: cliente(st, idFijo) ? nuevoId('c') : idFijo, mid: m.id, nombre: m.nombre, ases: true, alta: null, baja: null });
      porMid.set(m.id, true); r.nuevos++;
    }
    // Fincas nuevas que ya están en el maestro (dadas de alta allí a mano o por la cola)
    for (const f of [...st.fincasNuevas]) {
      const c = cliente(st, f.cli);
      if (!c || !c.mid) continue;
      const m = MX.buscarFinca(ix, f.nombre, (x) => x.clienteId === c.mid);
      if (m && !st.mxPend.some((p) => p.tipo === 'finca' && p.ref === f.id)) { cambiarFinca(st, f.id, m.id, m.nombre); r.fincas++; }
    }
    // Cultivos añadidos aquí que el maestro ya tiene: se quitan de la lista local
    for (const fid of Object.keys(st.cultivosExtra)) {
      const m = ix.fin.get(fid);
      if (!m) continue;
      const tiene = new Set((m.cultivos || []).map(norm));
      const quedan = st.cultivosExtra[fid].filter((x) => !tiene.has(norm(x)));
      if (quedan.length) st.cultivosExtra[fid] = quedan; else delete st.cultivosExtra[fid];
    }
    // Nombres de finca guardados en visitas y tratamientos: los del maestro
    for (const v of [...st.visitas, ...st.trat]) { const m = v.fin && ix.fin.get(v.fin); if (m && v.finNom !== m.nombre) v.finNom = m.nombre; }
    // Productos del catálogo sin enlazar que se reconocen en el maestro
    for (const p of st.productos) if (!p.mid) { const m = MX.buscarProducto(ix, p.nombre); if (m) p.mid = m.p.id; }
    return r;
  }

  /* ---------- importar las apps antiguas ---------- */
  function asegurarCliente(st, ix, nombre, nuevoId, res) {
    nombre = String(nombre || '').trim(); if (!nombre) return null;
    const m = ix ? MX.buscarCliente(ix, nombre) : null;
    let c = (m && st.clientes.find((x) => x.mid === m.id)) || st.clientes.find((x) => norm(x.nombre) === norm(nombre));
    if (!c) {
      c = { id: nuevoId('c'), mid: m ? m.id : null, nombre: m ? m.nombre : nombre, ases: true, alta: null, baja: null };
      st.clientes.push(c);
      if (res) { res.clientesNuevos++; if (!m) res.sinEnlazar.add(nombre); }
    } else if (!c.ases) c.ases = true;
    return c;
  }
  function asegurarFinca(st, ix, c, nombre, cultivos, nuevoId, res) {
    nombre = String(nombre || '').trim(); if (!c || !nombre) return null;
    let id = buscarFincaCli(st, ix, c.id, nombre);
    if (!id) {
      id = nuevoId('f');
      st.fincasNuevas.push({ id, cli: c.id, nombre, cultivos: uniq(cultivos || []) });
      if (res) res.fincasNuevas++;
      return id;
    }
    const f = finca(st, ix, id);
    const faltan = uniq(cultivos || []).filter((x) => !(f.cultivos || []).some((y) => norm(y) === norm(x)));
    if (faltan.length) {
      const nv = st.fincasNuevas.find((x) => x.id === id);
      if (nv) nv.cultivos = uniq([...(nv.cultivos || []), ...faltan]);
      else st.cultivosExtra[id] = uniq([...(st.cultivosExtra[id] || []), ...faltan]);
    }
    return id;
  }
  const resVacio = () => ({ clientesNuevos: 0, fincasNuevas: 0, visitas: 0, tratamientos: 0, plantillas: 0, productos: 0, filasAnio: 0, plagas: 0, sinEnlazar: new Set(), saltadas: 0 });

  /* Copia de la app Visitas (visitas-campo): { fincas, visitas, plagas, fenologias, cultivos } */
  function importarVisitas(st, ix, d, nuevoId) {
    const res = resVacio();
    const porFinca = new Map();
    for (const f of d.fincas || []) if (f && f.nombre) porFinca.set(norm(f.nombre), f);
    for (const f of d.fincas || []) {
      if (!f || !f.nombre || !f.cliente) continue;
      const c = asegurarCliente(st, ix, f.cliente, nuevoId, res);
      asegurarFinca(st, ix, c, f.nombre, f.cultivos, nuevoId, res);
    }
    const grupos = new Map();
    for (const v of d.visitas || []) {
      if (!v || !v.id || !v.finca) continue;
      const base = String(v.id).replace(/-\d+$/, '');
      if (!grupos.has(base)) grupos.set(base, []);
      grupos.get(base).push(v);
    }
    const yaIds = new Set(st.visitas.map((v) => v.id));
    for (const [base, rows] of grupos) {
      if (yaIds.has(base)) { res.saltadas++; continue; }
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id), 'es', { numeric: true }));
      const r0 = rows[0];
      const fOld = porFinca.get(norm(r0.finca));
      const c = asegurarCliente(st, ix, r0.cliente || (fOld && fOld.cliente), nuevoId, res);
      if (!c) { res.saltadas++; continue; }
      const cultivosVis = uniq(rows.map((r) => r.cultivo));
      const fin = asegurarFinca(st, ix, c, r0.finca, uniq([...cultivosVis, ...((fOld && fOld.cultivos) || [])]), nuevoId, res);
      const f = finca(st, ix, fin);
      const accion = /https?:\/\/|script\.google\.com/i.test(r0.accion || '') ? '' : String(r0.accion || '').trim();
      st.visitas.push({
        id: base, fecha: fechaDesdeES(r0.fecha) || r0.fecha, cli: c.id, fin, finNom: f ? f.nombre : r0.finca,
        cultivos: rows.map((r) => ({ c: r.cultivo || '', fen: r.fenologia || '', plagas: parsePlagas(r.plagas) })),
        obs: String(rows.map((r) => r.observaciones || '').find(Boolean) || ''), accion, seg: accion ? (fechaDesdeES(r0.seguimiento) || '') : '',
        hecho: !!r0.hecho, fotos: [], fotosAntes: rows.reduce((a, r) => a + (Number(r.nFotos) || 0), 0), ts: Date.now(), origen: 'Visitas',
      });
      yaIds.add(base); res.visitas++;
      for (const r of rows) {
        for (const n of Object.keys(parsePlagas(r.plagas))) { const p = altaPlaga(st, n); p.usos[r.cultivo] = (p.usos[r.cultivo] || 0) + 1; }
        if (r.fenologia) { const fe = altaFen(st, r.fenologia); fe.usos = (fe.usos || 0) + 1; }
      }
    }
    for (const p of d.plagas || []) if (p && p.nombre && !st.plagas.some((x) => norm(x.nombre) === norm(p.nombre))) { st.plagas.push({ nombre: limpiar(p.nombre), usos: { ...(p.usos || {}) } }); res.plagas++; }
    for (const f of d.fenologias || []) if (f && f.nombre) altaFen(st, f.nombre);
    st.cultivos = uniq([...st.cultivos, ...(d.cultivos || [])]);
    return res;
  }

  /* Copia del generador de tratamientos: { catalogoClientes, catalogoProductos, historial, plantillas } */
  const prodDe = (p) => ({ nombre: String(p.nombre || '').trim(), tipo: FORM_TYPES.some((t) => t.v === p.tipo) ? p.tipo : 'otro', dv: String(p.dosisValor != null ? p.dosisValor : (p.dv || '')).trim(), du: unidad(p.dosisUnidad || p.du) });
  function asegurarProducto(st, ix, nombre, tipo, nuevoId, res) {
    nombre = String(nombre || '').trim(); if (!nombre) return null;
    let p = st.productos.find((x) => norm(x.nombre) === norm(nombre));
    if (!p) {
      const m = ix ? MX.buscarProducto(ix, nombre) : null;
      p = { id: nuevoId('p'), nombre, tipo: tipo || 'otro', mid: m ? m.p.id : null };
      st.productos.push(p);
      if (res) res.productos++;
    } else if (tipo && (!p.tipo || p.tipo === 'otro')) p.tipo = tipo;
    return p;
  }
  function importarGenerador(st, ix, d, nuevoId) {
    const res = resVacio();
    for (const p of d.catalogoProductos || []) if (p && p.nombre) asegurarProducto(st, ix, p.nombre, p.tipo, nuevoId, res);
    const ya = new Set(st.trat.map((t) => t.id));
    for (const h of d.historial || []) {
      if (!h) continue;
      const id = 'g' + h.id;
      if (ya.has(id)) { res.saltadas++; continue; }
      const c = asegurarCliente(st, ix, h.cliente, nuevoId, res);
      const fin = c && h.finca ? buscarFincaCli(st, ix, c.id, h.finca) : null;
      const f = fin ? finca(st, ix, fin) : null;
      const prods = (h.productos || []).map(prodDe).filter((p) => p.nombre);
      prods.forEach((p) => asegurarProducto(st, ix, p.nombre, p.tipo, nuevoId, res));
      st.trat.push({
        id, fecha: h.fecha || '', cli: c ? c.id : null, cliNom: c ? '' : '', fin, finNom: f ? f.nombre : String(h.finca || '').trim(), cultivo: String(h.cultivo || '').trim(),
        problema: String(h.problema || '').trim(), plazo: String(h.plazo || '').trim(), prods, cond: String(h.condiciones || '').trim(), obs: String(h.observaciones || '').trim(),
        ts: Number(h.id) || Date.now(), origen: 'Generador',
      });
      ya.add(id); res.tratamientos++;
      if (h.marca && (!st.ajustes.marca || st.ajustes.marca === 'FG Agro')) st.ajustes.marca = String(h.marca).trim();
    }
    for (const p of d.plantillas || []) {
      if (!p || !p.nombre || st.plantillas.some((x) => norm(x.nombre) === norm(p.nombre))) continue;
      const prods = (p.productos || []).map(prodDe).filter((x) => x.nombre);
      prods.forEach((x) => asegurarProducto(st, ix, x.nombre, x.tipo, nuevoId, res));
      st.plantillas.push({ nombre: String(p.nombre).trim(), cultivo: p.cultivo || '', problema: p.problema || '', plazo: p.plazo || '', cond: p.condiciones || '', obs: p.observaciones || '', prods });
      res.plantillas++;
    }
    return res;
  }

  /* Copia de la app Clientes: { clientes:[{id,nombre,alta,baja}], años:{AAAA:{id:fila}} } */
  function importarClientes(st, ix, d, nuevoId) {
    const res = resVacio();
    const mapa = {};
    for (const c0 of d.clientes || []) {
      if (!c0 || !c0.nombre) continue;
      const c = asegurarCliente(st, ix, c0.nombre, nuevoId, res);
      mapa[c0.id] = c.id;
      if (!c.alta && c0.alta) c.alta = c0.alta;
      if (!c.baja && c0.baja) c.baja = c0.baja;
    }
    for (const y of Object.keys(d.años || {})) {
      const t = d.años[y] || {};
      if (!st.años[y]) st.años[y] = {};
      for (const oid of Object.keys(t)) {
        const nid = mapa[oid]; const r = t[oid];
        if (!nid || !r || st.años[y][nid]) continue;
        const f = nuevaFila(Number(r.planes) || 0, Number(r.precio) || 0);
        for (let i = 0; i < 12; i++) {
          f.env[i] = ESTADOS.includes((r.env || [])[i]) ? r.env[i] : 'N';
          f.imp[i] = Number((r.imp || [])[i]) || 0;
          f.cob[i] = !!(r.cob || [])[i];
          f.man[i] = !!(r.man || [])[i];
        }
        st.años[y][nid] = f; res.filasAnio++;
      }
    }
    return res;
  }
  function detectarCopia(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.app === 'visitas-campo' && d.datos) return { tipo: 'visitas', datos: d.datos };
    if (d.app === 'generador-tratamientos' && d.datos) return { tipo: 'generador', datos: d.datos };
    if (d.app === 'asesor' && d.estado) return { tipo: 'asesor', datos: d.estado };
    if (Array.isArray(d.clientes) && d.años && typeof d.años === 'object') return { tipo: 'clientes', datos: d };
    return null;
  }

  /* ---------- Varios aparatos (móvil, tablet, ordenador): sellos por registro y fusión ----------
     El estado se ve como un conjunto de registros con clave (un cliente, una visita, un mes de planes y cobros
     de un cliente…). Cada registro lleva la hora de su último cambio (st.sello) y los borrados dejan su hora
     (st.borrados). Al juntar dos copias, en cada registro gana el cambio más reciente; si empatan, la de la hoja. */
  const COLS = { clientes: ['cli', 'id'], fincasNuevas: ['fn', 'id'], visitas: ['vis', 'id'], trat: ['tr', 'id'], productos: ['pr', 'id'], mxPend: ['mp', 'k'] };
  const LISTAS = { plagas: ['pg', (x) => x && x.nombre], fenologias: ['fe', (x) => x && x.nombre], plantillas: ['pl', (x) => x && x.nombre], cultivos: ['cu', (x) => x] };
  const CONOCIDAS = new Set(['v', 'sello', 'borrados', 'cultivosExtra', 'años', 'ajustes', 'importes', ...Object.keys(COLS), ...Object.keys(LISTAS)]);
  const J = (v) => JSON.stringify(v === undefined ? null : v);
  /* Estado → Map clave → valor en JSON (en orden estable) */
  function aplanar(st) {
    const m = new Map();
    if (!st || typeof st !== 'object') return m;
    for (const [col, [pre, campo]] of Object.entries(COLS)) for (const x of st[col] || []) if (x && x[campo] != null) m.set(pre + '|' + x[campo], J(x));
    for (const [lista, [pre, nom]] of Object.entries(LISTAS)) {
      const orden = [];
      for (const x of st[lista] || []) { const k = norm(nom(x)); if (!k) continue; const key = pre + '|' + k; if (m.has(key)) continue; m.set(key, J(x)); orden.push(key); }
      m.set('ord|' + lista, J(orden));
    }
    for (const [fid, cs] of Object.entries(st.cultivosExtra || {})) m.set('ce|' + fid, J(cs));
    for (const [y, t] of Object.entries(st.años || {})) {
      m.set('ay|' + y, '1');
      for (const [cid, r] of Object.entries(t || {})) {
        if (!r) continue;
        m.set('af|' + y + '|' + cid, J({ planes: r.planes, precio: r.precio }));
        for (let i = 0; i < 12; i++) m.set('am|' + y + '|' + cid + '|' + i, J({ e: (r.env || [])[i], i: (r.imp || [])[i], c: (r.cob || [])[i], h: (r.man || [])[i] }));
      }
    }
    const aj = st.ajustes || {};
    for (const [k, v] of Object.entries(aj)) {
      if (k === 'dias') { for (const [mes, n] of Object.entries(v || {})) m.set('ad|' + mes, J(n)); } else m.set('aj|' + k, J(v));
    }
    for (const [k, v] of Object.entries(st.importes || {})) m.set('im|' + k, J(v));
    for (const k of Object.keys(st)) if (!CONOCIDAS.has(k)) m.set('x|' + k, J(st[k]));
    return m;
  }
  /* Map clave → JSON → estado */
  function reconstruir(m) {
    const st = { v: 1, clientes: [], fincasNuevas: [], cultivosExtra: {}, visitas: [], trat: [], plantillas: [], productos: [], plagas: [], fenologias: [], cultivos: [], años: {}, ajustes: { dias: {} }, mxPend: [], importes: {} };
    const porPre = {}; for (const [col, [pre]] of Object.entries(COLS)) porPre[pre] = col;
    const listas = {}; for (const [lista, [pre]] of Object.entries(LISTAS)) listas[pre] = { lista, items: new Map(), orden: [] };
    const filas = {};
    for (const [key, js] of m) {
      const i = key.indexOf('|'), pre = key.slice(0, i), resto = key.slice(i + 1), v = JSON.parse(js);
      if (porPre[pre]) st[porPre[pre]].push(v);
      else if (listas[pre]) listas[pre].items.set(key, v);
      else if (pre === 'ord') { const L = Object.values(listas).find((x) => x.lista === resto); if (L) L.orden = Array.isArray(v) ? v : []; }
      else if (pre === 'ce') st.cultivosExtra[resto] = v;
      else if (pre === 'ay') { if (!st.años[resto]) st.años[resto] = {}; }
      else if (pre === 'af' || pre === 'am') {
        const p = resto.split('|'), y = p[0], cid = p[1];
        if (!st.años[y]) st.años[y] = {};
        const fk = y + '|' + cid;
        if (!filas[fk]) filas[fk] = { y, cid, base: null, meses: {} };
        if (pre === 'af') filas[fk].base = v; else filas[fk].meses[p[2]] = v;
      }
      else if (pre === 'ad') st.ajustes.dias[resto] = v;
      else if (pre === 'aj') st.ajustes[resto] = v;
      else if (pre === 'im') st.importes[resto] = v;
      else if (pre === 'x') st[resto] = v;
    }
    for (const L of Object.values(listas)) {
      const vistos = new Set();
      for (const k of L.orden) if (L.items.has(k) && !vistos.has(k)) { st[L.lista].push(L.items.get(k)); vistos.add(k); }
      for (const [k, v] of L.items) if (!vistos.has(k)) st[L.lista].push(v);
    }
    for (const f of Object.values(filas)) {
      // Una fila sin su cabecera (planes y precio) solo puede venir de un borrado a medias: no se rehace
      if (!f.base) continue;
      const r = { planes: Number(f.base.planes) || 0, precio: Number(f.base.precio) || 0, env: [], imp: [], cob: [], man: [] };
      for (let i = 0; i < 12; i++) {
        const x = f.meses[i] || {};
        r.env.push(ESTADOS.includes(x.e) ? x.e : 'N'); r.imp.push(x.i == null ? r.precio : x.i); r.cob.push(!!x.c); r.man.push(!!x.h);
      }
      st.años[f.y][f.cid] = r;
    }
    return st;
  }
  /* Primera vez con sellos: todos los registros con la misma hora (0 en un aparato vacío, 1 si ya tiene datos) */
  function prepararSellos(st, t) {
    if (st.sello && typeof st.sello === 'object') { if (!st.borrados || typeof st.borrados !== 'object') st.borrados = {}; return false; }
    st.sello = {}; st.borrados = {};
    for (const k of aplanar(st).keys()) st.sello[k] = t;
    return true;
  }
  /* Aparato sin datos propios (recién instalado) */
  const virgen = (st) => !st || !((st.clientes || []).length || (st.visitas || []).length || (st.trat || []).length || (st.productos || []).length || (st.plantillas || []).length || Object.keys(st.años || {}).length);
  /* Pone la hora t en los registros que han cambiado entre prev y next, y anota los borrados. Devuelve cuántos. */
  function sellar(prev, next, t) {
    const a = prev ? aplanar(prev) : new Map(), b = aplanar(next);
    const sp = (prev && prev.sello) || {}, bp = (prev && prev.borrados) || {};
    const sello = { ...(next.sello || {}) }, borr = { ...bp, ...(next.borrados || {}) };
    let n = 0;
    for (const [k, v] of b) {
      if (a.get(k) !== v) { sello[k] = t; delete borr[k]; n++; }
      else if (!(k in sello)) sello[k] = k in sp ? sp[k] : 0;
    }
    for (const k of a.keys()) if (!b.has(k)) { borr[k] = t; n++; }
    for (const k of Object.keys(sello)) if (!b.has(k)) delete sello[k];
    next.sello = sello; next.borrados = borr;
    return n;
  }
  /* Junta la copia local con la de la hoja. Devuelve el estado juntado y cuántos registros cambian en cada lado. */
  function fusionar(L, R) {
    const fl = aplanar(L), fr = aplanar(R);
    const sl = (L && L.sello) || {}, sr = (R && R.sello) || {}, bl = (L && L.borrados) || {}, br = (R && R.borrados) || {};
    const hora = (f, s, b, k) => (f.has(k) ? (Number(s[k]) || 0) : (k in b ? Number(b[k]) || 0 : -1));
    const claves = new Set([...fl.keys(), ...fr.keys(), ...Object.keys(bl), ...Object.keys(br)]);
    const out = new Map(), sello = {}, borr = {};
    let nL = 0, nR = 0;
    for (const k of claves) {
      const tl = hora(fl, sl, bl, k), tr = hora(fr, sr, br, k);
      const deR = tr >= tl; // empate: gana la hoja
      const v = deR ? fr.get(k) : fl.get(k), t = deR ? tr : tl;
      if (v !== undefined) { out.set(k, v); sello[k] = t; } else if (t >= 0) borr[k] = t;
      if (v !== fl.get(k)) nL++;
      if (v !== fr.get(k) || t !== tr) nR++;
    }
    const st = reconstruir(out);
    st.sello = sello; st.borrados = borr;
    return { st, nL, nR };
  }
  /* Huella del estado (datos + sellos): para saber si la hoja ya tiene exactamente lo mismo */
  function huella(st) {
    const f = aplanar(st), s = (st && st.sello) || {}, b = (st && st.borrados) || {};
    const filas = [...f.keys()].sort().map((k) => k + '=' + f.get(k) + '@' + (s[k] || 0));
    const bor = Object.keys(b).sort().map((k) => k + '@' + b[k]);
    return filas.join('\n') + '\n#\n' + bor.join('\n');
  }

  /* ---------- tablas para Google Sheets ---------- */
  function tablas(st, ix, hoy) {
    const nomCli = (id) => { const c = cliente(st, id); return c ? c.nombre : ''; };
    const midCli = (id) => { const c = cliente(st, id); return c && c.mid ? c.mid : ''; };
    const vis = [];
    for (const v of recientes(st.visitas)) {
      const fotos = (v.fotos || []).map((f) => f.url).filter(Boolean).join(' ');
      (v.cultivos.length ? v.cultivos : [{ c: '', fen: '', plagas: {} }]).forEach((cv, i) => vis.push([
        v.fecha, nomCli(v.cli), midCli(v.cli), v.finNom || '', v.fin && /^F\d+/.test(v.fin) ? v.fin : '', cv.c, cv.fen || '', textoPlagas(cv.plagas),
        i === 0 ? v.obs || '' : '', i === 0 ? v.accion || '' : '', i === 0 && v.accion ? v.seg || '' : '', i === 0 && v.accion ? (v.hecho ? 'Sí' : 'No') : '', i === 0 ? fotos : '', v.id,
      ]));
    }
    const tra = [];
    for (const t of recientes(st.trat)) {
      const base = [t.fecha, nomCli(t.cli), midCli(t.cli), t.finNom || '', t.cultivo || '', t.problema || '', t.plazo || ''];
      const cola = [t.cond || '', t.obs || '', t.id];
      const prods = ordenMezcla(t.prods);
      if (!prods.length) tra.push([...base, '', '', '', '', '', '', ...cola]);
      prods.forEach((p, i) => {
        const pc = st.productos.find((x) => norm(x.nombre) === norm(p.nombre));
        const n = Number(String(p.dv || '').replace(',', '.'));
        tra.push([...base, i + 1, p.nombre, pc && pc.mid ? pc.mid : '', formInfo(p.tipo).label, String(p.dv || '').trim() === '' ? '' : (isFinite(n) ? n : p.dv), unidad(p.du), ...cola]);
      });
    }
    const pla = [], cob = [];
    for (const y of Object.keys(st.años).map(Number).sort((a, b) => b - a)) {
      for (const x of filas(st, y)) {
        pla.push([y, x.c.nombre, x.c.mid || '', x.r.planes, ...x.r.env.map((e) => ESTADO_TXT[e] || '')]);
        for (let i = 0; i < 12; i++) cob.push([y, x.c.nombre, x.c.mid || '', MC[i], Number(x.r.imp[i]) || 0, x.r.cob[i] ? 'Sí' : 'No', x.r.precio]);
      }
    }
    const y0 = Number(String(hoy).slice(0, 4));
    const cli = delAsesor(st).map((c) => {
      const fs = fincasDe(st, ix, c.id);
      const ests = fs.map((f) => estadoFinca(st, f.id, hoy));
      const ult = recientes(st.visitas.filter((v) => v.cli === c.id))[0];
      const r = (st.años[y0] || {})[c.id];
      let cobrado = 0, pend = 0;
      if (r) for (let i = 0; i < 12; i++) { const imp = Number(r.imp[i]) || 0; if (r.cob[i]) cobrado += imp; else if (enRango(c, y0, i)) pend += imp; }
      return [c.nombre, c.mid || '', fs.length, ests.filter((e) => e.toca).length, ult ? ult.fecha : '', ult ? ult.finNom : '',
        st.trat.filter((t) => t.cli === c.id).length, r ? r.planes : '', r ? r.precio : '', cobrado, pend, c.alta || '', c.baja || ''];
    });
    const EUR = '#,##0.00', F = 'dd/mm/yyyy';
    return [
      { nombre: 'Clientes', cabecera: ['Cliente', 'ID cliente', 'Fincas', 'Fincas que toca visitar', 'Última visita', 'Finca última visita', 'Tratamientos', 'Planes ' + y0, 'Precio/mes (€)', 'Cobrado ' + y0 + ' (€)', 'Pendiente ' + y0 + ' (€)', 'Primer mes', 'Baja (último mes)'], filas: cli, fechas: [4], formatos: [null, null, '0', '0', F, null, '0', '0', EUR, EUR, EUR, null, null] },
      { nombre: 'Visitas', cabecera: ['Fecha', 'Cliente', 'ID cliente', 'Finca', 'ID finca', 'Cultivo', 'Estado fenológico', 'Plagas y enfermedades', 'Observaciones', 'Acción pendiente', 'Seguimiento', 'Hecho', 'Fotos', 'ID visita'], filas: vis, fechas: [0, 10], formatos: [F, null, null, null, null, null, null, null, null, null, F, null, null, null] },
      { nombre: 'Tratamientos', cabecera: ['Fecha', 'Cliente', 'ID cliente', 'Finca', 'Cultivo', 'Problema', 'Plazo de seguridad', 'Nº mezcla', 'Producto', 'ID producto', 'Formulación', 'Dosis /1000 L', 'Unidad', 'Condiciones de aplicación', 'Observaciones', 'ID tratamiento'], filas: tra, fechas: [0], formatos: [F, null, null, null, null, null, null, '0', null, null, null, '#,##0.###', null, null, null, null] },
      { nombre: 'Planes', cabecera: ['Año', 'Cliente', 'ID cliente', 'Planes', ...MC], filas: pla, fechas: [], formatos: ['0', null, null, '0'] },
      { nombre: 'Cobros', cabecera: ['Año', 'Cliente', 'ID cliente', 'Mes', 'Importe (€)', 'Cobrado', 'Precio/mes (€)'], filas: cob, fechas: [], formatos: ['0', null, null, null, EUR, null, EUR] },
    ];
  }

  const api = {
    hoyISO, diffDias, sumarDias, fmtFecha, fechaDesdeES,
    MES, MC, ESTADOS, ESTADO_TXT, ym, enRango, filas, filasPlanes, statsPlanes, transcurridos, statsCobros, cambiarPrecio, nuevaFila, crearAnio,
    DIAS_DEFECTO, frecuencia, FORM_TYPES, UNIDADES, formInfo, unidad, ordenMezcla, dosisTxt, NIVELES, parsePlagas, textoPlagas,
    vacio, migrar, valido, uniq, limpiar, altaPlaga, altaFen, ordenPlagas,
    cliente, delAsesor, esAsesoria, fincasDe, finca, ultimaVisita, estadoFinca, activo, fincasEstado, seguimientos, recientes,
    buscarFincaCli, choqueAnios, unirCliente, cambiarFinca, aplicarMaestros, asegurarCliente, asegurarFinca, asegurarProducto,
    importarVisitas, importarGenerador, importarClientes, detectarCopia, tablas,
    aplanar, reconstruir, prepararSellos, virgen, sellar, fusionar, huella,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AL = api;
})(typeof window !== 'undefined' ? window : globalThis);
