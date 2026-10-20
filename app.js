'use strict';
/* Asesor · FG Agro — visitas de campo, recomendaciones de tratamiento y planes y cobros de los clientes de asesoría.
   Une las apps Visitas, Generador de tratamientos y Clientes. Todo se guarda en el móvil (IndexedDB) y funciona
   sin conexión; clientes, fincas y cultivos salen de los maestros de Drive y hay copia de un solo sentido a la hoja «Asesor». */

const APP_VERSION = '1.0.0';

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, min = 2, max = 2) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const eur = (n) => nf(n) + ' €';
const eur0 = (n) => nf(n, 0, 0) + ' €';
const uid = (p) => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const N = (s) => MX.norm(s);
const hoy = () => AL.hoyISO();
const HOYM = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; };
const fF = (t) => AL.fmtFecha(t);
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
function parseNum(s) {
  s = String(s ?? '').trim().replace(/\s/g, '').replace(/€/g, '');
  if (!s) return NaN;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = s.replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
}
function mesLargo(ym) {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function haceTxt(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return 'hace ' + min + ' min';
  if (min < 1440) return 'hace ' + Math.round(min / 60) + ' h';
  return new Date(iso).toLocaleDateString('es-ES');
}
function descargar(nombre, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function cargarScript(src) {
  return new Promise((res, rej) => {
    if ($(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

/* ---------- Almacenamiento (IndexedDB) ---------- */
let dbp;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('asesor', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('fotos', { keyPath: 'k' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function dbOp(store, modo, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, modo); const q = fn(t.objectStore(store));
    t.oncomplete = () => res(q ? q.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('cancelado'));
  });
}
const dbGet = (k) => dbOp('kv', 'readonly', (s) => s.get(k));
const dbSet = (k, v) => dbOp('kv', 'readwrite', (s) => s.put(v, k));
const dbDel = (k) => dbOp('kv', 'readwrite', (s) => s.delete(k));
const fotoPut = (f) => dbOp('fotos', 'readwrite', (s) => s.put(f));
const fotoGet = (k) => dbOp('fotos', 'readonly', (s) => s.get(k));
const fotoDel = (k) => dbOp('fotos', 'readwrite', (s) => s.delete(k));
const fotoTodas = () => dbOp('fotos', 'readonly', (s) => s.getAll());

/* ---------- Estado ---------- */
let state = AL.vacio();
let saveChain = Promise.resolve();
function persist() {
  const copia = state;
  saveChain = saveChain.then(() => dbSet('state', copia)).catch((e) => toast('No se pudo guardar en el móvil: ' + (e && e.message || e), true));
  markDirty();
  return saveChain;
}
function commit(fn, { render = true } = {}) {
  const c = structuredClone(state);
  try { fn(c); } catch (e) { console.error(e); toast(e.message || String(e), true); return false; }
  state = c; persist();
  if (render) renderAll();
  return true;
}

/* ---------- Avisos, hojas y botones ---------- */
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, err ? 4500 : 2200);
}
const sheetRoot = $('#sheetRoot');
let sheetOpen = false, sheetFn = null;
function openSheet(title, html, redraw = null) {
  if (!sheetOpen) history.pushState({ sheet: true }, '');
  sheetOpen = true; sheetFn = redraw;
  sheetRoot.innerHTML = `<div class="scrim"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="x" aria-label="Cerrar">✕</button></header><div class="sheet-body">${html}</div></section>`;
  $('.scrim', sheetRoot).onclick = closeSheet;
  $('.x', sheetRoot).onclick = closeSheet;
  return $('.sheet-body', sheetRoot);
}
function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false; sheetFn = null; sheetRoot.innerHTML = '';
  if (history.state && history.state.sheet) history.back();
}
const reopen = (fn) => { closeSheet(); setTimeout(fn, 40); };
window.addEventListener('popstate', () => { if (sheetOpen) { sheetOpen = false; sheetFn = null; sheetRoot.innerHTML = ''; } });
/* Vuelve a pintar la hoja abierta (tras un cambio) conservando el desplazamiento */
function redrawSheet() {
  if (!sheetOpen || !sheetFn) return;
  const b = $('.sheet-body', sheetRoot); const y = b ? b.scrollTop : 0;
  sheetFn();
  const b2 = $('.sheet-body', sheetRoot); if (b2) b2.scrollTop = y;
}
function armDelete(btn, action, label) {
  let armed = false, timer; label = label || btn.textContent;
  btn.onclick = () => {
    if (!armed) { armed = true; btn.classList.add('armed'); btn.textContent = 'Pulsa otra vez para confirmar'; timer = setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.textContent = label; }, 3500); }
    else { clearTimeout(timer); action(); }
  };
}
const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;

/* ---------- Maestros compartidos ----------
   Se leen del servicio privado (Apps Script de «Maestro de clientes», Drive › Apps › Maestros) y se guardan en el
   móvil. Asesor solo lee y pide altas (clientes, fincas y cultivos nuevos entran con Revisar = Sí). */
let mx = { url: '', clave: '', data: null, fecha: null, lastFetch: null, lastError: '' };
let IX = null, mxRunning = false;
const mxOn = () => !!(mx.url && mx.clave);
async function postScript(url, clave, accion, extra = {}, ms = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    // Sin cabeceras propias: petición simple (text/plain), Google no exige comprobación previa.
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ accion, clave, ...extra }), signal: ctrl.signal });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch (_) { throw new Error('La dirección no responde como el script (revisa que esté publicado para «Cualquier usuario»)'); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Tiempo de espera agotado');
    if (e instanceof TypeError) throw new Error('Sin conexión con Google');
    throw e;
  } finally { clearTimeout(t); }
}
const callMx = (accion, extra) => postScript(mx.url, mx.clave, accion, extra);
const mxErr = (r, def) => (r.error === 'clave' ? 'La clave de los maestros no coincide con la del script' : (r.error || def));
function saveMx() { dbSet('mx', mx).catch(() => {}); }

function pedirAlta(c, tipo, ref, datos) {
  if (c.mxPend.some((p) => p.tipo === tipo && p.ref === ref)) { c.mxPend = c.mxPend.map((p) => (p.tipo === tipo && p.ref === ref ? { ...p, datos } : p)); return; }
  c.mxPend.push({ k: uid('a'), tipo, ref, datos });
}
/* Envía la cola de altas. Las fincas esperan a que su cliente tenga ID del maestro. */
async function procesarAltas() {
  for (const a of [...state.mxPend]) {
    let datos = a.datos;
    if (a.tipo === 'finca' || a.tipo === 'cultivo') {
      const f = a.tipo === 'finca' ? state.fincasNuevas.find((x) => x.id === a.ref) : null;
      const cliId = f ? f.cli : (a.datos.cli || null);
      const cl = cliId ? AL.cliente(state, cliId) : null;
      const cMid = a.tipo === 'cultivo' ? a.datos.clienteId : (cl && cl.mid);
      if (a.tipo === 'finca' && !f) { commit((c) => { c.mxPend = c.mxPend.filter((x) => x.k !== a.k); }, { render: false }); continue; }
      if (!cMid) continue; // aún sin cliente en el maestro
      datos = a.tipo === 'finca'
        ? { nombre: f.nombre, clienteId: cMid, clienteNombre: cl ? cl.nombre : '', propia: false, cultivos: f.cultivos || [] }
        : { nombre: a.datos.nombre, clienteId: cMid, clienteNombre: a.datos.clienteNombre || '', cultivos: a.datos.cultivos || [] };
    }
    const r = await callMx('alta', { tipo: a.tipo === 'cultivo' ? 'finca' : a.tipo, datos, app: 'Asesor' });
    if (!r.ok) throw new Error(mxErr(r, 'No se pudo dar de alta en el maestro'));
    commit((c) => {
      c.mxPend = c.mxPend.filter((x) => x.k !== a.k);
      if (a.tipo === 'cliente') {
        const cl = c.clientes.find((x) => x.id === a.ref);
        const otro = c.clientes.find((x) => x.mid === r.id && x.id !== a.ref);
        if (cl) { if (otro) AL.unirCliente(c, cl.id, otro.id); else cl.mid = r.id; }
      } else if (a.tipo === 'finca') {
        const f = c.fincasNuevas.find((x) => x.id === a.ref);
        AL.cambiarFinca(c, a.ref, r.id, f ? f.nombre : '');
      }
    }, { render: false });
  }
}
async function refreshMx({ auto = false, manual = false } = {}) {
  if (!mxOn() || mxRunning) return;
  if (!navigator.onLine) { if (manual) toast('Sin conexión: los maestros se actualizarán al volver', true); return; }
  if (auto && !state.mxPend.length && mx.lastFetch && Date.now() - new Date(mx.lastFetch).getTime() < 30 * 60000) return;
  mxRunning = true; renderStatus();
  try {
    await procesarAltas();
    const r = await callMx('leer');
    if (!r.ok) throw new Error(mxErr(r, 'No se pudieron leer los maestros'));
    mx.data = { clientes: r.clientes || [], fincas: r.fincas || [], productos: r.productos || [] };
    mx.fecha = r.fecha || null; mx.lastFetch = new Date().toISOString(); mx.lastError = '';
    IX = MX.indexar(mx.data); saveMx();
    const prueba = structuredClone(state);
    const res = AL.aplicarMaestros(prueba, IX, uid);
    if (JSON.stringify(prueba) !== JSON.stringify(state)) { state = prueba; persist(); }
    if (manual) toast(res.nuevos ? 'Maestros leídos · ' + plural(res.nuevos, 'cliente nuevo', 'clientes nuevos') + ' de asesoría' : 'Maestros al día');
  } catch (e) { mx.lastError = e.message || String(e); saveMx(); if (manual) toast(mx.lastError, true); }
  finally { mxRunning = false; renderAll(); redrawSheet(); }
}
function mxStatusText() {
  if (!mxOn()) return '';
  const pend = state.mxPend.length ? ' · ' + plural(state.mxPend.length, 'alta pendiente', 'altas pendientes') : '';
  if (mxRunning) return 'Leyendo los maestros…';
  if (mx.lastError) return 'Maestros: ' + mx.lastError + pend;
  if (!mx.data) return 'Maestros: todavía sin leer' + pend;
  return 'Maestros: ' + mx.data.clientes.length + ' clientes y ' + mx.data.fincas.length + ' fincas · leídos ' + haceTxt(mx.lastFetch) + pend;
}

/* ---------- Copia a la hoja «Asesor» (un solo sentido) y fotos ---------- */
let sync = { url: '', clave: '', enabled: false, dirty: false, lastOk: null, lastError: '' };
let syncRunning = false, syncTimer = null, syncRetry = null, syncRev = 0, fotosPend = 0, fotosRunning = false;
const syncOn = () => !!(sync.enabled && sync.url && sync.clave);
const callSync = (accion, extra, ms) => postScript(sync.url, sync.clave, accion, extra, ms);
function saveSync() { dbSet('sync', sync).catch(() => {}); }
function markDirty() {
  if (!syncOn()) return;
  sync.dirty = true; syncRev++; saveSync(); renderStatus();
  clearTimeout(syncTimer); syncTimer = setTimeout(() => runSync(), 2500);
}
function syncPayload() {
  const tablas = AL.tablas(state, IX, hoy());
  return { tablas, estado: JSON.stringify(state), version: APP_VERSION };
}
async function runSync() {
  if (!syncOn() || syncRunning) return;
  if (!navigator.onLine) { renderStatus(); return; }
  syncRunning = true; const rev = syncRev; renderStatus();
  try {
    await subirFotos();
    const r = await callSync('sincronizar', syncPayload(), 60000);
    if (!r.ok) throw new Error(r.error === 'clave' ? 'La clave no coincide con la del script' : (r.error || 'Error del receptor'));
    sync.lastOk = new Date().toISOString(); sync.lastError = '';
    if (syncRev === rev) sync.dirty = false;
  } catch (e) {
    sync.lastError = e.message || String(e); sync.dirty = true;
    clearTimeout(syncRetry); syncRetry = setTimeout(() => runSync(), 60000);
  } finally {
    syncRunning = false; saveSync(); renderStatus();
    if (sync.dirty && !sync.lastError) { clearTimeout(syncTimer); syncTimer = setTimeout(() => runSync(), 800); }
  }
}
async function contarFotos() { try { fotosPend = (await fotoTodas()).length; } catch (_) { fotosPend = 0; } renderStatus(); }
/* Las fotos se guardan en el móvil y se suben una a una a la carpeta «Fotos de visitas» de Drive. */
async function subirFotos() {
  if (!syncOn() || fotosRunning || !navigator.onLine) return;
  fotosRunning = true;
  try {
    const fotos = await fotoTodas();
    for (const f of fotos) {
      const v = state.visitas.find((x) => x.id === f.vid);
      if (!v) { await fotoDel(f.k); continue; }
      const cl = AL.cliente(state, v.cli);
      const r = await callSync('foto', { k: f.k, mime: f.mime, base64: f.base64, nombre: (v.fecha || '') + ' ' + (v.finNom || '') + ' ' + f.k.slice(-4) + '.jpg', cliente: cl ? cl.nombre : '' }, 90000);
      if (!r.ok) throw new Error(r.error === 'clave' ? 'La clave no coincide con la del script' : (r.error || 'No se pudo subir una foto'));
      commit((c) => { const vv = c.visitas.find((x) => x.id === f.vid); if (vv) vv.fotos = vv.fotos.map((x) => (x.k === f.k ? { k: x.k, url: r.url } : x)); }, { render: false });
      await fotoDel(f.k);
    }
  } finally { fotosRunning = false; await contarFotos(); }
}
function syncStatusText() {
  if (!syncOn()) return '';
  const fp = fotosPend ? ' · ' + plural(fotosPend, 'foto por subir', 'fotos por subir') : '';
  if (syncRunning) return '☁ Enviando a la hoja «Asesor»…' + fp;
  if (sync.lastError) return '☁ No se pudo enviar: ' + sync.lastError + fp;
  if (sync.dirty) return (navigator.onLine ? '☁ Pendiente de enviar…' : '☁ Pendiente de enviar (sin conexión)') + fp;
  return '☁ Hoja al día · ' + haceTxt(sync.lastOk) + fp;
}
function renderStatus() {
  const a = $('#syncStatus'); if (a) { a.textContent = syncStatusText(); a.hidden = !syncOn(); }
  const b = $('#mxStatus'); if (b) { b.textContent = mxStatusText(); b.hidden = !mxOn() || !(mx.lastError || mxRunning || !mx.data || state.mxPend.length); }
  const c = $('#syncLine'); if (c) c.textContent = syncStatusText();
  const d = $('#mxLine'); if (d) d.textContent = mxStatusText() || 'Sin conectar';
}

/* ---------- Pestañas ---------- */
const ui = { tab: 'visitas', vSeg: 'toca', vTodas: false, cSeg: 'fichas', year: HOYM().y, month: HOYM().m, cobFiltro: 'todos', qT: '', qC: '' };
const nomCli = (id) => { const c = AL.cliente(state, id); return c ? c.nombre : '(sin cliente)'; };
const fincasEst = () => AL.fincasEstado(state, IX, hoy());

function renderAll() {
  $$('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  const head = $('#head'), view = $('#view'), fab = $('#fab');
  fab.hidden = false;
  if (ui.tab === 'visitas') { head.innerHTML = headVisitas(); view.innerHTML = viewVisitas(); $('#fabLabel').textContent = 'Nueva visita'; }
  else if (ui.tab === 'trat') { head.innerHTML = headTrat(); view.innerHTML = viewTrat(); $('#fabLabel').textContent = 'Nuevo tratamiento'; }
  else {
    head.innerHTML = headClientes(); view.innerHTML = viewClientes();
    $('#fabLabel').textContent = ui.cSeg === 'fichas' ? 'Cliente' : 'Cliente en ' + ui.year;
  }
  wireView();
  renderStatus();
  const nToca = fincasEst().filter((x) => x.e.toca).length, nSeg = AL.seguimientos(state).filter((v) => v.seg && v.seg < hoy()).length;
  const bv = $('#badgeVis'); bv.textContent = nSeg || ''; bv.hidden = !nSeg;
  $('#topSub').textContent = state.clientes.length ? plural(AL.delAsesor(state).length, 'cliente', 'clientes') + ' · ' + plural(nToca, 'finca toca visitar', 'fincas tocan visitar') : '';
}
const kpi = (label, val, cls = '') => `<div class="k ${cls}"><span>${esc(label)}</span><strong>${val}</strong></div>`;

function inicioVacio() {
  if (state.clientes.length) return '';
  return `<div class="vacio-ini"><h2>Bienvenido a Asesor</h2>
    <p>Para empezar:</p>
    <p>1. ${mxOn() ? '✓ Maestros conectados' : 'Conecta los maestros en ⚙ Ajustes'}<br>2. Trae tus datos de Visitas, Generador y Clientes en ⚙ Ajustes</p>
    <div class="actions"><button class="btn primary" data-act="ajustes">Abrir ajustes</button></div></div>`;
}

/* ----- Visitas ----- */
function headVisitas() {
  const fe = fincasEst(), toca = fe.filter((x) => x.e.toca).length;
  const segs = AL.seguimientos(state), venc = segs.filter((v) => v.seg && v.seg < hoy()).length;
  const desde = AL.sumarDias(hoy(), -30);
  const n30 = state.visitas.filter((v) => v.fecha >= desde).length;
  return `<div class="kpis three">${kpi('Toca visitar', toca + '<small> / ' + fe.length + '</small>', toca ? 'warn' : '')}${kpi('Seguimientos', segs.length + (venc ? '<small> · ' + venc + ' venc.</small>' : ''), venc ? 'warn' : '')}${kpi('Visitas 30 días', n30)}</div>`;
}
function filaFinca(x) {
  const cult = (x.f.cultivos || []).join(', ');
  return `<button class="row" data-visfin="${esc(x.f.id)}" data-cli="${esc(x.c.id)}"><div class="main"><div class="name">${esc(x.f.nombre)}${x.f.nueva ? '<span class="tag" style="background:var(--warn-soft);color:var(--warn)">nueva</span>' : ''}</div><div class="sub">${esc([x.c.nombre, cult].filter(Boolean).join(' · '))}</div></div>
    <div class="side"><div class="${x.e.toca ? 'neg' : ''}" style="font-weight:600">${esc(x.e.texto)}</div><div class="small">cada ${x.e.frec} d</div></div></button>`;
}
function filaSeg(v) {
  const venc = v.seg && v.seg < hoy();
  return `<div class="mini ${venc ? 'vencido' : ''}"><button class="main" style="background:none;border:0;padding:0;text-align:left;flex:1;min-width:0" data-vis="${esc(v.id)}"><div class="name">${esc(v.accion)}</div>
    <div class="sub">${esc(nomCli(v.cli))} · ${esc(v.finNom || '')}</div><div class="sub fecha">${v.seg ? (venc ? 'Vencido el ' : 'Para el ') + fF(v.seg) : 'Sin fecha · visita del ' + fF(v.fecha)}</div></button>
    <button class="paid" data-hecho="${esc(v.id)}">Hecho</button></div>`;
}
function filaVisita(v, conCliente = true) {
  const cult = v.cultivos.map((c) => c.c + (Object.keys(c.plagas || {}).length ? ': ' + AL.textoPlagas(c.plagas) : '')).join(' · ');
  const pend = (v.fotos || []).some((f) => !f.url);
  return `<button class="row" data-vis="${esc(v.id)}"><div class="main"><div class="name">${esc(v.finNom || '')}</div><div class="sub">${esc([conCliente ? nomCli(v.cli) : '', cult || 'Sin plagas anotadas'].filter(Boolean).join(' · '))}</div></div>
    <div class="side small">${fF(v.fecha)}${(v.fotos || []).length ? '<br>📷 ' + v.fotos.length + (pend ? ' ⏳' : '') : ''}</div></button>`;
}
function viewVisitas() {
  const ini = inicioVacio(); if (ini) return ini;
  const seg = `<div class="seg">${[['toca', 'Toca visitar'], ['seg', 'Seguimientos'], ['ult', 'Últimas']].map(([k, t]) => `<button data-vseg="${k}" aria-pressed="${ui.vSeg === k}">${t}</button>`).join('')}</div>`;
  if (ui.vSeg === 'toca') {
    const fe = fincasEst(), L = ui.vTodas ? fe : fe.filter((x) => x.e.toca);
    return seg + `<div class="toolbar"><button class="chip sm" data-vtodas aria-pressed="${ui.vTodas}">Ver todas las fincas (${fe.length})</button></div>` +
      (L.length ? `<div class="list">${L.map(filaFinca).join('')}</div>` : `<div class="empty">${fe.length ? 'Ninguna finca pasada de plazo 👍' : 'Sin fincas: conecta los maestros en ⚙ Ajustes.'}</div>`);
  }
  if (ui.vSeg === 'seg') {
    const L = AL.seguimientos(state);
    return seg + (L.length ? `<div class="list">${L.map(filaSeg).join('')}</div>` : '<div class="empty">No hay seguimientos pendientes.</div>');
  }
  const L = AL.recientes(state.visitas).slice(0, 60);
  return seg + (L.length ? `<div class="list">${L.map((v) => filaVisita(v)).join('')}</div>` + (state.visitas.length > 60 ? '<p class="small" style="text-align:center">Se muestran las 60 últimas. El resto está en cada ficha de cliente y en la hoja.</p>' : '') : '<div class="empty">Todavía no hay visitas.</div>');
}

/* ----- Tratamientos ----- */
function headTrat() {
  const mes = hoy().slice(0, 7), desde = AL.sumarDias(hoy(), -30);
  return `<div class="kpis three">${kpi('Este mes', state.trat.filter((t) => (t.fecha || '').startsWith(mes)).length)}${kpi('Últimos 30 días', state.trat.filter((t) => t.fecha >= desde).length)}${kpi('Plantillas', state.plantillas.length)}</div>`;
}
function tratTexto(t) { return N([nomCli(t.cli), t.finNom, t.cultivo, t.problema, ...(t.prods || []).map((p) => p.nombre)].join(' ')); }
function filaTrat(t, conCliente = true) {
  const n = (t.prods || []).filter((p) => p.nombre).length;
  return `<button class="row" data-trat="${esc(t.id)}"><div class="main"><div class="name">${esc(conCliente ? nomCli(t.cli) + (t.finNom ? ' · ' + t.finNom : '') : (t.finNom || t.cultivo || 'Tratamiento'))}</div>
    <div class="sub">${esc([t.cultivo, t.problema, plural(n, 'producto', 'productos')].filter(Boolean).join(' · '))}</div></div><div class="side small">${fF(t.fecha)}</div></button>`;
}
function viewTrat() {
  const ini = inicioVacio(); if (ini) return ini;
  const q = N(ui.qT);
  const L = AL.recientes(state.trat).filter((t) => !q || tratTexto(t).includes(q));
  let html = `<div class="toolbar"><input class="grow" type="search" id="qT" placeholder="Buscar cliente, finca, plaga o producto" value="${esc(ui.qT)}">
    <button class="chip sm" data-act="plantillas">Plantillas</button><button class="chip sm" data-act="excel">Excel</button></div>`;
  if (!L.length) return html + `<div class="empty">${state.trat.length ? 'Nada coincide con la búsqueda.' : 'Todavía no hay tratamientos.'}</div>`;
  let mes = '';
  for (const t of L.slice(0, 150)) {
    const m = (t.fecha || '').slice(0, 7);
    if (m !== mes) { if (mes) html += '</div>'; mes = m; html += `<div class="day">${m ? esc(mesLargo(m)) : 'Sin fecha'}</div><div class="list">`; }
    html += filaTrat(t);
  }
  return html + '</div>';
}

/* ----- Clientes: fichas, planes y cobros ----- */
function aniosDisponibles() {
  const ys = Object.keys(state.años).map(Number);
  if (!ys.includes(HOYM().y)) ys.push(HOYM().y);
  return ys.sort((a, b) => a - b);
}
function headClientes() {
  const H = HOYM();
  if (ui.cSeg === 'planes') {
    const s = AL.statsPlanes(state, ui.year, ui.month);
    return `<div class="kpis three">${kpi('Clientes', s.clientes)}${kpi('Planes', s.planes)}${kpi('Enviados · ' + AL.MC[ui.month], s.pct == null ? '—' : Math.round(s.pct * 100) + ' %', s.pct != null && s.pct < 1 ? 'warn' : '')}</div>`;
  }
  if (ui.cSeg === 'cobros') {
    const s = AL.statsCobros(state, ui.year, ui.month, H);
    return `<div class="kpis">${kpi('Cobrado ' + ui.year, eur0(s.cobradoAnio))}${kpi('Media al mes', eur0(s.media))}${kpi('Cobrado en ' + AL.MES[ui.month].toLowerCase(), eur0(s.cobradoMes))}${kpi('Pendiente anual', eur0(s.pendiente), s.pendiente ? 'warn' : '')}</div>`;
  }
  const cs = AL.delAsesor(state).filter((c) => AL.activo(c, hoy()));
  const fe = fincasEst();
  return `<div class="kpis three">${kpi('Clientes', cs.length)}${kpi('Fincas', fe.length)}${kpi('Toca visitar', fe.filter((x) => x.e.toca).length, fe.some((x) => x.e.toca) ? 'warn' : '')}</div>`;
}
function selectorAnio() {
  return `<div class="toolbar"><select id="selYear" style="width:auto;flex:0 0 auto">${aniosDisponibles().map((y) => opt(y, y, y === ui.year)).join('')}<option value="nuevo">+ Año nuevo…</option></select>
    <div class="chips grow" id="meses">${AL.MC.map((n, i) => `<button class="chip sm ${ui.year === HOYM().y && i === HOYM().m ? 'now' : ''}" data-mes="${i}" aria-pressed="${i === ui.month}">${n}</button>`).join('')}</div></div>`;
}
function viewClientes() {
  const ini = inicioVacio(); if (ini) return ini;
  const seg = `<div class="seg">${[['fichas', 'Fichas'], ['planes', 'Planes'], ['cobros', 'Cobros']].map(([k, t]) => `<button data-cseg="${k}" aria-pressed="${ui.cSeg === k}">${t}</button>`).join('')}</div>`;
  if (ui.cSeg === 'fichas') {
    const q = N(ui.qC);
    const L = AL.delAsesor(state).filter((c) => !q || N(c.nombre).includes(q));
    const rows = L.map((c) => {
      const fs = AL.fincasDe(state, IX, c.id);
      const toca = fs.filter((f) => AL.estadoFinca(state, f.id, hoy()).toca).length;
      const u = AL.recientes(state.visitas.filter((v) => v.cli === c.id))[0];
      const baja = !AL.activo(c, hoy());
      return `<button class="row ${baja ? 'dim' : ''}" data-ficha="${esc(c.id)}"><div class="main"><div class="name">${esc(c.nombre)}${baja ? '<span class="tag">baja</span>' : ''}${c.mid ? '' : '<span class="tag" style="background:var(--warn-soft);color:var(--warn)">sin maestro</span>'}</div>
        <div class="sub">${plural(fs.length, 'finca', 'fincas')} · ${u ? 'última visita ' + fF(u.fecha) : 'sin visitas'}</div></div>
        <div class="side">${toca && !baja ? `<div class="neg" style="font-weight:700">${toca}</div><div class="small">toca${toca === 1 ? '' : 'n'}</div>` : ''}</div></button>`;
    }).join('');
    return seg + `<div class="toolbar"><input class="grow" type="search" id="qC" placeholder="Buscar cliente" value="${esc(ui.qC)}"></div>` +
      (rows ? `<div class="list">${rows}</div>` : '<div class="empty">Ningún cliente coincide.</div>');
  }
  if (ui.cSeg === 'planes') {
    const rows = AL.filasPlanes(state, ui.year, ui.month);
    return seg + selectorAnio() + `<p class="small" style="margin:0 2px 8px">Toca el estado para cambiarlo · toca el nombre para abrir la ficha</p>` +
      (rows.length ? `<div class="list">${rows.map((x) => { const st = x.r.env[ui.month] || 'N'; return `<div class="prow"><button class="who" data-ficha="${esc(x.c.id)}"><strong>${esc(x.c.nombre)}</strong><small>${plural(x.r.planes, 'plan', 'planes')}</small></button><button class="estado ${st}" data-env="${esc(x.c.id)}">${AL.ESTADO_TXT[st]}</button></div>`; }).join('')}</div>`
        : '<div class="empty">No hay clientes con planes este mes.</div>');
  }
  const rows = AL.filas(state, ui.year).filter((x) => ui.cobFiltro === 'todos' || (!x.r.cob[ui.month] && AL.enRango(x.c, ui.year, ui.month) && Number(x.r.imp[ui.month]) > 0));
  return seg + selectorAnio() + `<div class="seg" style="max-width:260px">${[['todos', 'Todos'], ['pend', 'Pendientes']].map(([k, t]) => `<button data-cobf="${k}" aria-pressed="${ui.cobFiltro === k}">${t}</button>`).join('')}</div>` +
    (rows.length ? `<div class="list">${rows.map((x) => {
      const fuera = !AL.enRango(x.c, ui.year, ui.month);
      return `<div class="prow ${fuera ? 'off' : ''}"><button class="who" data-ficha="${esc(x.c.id)}"><strong>${esc(x.c.nombre)}${x.c.baja ? '<span class="tag">baja ' + esc(x.c.baja) + '</span>' : ''}</strong><small>${eur(x.r.precio)}/mes · ${plural(x.r.planes, 'plan', 'planes')}</small></button>
        <input class="amt ${x.r.man[ui.month] ? 'man' : ''}" type="text" inputmode="decimal" value="${esc(nf(Number(x.r.imp[ui.month]) || 0, 0, 2))}" data-imp="${esc(x.c.id)}" aria-label="Importe">
        <label class="sw"><input type="checkbox" data-cob="${esc(x.c.id)}" ${x.r.cob[ui.month] ? 'checked' : ''} aria-label="Cobrado"><i></i></label></div>`;
    }).join('')}</div>` : `<div class="empty">${ui.cobFiltro === 'pend' ? 'Nada pendiente este mes 🎉' : 'No hay clientes en ' + ui.year + '.'}</div>`);
}

/* ----- Eventos de la vista ----- */
function wireView() {
  const v = $('#view');
  $$('[data-vseg]', v).forEach((b) => { b.onclick = () => { ui.vSeg = b.dataset.vseg; renderAll(); }; });
  const vt = $('[data-vtodas]', v); if (vt) vt.onclick = () => { ui.vTodas = !ui.vTodas; renderAll(); };
  $$('[data-visfin]', v).forEach((b) => { b.onclick = () => abrirVisitaForm({ cli: b.dataset.cli, fin: b.dataset.visfin }); });
  $$('[data-vis]', v).forEach((b) => { b.onclick = () => abrirVisita(b.dataset.vis); });
  $$('[data-hecho]', v).forEach((b) => { b.onclick = () => marcarHecho(b.dataset.hecho); });
  $$('[data-trat]', v).forEach((b) => { b.onclick = () => abrirTrat(b.dataset.trat); });
  $$('[data-ficha]', v).forEach((b) => { b.onclick = () => abrirFicha(b.dataset.ficha); });
  $$('[data-cseg]', v).forEach((b) => { b.onclick = () => { ui.cSeg = b.dataset.cseg; renderAll(); }; });
  $$('[data-cobf]', v).forEach((b) => { b.onclick = () => { ui.cobFiltro = b.dataset.cobf; renderAll(); }; });
  $$('[data-mes]', v).forEach((b) => { b.onclick = () => { ui.month = +b.dataset.mes; renderAll(); }; });
  $$('[data-act="ajustes"]', v).forEach((b) => { b.onclick = abrirAjustes; });
  const pl = $('[data-act="plantillas"]', v); if (pl) pl.onclick = abrirPlantillas;
  const ex = $('[data-act="excel"]', v); if (ex) ex.onclick = () => exportarExcel(AL.recientes(state.trat).filter((t) => !N(ui.qT) || tratTexto(t).includes(N(ui.qT))), ui.qT || 'todos');
  const meses = $('#meses', v); if (meses) { const on = $('[aria-pressed="true"]', meses); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }
  const sy = $('#selYear', v);
  if (sy) sy.onchange = () => {
    if (sy.value === 'nuevo') {
      const ys = aniosDisponibles(), ny = ys[ys.length - 1] + 1;
      if (confirm('¿Crear la tabla de ' + ny + '? Pasan los clientes que siguen de alta, con sus planes y precio; todo queda en «No enviado» y pendiente de cobro.')) {
        commit((c) => { AL.crearAnio(c, ny); }, { render: false }); ui.year = ny; ui.month = 0;
      }
    } else { ui.year = +sy.value; ui.month = ui.year === HOYM().y ? HOYM().m : (ui.year < HOYM().y ? 11 : 0); }
    renderAll();
  };
  $$('[data-env]', v).forEach((b) => { b.onclick = () => commit((c) => { const r = c.años[ui.year][b.dataset.env]; const cur = r.env[ui.month] || 'N'; r.env[ui.month] = AL.ESTADOS[(AL.ESTADOS.indexOf(cur) + 1) % 3]; }); });
  $$('[data-imp]', v).forEach((i) => { i.onchange = () => { const n = parseNum(i.value); commit((c) => { const r = c.años[ui.year][i.dataset.imp]; r.imp[ui.month] = isFinite(n) ? n : 0; r.man[ui.month] = true; }); }; i.onkeydown = (e) => { if (e.key === 'Enter') i.blur(); }; });
  $$('[data-cob]', v).forEach((i) => { i.onchange = () => commit((c) => { c.años[ui.year][i.dataset.cob].cob[ui.month] = i.checked; }); });
  const qT = $('#qT', v); if (qT) qT.oninput = () => { ui.qT = qT.value; const p = qT.selectionStart; renderAll(); const n = $('#qT'); n.focus(); n.setSelectionRange(p, p); };
  const qC = $('#qC', v); if (qC) qC.oninput = () => { ui.qC = qC.value; const p = qC.selectionStart; renderAll(); const n = $('#qC'); n.focus(); n.setSelectionRange(p, p); };
}
function marcarHecho(id) {
  if (commit((c) => { const v = c.visitas.find((x) => x.id === id); if (v) v.hecho = true; })) { toast('Seguimiento hecho'); redrawSheet(); }
}

/* ---------- Ficha de cliente ---------- */
let fichaVerTodo = { vis: false, trat: false };
function abrirFicha(id, nuevo = true) {
  if (nuevo) fichaVerTodo = { vis: false, trat: false };
  const c = AL.cliente(state, id); if (!c) return;
  const draw = () => {
    const cl = AL.cliente(state, id); if (!cl) { closeSheet(); return; }
    const body = $('.sheet-body', sheetRoot);
    body.innerHTML = fichaHTML(cl);
    wireFicha(body, cl);
  };
  openSheet(c.nombre, '', draw);
  draw();
}
function fichaHTML(c) {
  const h = hoy(), fs = AL.fincasDe(state, IX, c.id);
  const ests = fs.map((f) => ({ f, e: AL.estadoFinca(state, f.id, h) }));
  const toca = ests.filter((x) => x.e.toca).length;
  const vis = AL.recientes(state.visitas.filter((v) => v.cli === c.id));
  const tr = AL.recientes(state.trat.filter((t) => t.cli === c.id));
  const segs = AL.seguimientos(state, c.id);
  const y = HOYM().y, m = HOYM().m, r = (state.años[y] || {})[c.id];
  let html = `<div class="fhead"><div class="kpis">${kpi('Última visita', vis[0] ? fF(vis[0].fecha) + '<small> · ' + esc(vis[0].finNom || '') + '</small>' : 'Ninguna')}${kpi('Fincas que tocan', toca + '<small> de ' + fs.length + '</small>', toca ? 'warn' : '')}</div></div>
    <div class="actions two"><button class="btn primary" data-f="visita">Nueva visita</button><button class="btn" data-f="trat">Nuevo tratamiento</button></div>`;
  html += `<div class="sec"><h3>Fincas (${fs.length})</h3><button data-f="finca">+ Finca</button></div>`;
  html += fs.length ? `<div class="list compact">${ests.map(({ f, e }) => `<button class="mini" data-ffin="${esc(f.id)}"><div><div class="name">${esc(f.nombre)}${f.nueva ? '<span class="tag" style="background:var(--warn-soft);color:var(--warn)">pendiente de alta</span>' : ''}</div><div class="sub">${esc((f.cultivos || []).join(', ') || 'Sin cultivos')}</div></div><div class="side ${e.toca ? 'alerta' : ''}">${esc(e.texto)}</div></button>`).join('')}</div>`
    : `<p class="small">${c.mid ? 'Este cliente no tiene fincas en el maestro.' : 'Cliente sin enlazar con el maestro: sus fincas aparecerán al enlazarlo.'}</p>`;
  if (segs.length) html += `<div class="sec"><h3>Seguimientos (${segs.length})</h3></div><div class="list compact">${segs.map(filaSeg).join('')}</div>`;
  html += `<div class="sec"><h3>Visitas (${vis.length})</h3>${vis.length > 5 ? `<button data-f="vistodas">${fichaVerTodo.vis ? 'Ver menos' : 'Ver todas'}</button>` : ''}</div>`;
  html += vis.length ? `<div class="list compact">${(fichaVerTodo.vis ? vis : vis.slice(0, 5)).map((v) => filaVisita(v, false)).join('')}</div>` : '<p class="small">Sin visitas.</p>';
  html += `<div class="sec"><h3>Tratamientos (${tr.length})</h3>${tr.length > 5 ? `<button data-f="trattodos">${fichaVerTodo.trat ? 'Ver menos' : 'Ver todos'}</button>` : ''}</div>`;
  html += tr.length ? `<div class="list compact">${(fichaVerTodo.trat ? tr : tr.slice(0, 5)).map((t) => filaTrat(t, false)).join('')}</div>` : '<p class="small">Sin tratamientos.</p>';
  html += `<div class="sec"><h3>Planes y cobros ${y}</h3>${r ? '<button data-f="plancob">Editar</button>' : ''}</div>`;
  if (r) {
    let cob = 0, pend = 0;
    for (let i = 0; i < 12; i++) { const imp = Number(r.imp[i]) || 0; if (r.cob[i]) cob += imp; else if (AL.enRango(c, y, i)) pend += imp; }
    html += `<p class="small" style="margin:0 2px 8px">${plural(r.planes, 'plan', 'planes')} · ${eur(r.precio)}/mes · cobrado ${eur(cob)} · pendiente ${eur(pend)}</p>
      <div class="mgrid">${AL.MC.map((n, i) => `<div class="mcell ${i === m ? 'now' : ''}"><b>${n}</b>${r.planes > 0 ? `<div class="e ${r.env[i]}">${{ E: 'Enviado', N: 'Falta', A: 'N/A' }[r.env[i]]}</div>` : ''}<div class="c ${r.cob[i] ? 'si' : ''}">${r.cob[i] ? 'Cobrado' : (AL.enRango(c, y, i) && Number(r.imp[i]) ? eur0(r.imp[i]) : '—')}</div></div>`).join('')}</div>`;
  } else html += `<div class="actions"><button class="btn" data-f="plancob">Añadir a planes y cobros ${y}</button></div>`;
  html += `<div class="sec"><h3>Cliente</h3></div>
    <button class="switch" data-f="ases" role="switch" aria-checked="${!!c.ases}">Mostrar en Asesor<i></i></button>
    <div class="grid2"><label class="fld"><span>Primer mes de asesoramiento</span><input type="month" id="fAlta" value="${esc(c.alta || '')}"></label>
    <label class="fld"><span>Baja (último mes)</span><input type="month" id="fBaja" value="${esc(c.baja || '')}"></label></div>
    <div class="box"><div><span>Maestro de clientes</span><b>${c.mid ? esc(c.mid) : (state.mxPend.some((p) => p.tipo === 'cliente' && p.ref === c.id) ? 'Alta pedida' : 'Sin enlazar')}</b></div></div>
    ${c.mid ? '' : '<div class="actions"><button class="btn" data-f="enlazar">Enlazar con el maestro</button></div>'}`;
  return html;
}
function wireFicha(body, c) {
  const on = (k, fn) => { $$(`[data-f="${k}"]`, body).forEach((b) => { b.onclick = fn; }); };
  on('visita', () => abrirVisitaForm({ cli: c.id }));
  on('trat', () => abrirTratForm({ cli: c.id }));
  on('finca', () => abrirFincaNueva(c.id));
  on('vistodas', () => { fichaVerTodo.vis = !fichaVerTodo.vis; redrawSheet(); });
  on('trattodos', () => { fichaVerTodo.trat = !fichaVerTodo.trat; redrawSheet(); });
  on('plancob', () => abrirPlanCobro(c.id, HOYM().y));
  on('enlazar', () => abrirEnlazarCliente(c.id));
  on('ases', () => { commit((s) => { const x = AL.cliente(s, c.id); x.ases = !x.ases; }); redrawSheet(); toast(AL.cliente(state, c.id).ases ? 'Se muestra en Asesor' : 'Oculto de las listas de Asesor (sus datos se conservan)'); });
  $$('[data-ffin]', body).forEach((b) => { b.onclick = () => abrirVisitaForm({ cli: c.id, fin: b.dataset.ffin }); });
  $$('[data-vis]', body).forEach((b) => { b.onclick = () => abrirVisita(b.dataset.vis); });
  $$('[data-hecho]', body).forEach((b) => { b.onclick = () => marcarHecho(b.dataset.hecho); });
  $$('[data-trat]', body).forEach((b) => { b.onclick = () => abrirTrat(b.dataset.trat); });
  const fa = $('#fAlta', body), fb = $('#fBaja', body);
  fa.onchange = () => commit((s) => { AL.cliente(s, c.id).alta = fa.value || null; });
  fb.onchange = () => commit((s) => { AL.cliente(s, c.id).baja = fb.value || null; });
}

/* Alta de una finca nueva para un cliente (entra en el maestro con Revisar = Sí) */
function abrirFincaNueva(cliId, alGuardar) {
  const c = AL.cliente(state, cliId); if (!c) return;
  let cultivos = [];
  const body = openSheet('Finca nueva · ' + c.nombre, '');
  const draw = () => {
    body.innerHTML = `<label class="fld"><span>Nombre de la finca</span><input id="fnN" type="text" autocomplete="off" value="${esc(($('#fnN', body) || {}).value || '')}"></label>
      <div class="fld"><span>Cultivos</span><div class="chips wrap">${state.cultivos.map((x) => `<button class="chip sm" data-cv="${esc(x)}" aria-pressed="${cultivos.includes(x)}">${esc(x)}</button>`).join('')}</div></div>
      <p class="hint">${mxOn() ? 'Se dará de alta en el maestro de fincas (queda en amarillo para que la revises).' : 'Conecta los maestros para darla de alta allí.'}</p>
      <div class="actions"><button class="btn primary" id="fnG">Guardar finca</button></div>`;
    $$('[data-cv]', body).forEach((b) => { b.onclick = () => { const x = b.dataset.cv; cultivos = cultivos.includes(x) ? cultivos.filter((y) => y !== x) : [...cultivos, x]; draw(); }; });
    $('#fnG', body).onclick = () => {
      const nombre = $('#fnN', body).value.trim();
      if (!nombre) return toast('Escribe el nombre de la finca', true);
      if (AL.buscarFincaCli(state, IX, cliId, nombre)) return toast('Ese cliente ya tiene una finca con ese nombre', true);
      const id = uid('f');
      if (commit((s) => { s.fincasNuevas.push({ id, cli: cliId, nombre, cultivos }); pedirAlta(s, 'finca', id, {}); })) {
        toast('Finca guardada'); refreshMx({});
        if (alGuardar) alGuardar(id); else reopen(() => abrirFicha(cliId));
      }
    };
  };
  draw();
}

/* Planes y cobros de un cliente en un año */
function abrirPlanCobro(cliId, y) {
  const c = AL.cliente(state, cliId); if (!c) return;
  const H = HOYM();
  let r = (state.años[y] || {})[cliId];
  if (!r) {
    const body = openSheet('Planes y cobros ' + y + ' · ' + c.nombre, `
      <div class="grid2"><label class="fld"><span>Planes de abonado</span><input id="pcP" type="text" inputmode="numeric" value="1"></label>
      <label class="fld"><span>Precio/mes (€)</span><input id="pcR" type="text" inputmode="decimal" value="0"></label></div>
      <label class="fld"><span>Primer mes de asesoramiento</span><input type="month" id="pcA" value="${esc(c.alta || AL.ym(y, y === H.y ? H.m : 0))}"></label>
      <div class="actions"><button class="btn primary" id="pcG">Añadir a ${y}</button></div>`);
    $('#pcG', body).onclick = () => {
      const planes = Math.max(0, Math.round(parseNum($('#pcP', body).value) || 0)), precio = Math.max(0, parseNum($('#pcR', body).value) || 0);
      if (commit((s) => { if (!s.años[y]) s.años[y] = {}; s.años[y][cliId] = AL.nuevaFila(planes, precio); const x = AL.cliente(s, cliId); if (!x.alta) x.alta = $('#pcA', body).value || null; })) reopen(() => abrirFicha(cliId));
    };
    return;
  }
  const body = openSheet('Planes y cobros ' + y + ' · ' + c.nombre, `
    <div class="grid2"><label class="fld"><span>Planes de abonado</span><input id="pcP" type="text" inputmode="numeric" value="${r.planes}"></label>
    <label class="fld"><span>Precio/mes (€)</span><input id="pcR" type="text" inputmode="decimal" value="${esc(nf(r.precio, 0, 2))}"></label></div>
    <p class="hint">Al cambiar el precio solo cambian los meses desde ${AL.MES[Math.min(H.m, 11)].toLowerCase()} que no estén cobrados ni editados a mano.</p>
    <div class="ygrid" style="grid-template-columns:40px 96px 1fr 52px">${AL.MC.map((n, i) => `<span>${n}</span><button class="estado ${r.env[i]}" data-pe="${i}" style="height:34px;padding:0 8px;font-size:12.5px">${AL.ESTADO_TXT[r.env[i]]}</button><input class="amt ${r.man[i] ? 'man' : ''}" type="text" inputmode="decimal" data-pi="${i}" value="${esc(nf(Number(r.imp[i]) || 0, 0, 2))}"><label class="sw"><input type="checkbox" data-pc="${i}" ${r.cob[i] ? 'checked' : ''}><i></i></label>`).join('')}</div>
    <div class="actions"><button class="btn primary" id="pcG">Guardar</button><button class="btn danger" id="pcB">Quitar de ${y}</button></div>`);
  const env = r.env.slice();
  $$('[data-pe]', body).forEach((b) => { b.onclick = () => { const i = +b.dataset.pe; env[i] = AL.ESTADOS[(AL.ESTADOS.indexOf(env[i]) + 1) % 3]; b.className = 'estado ' + env[i]; b.textContent = AL.ESTADO_TXT[env[i]]; }; });
  $('#pcG', body).onclick = () => {
    commit((s) => {
      const x = s.años[y][cliId];
      x.planes = Math.max(0, Math.round(parseNum($('#pcP', body).value) || 0));
      x.env = env.slice();
      // Primero los importes tocados a mano y los cobros; luego el precio (que no toca esos meses)
      $$('[data-pi]', body).forEach((i) => { const k = +i.dataset.pi, v = parseNum(i.value); const n = isFinite(v) ? v : 0; if (n !== (Number(x.imp[k]) || 0)) { x.imp[k] = n; x.man[k] = true; } });
      $$('[data-pc]', body).forEach((i) => { x.cob[+i.dataset.pc] = i.checked; });
      const precio = Math.max(0, parseNum($('#pcR', body).value) || 0);
      if (precio !== x.precio) AL.cambiarPrecio(s, cliId, y, precio, H);
    });
    toast('Guardado'); reopen(() => abrirFicha(cliId));
  };
  armDelete($('#pcB', body), () => { commit((s) => { delete s.años[y][cliId]; }); toast('Quitado de ' + y); reopen(() => abrirFicha(cliId)); });
}

/* Enlazar un cliente con una ficha del maestro o pedir su alta */
function abrirEnlazarCliente(cliId, volver) {
  const c = AL.cliente(state, cliId); if (!c) return;
  if (!IX) return toast('Conecta primero los maestros (⚙ Ajustes)', true);
  const usados = new Set(state.clientes.filter((x) => x.mid && x.id !== cliId).map((x) => x.mid));
  const ms = [...IX.cli.values()].filter((m) => MX.norm(m.tipo) !== 'proveedor').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const body = openSheet('Enlazar · ' + c.nombre, `
    <p class="small" style="margin-top:0">Elige su ficha en el maestro de clientes. Si ya la usa otro cliente de Asesor, se unen los dos (visitas, tratamientos, planes y cobros).</p>
    <label class="fld"><span>Ficha del maestro</span><select id="enS"><option value="">Elige…</option>${ms.map((m) => opt(m.id, m.nombre + ' · ' + m.id + (usados.has(m.id) ? ' (ya en Asesor)' : ''), false)).join('')}</select></label>
    <div class="actions"><button class="btn primary" id="enG">Enlazar</button><button class="btn" id="enA">No está: darlo de alta en el maestro</button></div>`);
  $('#enG', body).onclick = () => {
    const mid = $('#enS', body).value; if (!mid) return toast('Elige la ficha', true);
    const m = IX.cli.get(mid);
    const ok = commit((s) => {
      const otro = s.clientes.find((x) => x.mid === mid && x.id !== cliId);
      s.mxPend = s.mxPend.filter((p) => !(p.tipo === 'cliente' && p.ref === cliId));
      if (otro) AL.unirCliente(s, cliId, otro.id); else { const x = AL.cliente(s, cliId); x.mid = mid; x.nombre = m.nombre; }
      AL.aplicarMaestros(s, IX, uid);
    });
    if (!ok) return;
    toast('Enlazado'); const dest = state.clientes.find((x) => x.mid === mid);
    reopen(() => (volver ? volver() : abrirFicha(dest.id)));
  };
  $('#enA', body).onclick = () => {
    if (!mxOn()) return toast('Conecta primero los maestros', true);
    commit((s) => {
      pedirAlta(s, 'cliente', cliId, { nombre: c.nombre, tipo: 'Cliente', servicios: ['Asesoría'] });
      s.fincasNuevas.filter((f) => f.cli === cliId).forEach((f) => pedirAlta(s, 'finca', f.id, {})); // sus fincas, detrás
    });
    toast('Alta pedida'); refreshMx({}); reopen(() => (volver ? volver() : abrirFicha(cliId)));
  };
}

/* ---------- Selector de cliente (visita y tratamiento) ---------- */
function opcionesCliente(sel) {
  const ases = AL.delAsesor(state).filter((c) => AL.activo(c, hoy()) || c.id === sel);
  const usados = new Set(state.clientes.map((c) => c.mid).filter(Boolean));
  const otros = IX ? [...IX.cli.values()].filter((m) => !usados.has(m.id) && !MX.deBaja(m) && MX.norm(m.tipo) !== 'proveedor').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) : [];
  const ocultos = state.clientes.filter((c) => !c.ases && c.id !== sel).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return `<option value="">Elige un cliente…</option><optgroup label="Clientes de Asesor">${ases.map((c) => opt(c.id, c.nombre, c.id === sel)).join('')}</optgroup>` +
    (ocultos.length || otros.length ? `<optgroup label="Otros clientes del maestro">${ocultos.map((c) => opt(c.id, c.nombre, false)).join('')}${otros.map((m) => opt('mx:' + m.id, m.nombre, sel === 'mx:' + m.id)).join('')}</optgroup>` : '') +
    `<option value="__nuevo"${sel === '__nuevo' ? ' selected' : ''}>+ Cliente nuevo…</option>`;
}
/* Convierte la elección del desplegable en un cliente de Asesor (dentro de commit) */
function resolverCliente(s, val, nombreNuevo) {
  if (val === '__nuevo') {
    const nombre = String(nombreNuevo || '').trim(); if (!nombre) throw new Error('Escribe el nombre del cliente nuevo');
    const m = IX ? MX.buscarCliente(IX, nombre) : null;
    let c = m ? s.clientes.find((x) => x.mid === m.id) : s.clientes.find((x) => N(x.nombre) === N(nombre));
    if (c) { c.ases = true; return c.id; }
    c = { id: uid('c'), mid: m ? m.id : null, nombre: m ? m.nombre : nombre, ases: true, alta: hoy().slice(0, 7), baja: null };
    s.clientes.push(c);
    if (!m) pedirAlta(s, 'cliente', c.id, { nombre, tipo: 'Cliente', servicios: ['Asesoría'] });
    return c.id;
  }
  if (val.startsWith('mx:')) {
    const mid = val.slice(3), m = IX && IX.cli.get(mid);
    let c = s.clientes.find((x) => x.mid === mid);
    if (!c) { c = { id: uid('c'), mid, nombre: m ? m.nombre : mid, ases: true, alta: hoy().slice(0, 7), baja: null }; s.clientes.push(c); }
    c.ases = true; return c.id;
  }
  const c = AL.cliente(s, val); if (!c) throw new Error('Elige el cliente');
  c.ases = true; return c.id;
}

/* ---------- Formulario de visita ---------- */
let fv = null;
const nuevoBorrador = () => ({ id: null, fecha: hoy(), cli: '', cliNuevo: '', fin: '', finNuevo: '', cultivos: [], vis: {}, sel: {}, añadidos: [], obs: '', accion: '', seg: '', fotos: [], hecho: false });
function guardarBorrador() {
  if (!fv || fv.id || !fv.tocado) return;
  const c = { ...fv, fotos: [] };
  dbSet('borrador', c).catch(() => {});
}
async function abrirVisitaForm({ cli = '', fin = '', visita = null } = {}) {
  let restaurado = false;
  if (visita) {
    fv = { ...nuevoBorrador(), id: visita.id, fecha: visita.fecha, cli: visita.cli, fin: visita.fin, finNomPrev: visita.finNom || '', obs: visita.obs || '', accion: visita.accion || '', seg: visita.seg || '', hecho: !!visita.hecho, fotos: (visita.fotos || []).map((f) => ({ ...f })) };
    cargarFinca(fv, visita.fin);
    for (const cv of visita.cultivos) { if (!fv.cultivos.some((x) => N(x) === N(cv.c))) fv.cultivos.push(cv.c); fv.sel[cv.c] = { fen: cv.fen || '', plagas: { ...(cv.plagas || {}) } }; }
    fv.cultivos.forEach((x) => { fv.vis[x] = visita.cultivos.some((cv) => N(cv.c) === N(x)); });
    for (const f of fv.fotos) if (!f.url) { const g = await fotoGet(f.k).catch(() => null); if (g) f.preview = 'data:' + g.mime + ';base64,' + g.base64; }
  } else {
    const b = (!cli && !fin) ? await dbGet('borrador').catch(() => null) : null;
    if (b && b.tocado && (b.cli || b.fin)) { fv = { ...nuevoBorrador(), ...b, fotos: [] }; restaurado = true; }
    else {
      fv = nuevoBorrador();
      if (fin) { const f = AL.finca(state, IX, fin); fv.cli = (f && f.cli) || cli; cargarFinca(fv, fin); } else fv.cli = cli;
      dbDel('borrador').catch(() => {});
    }
  }
  fv.restaurado = restaurado;
  openSheet(visita ? 'Editar visita' : 'Nueva visita', '', dibujarVisitaForm);
  dibujarVisitaForm();
}
function cargarFinca(b, finId) {
  b.fin = finId || ''; b.finNuevo = ''; b.cultivos = []; b.vis = {}; b.sel = {}; b.añadidos = [];
  const f = finId ? AL.finca(state, IX, finId) : null;
  if (f) b.cultivos = (f.cultivos || []).slice();
  asegurarSel(b);
}
function asegurarSel(b) { b.cultivos.forEach((c) => { if (!b.sel[c]) b.sel[c] = { fen: '', plagas: {} }; if (b.vis[c] === undefined) b.vis[c] = true; }); }

function dibujarVisitaForm() {
  const body = $('.sheet-body', sheetRoot); if (!body || !fv) return;
  const cliReal = fv.cli && !fv.cli.startsWith('mx:') && fv.cli !== '__nuevo' ? fv.cli : null;
  const fincas = cliReal ? AL.fincasDe(state, IX, cliReal) : [];
  if (fv.fin && fv.fin !== '__nuevo' && !fincas.some((f) => f.id === fv.fin)) fincas.push({ id: fv.fin, nombre: fv.finNomPrev || (AL.finca(state, IX, fv.fin) || {}).nombre || fv.fin, cultivos: [] });
  const finSel = fv.fin && fincas.some((f) => f.id === fv.fin) ? fv.fin : (fv.fin === '__nuevo' ? '__nuevo' : '');
  const fObj = finSel && finSel !== '__nuevo' ? (AL.finca(state, IX, finSel) || { id: finSel, nombre: fv.finNomPrev || finSel, cultivos: [] }) : null;
  const est = fObj ? AL.estadoFinca(state, fObj.id, hoy()) : null;
  const hayCli = !!fv.cli;
  const resto = state.cultivos.filter((c) => !fv.cultivos.some((x) => N(x) === N(c)));
  body.innerHTML = `
    ${fv.restaurado ? '<div class="banner"><span>Has recuperado una visita sin terminar.</span><button class="btn" id="vfDesc">Descartar</button></div>' : ''}
    <label class="fld"><span>Fecha</span><input type="date" id="vfFecha" value="${esc(fv.fecha)}"></label>
    <label class="fld"><span>Cliente</span><select id="vfCli">${opcionesCliente(fv.cli)}</select></label>
    ${fv.cli === '__nuevo' ? `<label class="fld"><span>Nombre del cliente nuevo</span><input type="text" id="vfCliN" autocomplete="off" value="${esc(fv.cliNuevo)}"></label>` : ''}
    <label class="fld"><span>Finca</span><select id="vfFin" ${hayCli ? '' : 'disabled'}><option value="">${hayCli ? 'Elige una finca…' : 'Primero elige el cliente'}</option>${fincas.map((f) => opt(f.id, f.nombre, f.id === finSel)).join('')}${hayCli ? opt('__nuevo', '+ Finca nueva…', finSel === '__nuevo') : ''}</select></label>
    ${finSel === '__nuevo' ? `<label class="fld"><span>Nombre de la finca nueva</span><input type="text" id="vfFinN" autocomplete="off" value="${esc(fv.finNuevo)}"></label>` : ''}
    ${est ? `<p class="hint">Última visita: ${est.ultima ? fF(est.ultima.fecha) + ' (' + esc(est.texto) + ')' : 'ninguna'}.</p>` : ''}
    ${fv.cultivos.map((c) => bloqueCultivo(c)).join('')}
    ${(fObj || finSel === '__nuevo') ? `<label class="fld"><span>${fv.cultivos.length ? 'Añadir otro cultivo a la finca' : 'Cultivos de la finca'}</span><select id="vfAddC"><option value="">Añadir cultivo…</option>${resto.map((c) => opt(c, c, false)).join('')}</select></label>` : ''}
    <label class="fld"><span>Observaciones generales</span><textarea class="inp" id="vfObs" placeholder="Lo que has visto en la finca">${esc(fv.obs)}</textarea></label>
    <label class="fld"><span>Acción pendiente</span><input type="text" id="vfAcc" autocomplete="off" placeholder="Ej. Volver a mirar el riego del sector 2" value="${esc(fv.accion)}"></label>
    <label class="fld"><span>Fecha de seguimiento</span><input type="date" id="vfSeg" value="${esc(fv.seg)}"></label>
    <div class="quick">${[7, 15, 30].map((n) => `<button class="chip" data-sum="${n}">+${n} días</button>`).join('')}</div>
    <div class="fld"><span>Fotos (máx. 8)</span></div>
    <div class="thumbs">${fv.fotos.map((f, i) => `<div class="thumb">${f.preview ? `<img src="${f.preview}" alt="">` : (f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" style="display:grid;place-items:center;height:100%;font-size:12px">Ver en Drive</a>` : '')}<button data-qf="${i}" aria-label="Quitar">×</button>${f.url ? '' : '<span class="pend">por subir</span>'}</div>`).join('')}
      ${fv.fotos.length < 8 ? '<label class="filebtn">📷 Añadir<input type="file" id="vfFotos" accept="image/*" multiple></label>' : ''}</div>
    <div class="actions"><button class="btn primary" id="vfG">${fv.id ? 'Guardar cambios' : 'Guardar visita'}</button></div>`;
  wireVisitaForm(body);
}
function bloqueCultivo(c) {
  const s = fv.sel[c] || { fen: '', plagas: {} };
  const on = fv.vis[c] !== false;
  const plagas = AL.ordenPlagas(state, c);
  return `<div class="cbloque ${on ? '' : 'off'}"><div class="cab"><b>${esc(c)}</b><button class="switch" data-vc="${esc(c)}" role="switch" aria-checked="${on}">visitado<i></i></button></div>
    <div class="cuerpo">
      <label class="fld"><span>Estado fenológico</span><select data-fen="${esc(c)}"><option value="">Sin indicar</option>${state.fenologias.map((f) => opt(f.nombre, f.nombre, N(f.nombre) === N(s.fen))).join('')}</select></label>
      <div class="nueva"><input type="text" data-nfen="${esc(c)}" placeholder="Nuevo estado fenológico"><button class="btn" data-addfen="${esc(c)}">Añadir</button></div>
      <div class="fld" style="margin-top:14px"><span>Plagas y enfermedades · toca para subir el nivel (leve, media, alta, quitar)</span></div>
      <div class="chips wrap">${plagas.map((p) => { const n = s.plagas[p.nombre] || ''; return `<button class="chip sm ${n ? 'nivel-' + n : ''}" data-pl="${esc(p.nombre)}" data-c="${esc(c)}">${esc(p.nombre)}${n ? ' · ' + n : ''}</button>`; }).join('') || '<span class="small">Aún no hay ninguna. Añade la primera.</span>'}</div>
      <div class="nueva"><input type="text" data-nplaga="${esc(c)}" placeholder="Nueva plaga o enfermedad"><button class="btn" data-addplaga="${esc(c)}">Añadir</button></div>
    </div></div>`;
}
function wireVisitaForm(body) {
  const toque = () => { fv.tocado = true; guardarBorrador(); };
  body.addEventListener('input', () => { fv.tocado = true; }, { once: true });
  const d = $('#vfDesc', body); if (d) d.onclick = () => { dbDel('borrador').catch(() => {}); fv = nuevoBorrador(); dibujarVisitaForm(); };
  $('#vfFecha', body).onchange = (e) => { fv.fecha = e.target.value; toque(); };
  $('#vfCli', body).onchange = (e) => { fv.cli = e.target.value; cargarFinca(fv, ''); toque(); redrawSheet(); };
  const cn = $('#vfCliN', body); if (cn) cn.oninput = (e) => { fv.cliNuevo = e.target.value; toque(); };
  $('#vfFin', body).onchange = (e) => { const v = e.target.value; if (v === '__nuevo') { cargarFinca(fv, ''); fv.fin = '__nuevo'; } else cargarFinca(fv, v); toque(); redrawSheet(); };
  const fn = $('#vfFinN', body); if (fn) fn.oninput = (e) => { fv.finNuevo = e.target.value; toque(); };
  const ac = $('#vfAddC', body); if (ac) ac.onchange = (e) => { const c = e.target.value; if (!c) return; fv.cultivos.push(c); fv.añadidos.push(c); asegurarSel(fv); toque(); redrawSheet(); };
  $('#vfObs', body).oninput = (e) => { fv.obs = e.target.value; toque(); };
  $('#vfAcc', body).oninput = (e) => { fv.accion = e.target.value; toque(); };
  $('#vfSeg', body).onchange = (e) => { fv.seg = e.target.value; toque(); };
  $$('[data-sum]', body).forEach((b) => { b.onclick = () => { fv.seg = AL.sumarDias(fv.fecha || hoy(), +b.dataset.sum); $('#vfSeg', body).value = fv.seg; toque(); }; });
  $$('[data-vc]', body).forEach((b) => { b.onclick = () => { const c = b.dataset.vc; fv.vis[c] = fv.vis[c] === false; toque(); redrawSheet(); }; });
  $$('[data-fen]', body).forEach((s) => { s.onchange = () => { fv.sel[s.dataset.fen].fen = s.value; toque(); }; });
  $$('[data-pl]', body).forEach((b) => {
    b.onclick = () => {
      const s = fv.sel[b.dataset.c], p = b.dataset.pl;
      const sig = AL.NIVELES[(AL.NIVELES.indexOf(s.plagas[p] || '') + 1) % AL.NIVELES.length];
      if (sig) s.plagas[p] = sig; else delete s.plagas[p];
      toque(); redrawSheet();
    };
  });
  $$('[data-addplaga]', body).forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.addplaga, inp = $(`[data-nplaga="${CSS.escape(c)}"]`, body);
      const n = AL.limpiar(inp.value); if (!n) return;
      commit((s) => { AL.altaPlaga(s, n); }, { render: false });
      const p = state.plagas.find((x) => N(x.nombre) === N(n));
      fv.sel[c].plagas[p.nombre] = fv.sel[c].plagas[p.nombre] || 'leve'; toque(); redrawSheet();
    };
  });
  $$('[data-addfen]', body).forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.addfen, inp = $(`[data-nfen="${CSS.escape(c)}"]`, body);
      const n = AL.limpiar(inp.value); if (!n) return;
      commit((s) => { AL.altaFen(s, n); }, { render: false });
      fv.sel[c].fen = state.fenologias.find((x) => N(x.nombre) === N(n)).nombre; toque(); redrawSheet();
    };
  });
  $$('[data-qf]', body).forEach((b) => { b.onclick = () => { fv.fotos.splice(+b.dataset.qf, 1); redrawSheet(); }; });
  const fi = $('#vfFotos', body);
  if (fi) fi.onchange = async () => {
    const files = Array.from(fi.files || []).slice(0, 8 - fv.fotos.length);
    for (const f of files) { try { const r = await comprimir(f); fv.fotos.push({ k: uid('ft'), preview: r.preview, base64: r.base64, mime: r.mime, nueva: true }); } catch (_) { toast('Una foto no se pudo leer', true); } }
    fv.tocado = true; redrawSheet();
  };
  $('#vfG', body).onclick = guardarVisita;
}
function comprimir(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const max = 1280, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL('image/jpeg', 0.72); URL.revokeObjectURL(url);
      res({ mime: 'image/jpeg', base64: d.split(',')[1], preview: d });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagen')); };
    img.src = url;
  });
}
async function guardarVisita() {
  const b = fv;
  if (!b.cli) return toast('Elige el cliente', true);
  if (b.cli === '__nuevo' && !b.cliNuevo.trim()) return toast('Escribe el nombre del cliente nuevo', true);
  if (!b.fin || (b.fin === '__nuevo' && !b.finNuevo.trim())) return toast('Elige la finca o escribe el nombre de la nueva', true);
  const cvis = b.cultivos.filter((c) => b.vis[c] !== false);
  if (!cvis.length) return toast('Marca al menos un cultivo visitado (añade los cultivos de la finca si no tiene)', true);
  if (/https?:\/\/|script\.google\.com/i.test(b.accion)) return toast('En «Acción pendiente» hay un enlace: escribe solo lo que hay que revisar', true);
  const nuevas = b.fotos.filter((f) => f.nueva);
  const vid = b.id || uid('v');
  try { for (const f of nuevas) await fotoPut({ k: f.k, vid, mime: f.mime, base64: f.base64 }); }
  catch (e) { return toast('No se pudieron guardar las fotos en el móvil: ' + (e.message || e), true); }
  const ok = commit((s) => {
    const cli = resolverCliente(s, b.cli, b.cliNuevo);
    let fin = b.fin;
    if (fin === '__nuevo') {
      fin = AL.buscarFincaCli(s, IX, cli, b.finNuevo);
      if (!fin) { fin = uid('f'); s.fincasNuevas.push({ id: fin, cli, nombre: b.finNuevo.trim(), cultivos: b.cultivos.slice() }); pedirAlta(s, 'finca', fin, {}); }
    }
    const f = AL.finca(s, IX, fin);
    // Cultivos añadidos a la finca
    const faltan = b.cultivos.filter((c) => !(f && f.cultivos.some((x) => N(x) === N(c))));
    if (faltan.length) {
      const nv = s.fincasNuevas.find((x) => x.id === fin);
      if (nv) nv.cultivos = AL.uniq([...(nv.cultivos || []), ...faltan]);
      else {
        s.cultivosExtra[fin] = AL.uniq([...(s.cultivosExtra[fin] || []), ...faltan]);
        const m = IX && IX.fin.get(fin);
        if (m) pedirAlta(s, 'cultivo', fin, { nombre: m.nombre, clienteId: m.clienteId, clienteNombre: nomCliS(s, cli), cultivos: AL.uniq([...(m.cultivos || []), ...s.cultivosExtra[fin]]) });
      }
    }
    const v = {
      id: vid, fecha: b.fecha || hoy(), cli, fin, finNom: f ? f.nombre : (b.finNuevo.trim() || b.finNomPrev || ''),
      cultivos: cvis.map((c) => ({ c, fen: (b.sel[c] || {}).fen || '', plagas: { ...((b.sel[c] || {}).plagas || {}) } })),
      obs: b.obs.trim(), accion: b.accion.trim(), seg: b.accion.trim() ? b.seg : '', hecho: b.accion.trim() ? !!b.hecho : false,
      fotos: b.fotos.map((x) => (x.url ? { k: x.k, url: x.url } : { k: x.k, url: null })), ts: Date.now(),
    };
    const i = s.visitas.findIndex((x) => x.id === vid);
    if (i > -1) { v.ts = s.visitas[i].ts; v.origen = s.visitas[i].origen; s.visitas[i] = v; }
    else {
      s.visitas.push(v);
      v.cultivos.forEach((cv) => {
        Object.keys(cv.plagas).forEach((n) => { const p = AL.altaPlaga(s, n); p.usos[cv.c] = (p.usos[cv.c] || 0) + 1; });
        if (cv.fen) { const fe = AL.altaFen(s, cv.fen); fe.usos = (fe.usos || 0) + 1; }
      });
    }
  });
  if (!ok) { for (const f of nuevas) await fotoDel(f.k).catch(() => {}); return; }
  // Fotos quitadas al editar: fuera de la cola
  const quedan = new Set(b.fotos.map((f) => f.k));
  for (const f of await fotoTodas().catch(() => [])) if (f.vid === vid && !quedan.has(f.k)) await fotoDel(f.k).catch(() => {});
  dbDel('borrador').catch(() => {});
  fv = null;
  await contarFotos();
  toast(b.id ? 'Visita actualizada' : 'Visita guardada (' + plural(cvis.length, 'cultivo', 'cultivos') + ')');
  closeSheet(); refreshMx({}); runSync();
  if (b.id) setTimeout(() => abrirVisita(vid), 60);
}
const nomCliS = (s, id) => { const c = AL.cliente(s, id); return c ? c.nombre : ''; };

/* ---------- Detalle de una visita ---------- */
async function abrirVisita(id) {
  const v = state.visitas.find((x) => x.id === id); if (!v) return;
  const prev = {};
  for (const f of v.fotos || []) if (!f.url) { const g = await fotoGet(f.k).catch(() => null); if (g) prev[f.k] = 'data:' + g.mime + ';base64,' + g.base64; }
  const draw = () => {
    const x = state.visitas.find((y) => y.id === id); if (!x) { closeSheet(); return; }
    const body = $('.sheet-body', sheetRoot);
    body.innerHTML = `<div class="box"><div><span>Fecha</span><b>${fF(x.fecha)}</b></div><div><span>Cliente</span><b>${esc(nomCli(x.cli))}</b></div><div><span>Finca</span><b>${esc(x.finNom || '')}</b></div></div>
      ${x.cultivos.map((cv) => `<div class="cbloque"><div class="cab"><b>${esc(cv.c)}</b><span class="small">${esc(cv.fen || 'Fenología sin indicar')}</span></div>
        <div class="chips wrap" style="margin-top:8px">${Object.keys(cv.plagas || {}).map((n) => `<span class="chip sm nivel-${cv.plagas[n]}" style="display:inline-flex;align-items:center">${esc(n)} · ${cv.plagas[n]}</span>`).join('') || '<span class="small">Sin plagas anotadas</span>'}</div></div>`).join('')}
      ${x.obs ? `<h3>Observaciones</h3><p style="white-space:pre-wrap;margin-top:0">${esc(x.obs)}</p>` : ''}
      ${x.accion ? `<h3>Acción pendiente</h3><div class="mini ${x.hecho ? '' : (x.seg && x.seg < hoy() ? 'vencido' : '')}"><div><div class="name">${esc(x.accion)}</div><div class="sub fecha">${x.hecho ? 'Hecho' : (x.seg ? 'Para el ' + fF(x.seg) : 'Sin fecha')}</div></div>${x.hecho ? '<span class="pill ok">Hecho</span>' : `<button class="paid" data-hecho="${esc(x.id)}">Hecho</button>`}</div>` : ''}
      ${(x.fotos || []).length ? `<h3>Fotos</h3><div class="thumbs">${x.fotos.map((f) => `<div class="thumb">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" style="display:grid;place-items:center;height:100%;font-size:12px;text-align:center">Ver en Drive</a>` : (prev[f.k] ? `<img src="${prev[f.k]}" alt=""><span class="pend">por subir</span>` : '<span class="pend">por subir</span>')}</div>`).join('')}</div>` : ''}
      ${x.fotosAntes ? `<p class="small">Esta visita tenía ${plural(x.fotosAntes, 'foto', 'fotos')} en la app Visitas (están en su carpeta de Drive).</p>` : ''}
      <div class="actions two" style="margin-top:14px"><button class="btn" id="vdE">Editar</button><button class="btn" id="vdF">Ficha del cliente</button></div>
      <div class="actions"><button class="btn" id="vdT">Nuevo tratamiento para esta finca</button><button class="btn danger" id="vdB">Borrar visita</button></div>`;
    $$('[data-hecho]', body).forEach((b) => { b.onclick = () => marcarHecho(b.dataset.hecho); });
    $('#vdE', body).onclick = () => reopen(() => abrirVisitaForm({ visita: x }));
    $('#vdF', body).onclick = () => reopen(() => abrirFicha(x.cli));
    $('#vdT', body).onclick = () => reopen(() => abrirTratForm({ cli: x.cli, fin: x.fin, cultivo: x.cultivos.length === 1 ? x.cultivos[0].c : '', problema: x.cultivos.flatMap((cv) => Object.keys(cv.plagas || {})).filter((n, i, a) => a.indexOf(n) === i).join(', ') }));
    armDelete($('#vdB', body), async () => {
      commit((s) => { s.visitas = s.visitas.filter((y) => y.id !== id); });
      for (const f of await fotoTodas().catch(() => [])) if (f.vid === id) await fotoDel(f.k).catch(() => {});
      await contarFotos(); closeSheet(); toast('Visita borrada');
    }, 'Borrar visita');
  };
  openSheet('Visita · ' + (v.finNom || ''), '', draw);
  draw();
}

/* ---------- Formulario de tratamiento ---------- */
let ft = null;
const prodVacio = () => ({ nombre: '', tipo: 'otro', dv: '', du: 'L' });
function abrirTratForm({ cli = '', fin = '', cultivo = '', problema = '', base = null, editar = false } = {}) {
  ft = { id: null, fecha: hoy(), cli, cliNuevo: '', fin: fin || '', finTxt: '', cultivo, problema, plazo: '', prods: [prodVacio()], cond: '', obs: '' };
  if (base) {
    ft = { ...ft, finNomPrev: base.finNom || '', cli: base.cli || ft.cli, fin: base.fin || (base.finNom ? '__otra' : ''), finTxt: base.fin ? '' : (base.finNom || ''), cultivo: base.cultivo || '', problema: base.problema || '',
      plazo: base.plazo || '', prods: (base.prods || []).map((p) => ({ ...p })), cond: base.cond || '', obs: base.obs || '' };
    if (!ft.prods.length) ft.prods = [prodVacio()];
    if (editar) { ft.id = base.id; ft.fecha = base.fecha || hoy(); }
  }
  if (ft.fin && ft.fin !== '__otra' && !ft.cli) { const f = AL.finca(state, IX, ft.fin); if (f) ft.cli = f.cli || ''; }
  openSheet(editar ? 'Editar tratamiento' : 'Nuevo tratamiento', '', dibujarTratForm);
  dibujarTratForm();
}
function dibujarTratForm() {
  const body = $('.sheet-body', sheetRoot); if (!body || !ft) return;
  const cliReal = ft.cli && !ft.cli.startsWith('mx:') && ft.cli !== '__nuevo' ? ft.cli : null;
  const fincas = cliReal ? AL.fincasDe(state, IX, cliReal) : [];
  if (ft.fin && ft.fin !== '__otra' && !fincas.some((f) => f.id === ft.fin)) { const f = AL.finca(state, IX, ft.fin); if (f) fincas.push(f); else { ft.finTxt = ft.finTxt || ft.finNomPrev || ''; ft.fin = '__otra'; } }
  const fObj = ft.fin && ft.fin !== '__otra' ? fincas.find((f) => f.id === ft.fin) : null;
  const cultivos = AL.uniq([...(fObj ? fObj.cultivos : []), ...state.cultivos]);
  body.innerHTML = `
    ${state.plantillas.length ? `<label class="fld"><span>Cargar plantilla</span><select id="tfPl"><option value="">— Elegir plantilla —</option>${state.plantillas.map((p, i) => opt(i, p.nombre, false)).join('')}</select></label>` : ''}
    <label class="fld"><span>Cliente</span><select id="tfCli">${opcionesCliente(ft.cli)}</select></label>
    ${ft.cli === '__nuevo' ? `<label class="fld"><span>Nombre del cliente nuevo</span><input type="text" id="tfCliN" autocomplete="off" value="${esc(ft.cliNuevo)}"></label>` : ''}
    <div class="grid2"><label class="fld"><span>Finca / parcela</span><select id="tfFin"><option value="">(sin finca)</option>${fincas.map((f) => opt(f.id, f.nombre, f.id === ft.fin)).join('')}${opt('__otra', 'Otra (escribir)…', ft.fin === '__otra')}</select></label>
    <label class="fld"><span>Fecha</span><input type="date" id="tfFecha" value="${esc(ft.fecha)}"></label></div>
    ${ft.fin === '__otra' ? `<label class="fld"><span>Finca o parcela (texto)</span><input type="text" id="tfFinT" autocomplete="off" value="${esc(ft.finTxt)}"></label>` : ''}
    <label class="fld"><span>Cultivo</span><input type="text" id="tfCult" list="dlCult" autocomplete="off" placeholder="Ej. Limonero Fino 49" value="${esc(ft.cultivo)}"></label>
    <datalist id="dlCult">${cultivos.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label class="fld"><span>Plaga / enfermedad / problema</span><input type="text" id="tfProb" list="dlPlagas" autocomplete="off" placeholder="Ej. Araña roja" value="${esc(ft.problema)}"></label>
    <datalist id="dlPlagas">${state.plagas.map((p) => `<option value="${esc(p.nombre)}">`).join('')}</datalist>
    <label class="fld"><span>Plazo de seguridad</span><input type="text" id="tfPlazo" autocomplete="off" placeholder="Ej. 15 días" value="${esc(ft.plazo)}"></label>
    <h3>Productos · dosis /1000 L de caldo</h3>
    <div id="tfProds">${ft.prods.map((p, i) => filaProd(p, i)).join('')}</div>
    <datalist id="dlProd">${state.productos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((p) => `<option value="${esc(p.nombre)}">`).join('')}</datalist>
    <div class="actions" style="margin-bottom:14px"><button class="btn" id="tfAddP">+ Añadir producto</button></div>
    <label class="fld"><span>Condiciones de aplicación</span><textarea class="inp" id="tfCond" placeholder="Ej. Aplicar con temperaturas suaves, evitar horas centrales y viento de más de 15 km/h">${esc(ft.cond)}</textarea></label>
    <label class="fld"><span>Observaciones</span><textarea class="inp" id="tfObs" placeholder="Notas para el cliente">${esc(ft.obs)}</textarea></label>
    <div class="actions"><button class="btn primary" id="tfG">${ft.id ? 'Guardar cambios' : 'Guardar y crear imagen'}</button><button class="btn" id="tfV">Vista previa</button></div>
    <details class="more"><summary>Guardar como plantilla</summary>
      <label class="fld" style="margin-top:8px"><span>Nombre de la plantilla</span><input type="text" id="tfPlN" autocomplete="off" placeholder="Ej. Otoño piojo blanco"></label>
      <div class="actions"><button class="btn" id="tfPlG">Guardar plantilla</button></div></details>
    <div id="tfPrev" style="margin-top:14px"></div>`;
  wireTratForm(body);
}
function filaProd(p, i) {
  return `<div class="prod" data-i="${i}"><div class="l1"><span class="num">${i + 1}</span><input type="text" data-pn="${i}" list="dlProd" autocomplete="off" placeholder="Nombre comercial" value="${esc(p.nombre)}"><button class="quitar" data-pq="${i}" aria-label="Quitar">×</button></div>
    <div class="l2"><select data-pt="${i}">${AL.FORM_TYPES.map((t) => opt(t.v, t.label, t.v === p.tipo)).join('')}</select>
    <input type="text" inputmode="decimal" data-pd="${i}" placeholder="Dosis" value="${esc(p.dv)}"><select data-pu="${i}">${AL.UNIDADES.map((u) => opt(u, u, u === AL.unidad(p.du))).join('')}</select></div></div>`;
}
function leerTratForm(body) {
  ft.fecha = $('#tfFecha', body).value; ft.cultivo = $('#tfCult', body).value; ft.problema = $('#tfProb', body).value; ft.plazo = $('#tfPlazo', body).value;
  ft.cond = $('#tfCond', body).value; ft.obs = $('#tfObs', body).value;
  const cn = $('#tfCliN', body); if (cn) ft.cliNuevo = cn.value;
  const fn = $('#tfFinT', body); if (fn) ft.finTxt = fn.value;
  ft.prods = ft.prods.map((p, i) => ({ nombre: $(`[data-pn="${i}"]`, body).value.trim(), tipo: $(`[data-pt="${i}"]`, body).value, dv: $(`[data-pd="${i}"]`, body).value.trim(), du: $(`[data-pu="${i}"]`, body).value }));
}
function wireTratForm(body) {
  const pl = $('#tfPl', body);
  if (pl) pl.onchange = () => {
    const p = state.plantillas[+pl.value]; if (!p) return;
    leerTratForm(body);
    Object.assign(ft, { cultivo: p.cultivo || ft.cultivo, problema: p.problema || '', plazo: p.plazo || '', cond: p.cond || '', obs: p.obs || '', prods: (p.prods || []).map((x) => ({ ...x })) });
    if (!ft.prods.length) ft.prods = [prodVacio()];
    redrawSheet(); toast('Plantilla «' + p.nombre + '» cargada');
  };
  $('#tfCli', body).onchange = (e) => { leerTratForm(body); ft.cli = e.target.value; ft.fin = ''; ft.finTxt = ''; redrawSheet(); };
  $('#tfFin', body).onchange = (e) => {
    leerTratForm(body); ft.fin = e.target.value;
    const f = ft.fin && ft.fin !== '__otra' ? AL.finca(state, IX, ft.fin) : null;
    if (f && f.cultivos.length === 1 && !ft.cultivo) ft.cultivo = f.cultivos[0];
    redrawSheet();
  };
  $$('[data-pn]', body).forEach((inp) => {
    inp.onchange = () => {
      const m = state.productos.find((p) => N(p.nombre) === N(inp.value));
      if (m && m.tipo) $(`[data-pt="${inp.dataset.pn}"]`, body).value = m.tipo;
    };
  });
  $$('[data-pq]', body).forEach((b) => { b.onclick = () => { leerTratForm(body); ft.prods.splice(+b.dataset.pq, 1); if (!ft.prods.length) ft.prods = [prodVacio()]; redrawSheet(); }; });
  $('#tfAddP', body).onclick = () => { leerTratForm(body); ft.prods.push(prodVacio()); redrawSheet(); setTimeout(() => { const n = $(`[data-pn="${ft.prods.length - 1}"]`); if (n) n.focus(); }, 30); };
  $('#tfV', body).onclick = () => { leerTratForm(body); const t = tratDesdeForm(state); $('#tfPrev', body).innerHTML = cardHTML(t); $('#tfPrev', body).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('#tfPlG', body).onclick = () => {
    leerTratForm(body);
    const nombre = $('#tfPlN', body).value.trim(); if (!nombre) return toast('Escribe un nombre para la plantilla', true);
    const e = { nombre, cultivo: ft.cultivo.trim(), problema: ft.problema.trim(), plazo: ft.plazo.trim(), cond: ft.cond.trim(), obs: ft.obs.trim(), prods: ft.prods.filter((p) => p.nombre) };
    commit((s) => { const i = s.plantillas.findIndex((p) => N(p.nombre) === N(nombre)); if (i > -1) s.plantillas[i] = e; else s.plantillas.push(e); }, { render: false });
    renderAll(); toast('Plantilla guardada');
  };
  $('#tfG', body).onclick = () => { leerTratForm(body); guardarTrat(); };
}
/* Tratamiento a partir del formulario (sin guardar): para la vista previa */
function tratDesdeForm(s) {
  const c = ft.cli && !ft.cli.startsWith('mx:') && ft.cli !== '__nuevo' ? AL.cliente(s, ft.cli) : null;
  const f = ft.fin && ft.fin !== '__otra' ? AL.finca(s, IX, ft.fin) : null;
  return { id: ft.id, fecha: ft.fecha, cli: c ? c.id : null, cliNomTmp: c ? c.nombre : (ft.cli === '__nuevo' ? ft.cliNuevo : (ft.cli.startsWith('mx:') && IX && IX.cli.get(ft.cli.slice(3)) ? IX.cli.get(ft.cli.slice(3)).nombre : '')),
    fin: f ? f.id : null, finNom: f ? f.nombre : ft.finTxt.trim(), cultivo: ft.cultivo.trim(), problema: ft.problema.trim(), plazo: ft.plazo.trim(),
    prods: ft.prods.filter((p) => p.nombre).map((p) => ({ nombre: p.nombre, tipo: p.tipo, dv: p.dv, du: AL.unidad(p.du) })), cond: ft.cond.trim(), obs: ft.obs.trim() };
}
function guardarTrat() {
  if (!ft.cli) return toast('Elige el cliente', true);
  if (ft.cli === '__nuevo' && !ft.cliNuevo.trim()) return toast('Escribe el nombre del cliente nuevo', true);
  if (!ft.prods.some((p) => p.nombre)) return toast('Añade al menos un producto', true);
  if (ft.prods.some((p) => p.nombre && p.dv && !isFinite(parseNum(p.dv)))) return toast('Revisa las dosis: deben ser números (ej. 12,5)', true);
  const id = ft.id || uid('t');
  const ok = commit((s) => {
    const cli = resolverCliente(s, ft.cli, ft.cliNuevo);
    let fin = ft.fin && ft.fin !== '__otra' ? ft.fin : null, finNom = '';
    if (ft.fin === '__otra' && ft.finTxt.trim()) { fin = AL.buscarFincaCli(s, IX, cli, ft.finTxt); finNom = ft.finTxt.trim(); }
    const f = fin ? AL.finca(s, IX, fin) : null;
    const prods = ft.prods.filter((p) => p.nombre).map((p) => ({ nombre: p.nombre, tipo: p.tipo, dv: p.dv, du: AL.unidad(p.du) }));
    for (const p of prods) { const pc = AL.asegurarProducto(s, IX, p.nombre, p.tipo, uid); if (pc) pc.tipo = p.tipo; }
    const t = { id, fecha: ft.fecha || hoy(), cli, fin: f ? f.id : null, finNom: f ? f.nombre : finNom, cultivo: ft.cultivo.trim(), problema: ft.problema.trim(), plazo: ft.plazo.trim(), prods, cond: ft.cond.trim(), obs: ft.obs.trim(), ts: Date.now() };
    const i = s.trat.findIndex((x) => x.id === id);
    if (i > -1) { t.ts = s.trat[i].ts; t.origen = s.trat[i].origen; s.trat[i] = t; } else s.trat.push(t);
  });
  if (!ok) return;
  const editado = !!ft.id;
  ft = null; refreshMx({});
  toast(editado ? 'Tratamiento actualizado' : 'Tratamiento guardado');
  reopen(() => abrirTrat(id, !editado));
}

/* ---------- Tarjeta (imagen para WhatsApp) ---------- */
function cardHTML(t) {
  const marca = (state.ajustes.marca || '').trim();
  const cli = t.cliNomTmp || (t.cli ? nomCli(t.cli) : '');
  const prods = AL.ordenMezcla(t.prods);
  const mr = (k, v) => (v ? `<div class="mr"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : '');
  const meta = mr('Cliente', cli) + mr('Finca / parcela', t.finNom) + mr('Cultivo', t.cultivo) + mr('Problema', t.problema);
  return `<div class="tcard"><div class="ch"><div>${marca ? `<div class="marca">${esc(marca)}</div>` : ''}<div class="tipo">Recomendación de tratamiento</div></div><div class="fecha">${fF(t.fecha)}</div></div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    ${prods.length ? `<div class="st">Orden de mezclado — dosis /1000 L de caldo</div><div class="mix">${prods.map((p, i) => `<div class="mi"><div class="mn">${i + 1}</div><div class="mname">${esc(p.nombre)}</div><div class="mb">${AL.formInfo(p.tipo).badge}</div><div class="md">${esc(AL.dosisTxt(p))}</div></div>`).join('')}</div>
      <div class="note">Orden orientativo según tipo de formulación · verifica compatibilidad de etiqueta antes de mezclar.</div>` : ''}
    ${t.plazo ? `<div class="plazo">Plazo de seguridad: ${esc(t.plazo)}</div>` : ''}
    ${t.cond ? `<div class="st">Condiciones de aplicación</div><div class="bx">${esc(t.cond)}</div>` : ''}
    ${t.obs ? `<div class="st">Observaciones</div><div class="bx obs">${esc(t.obs)}</div>` : ''}
    <div class="cf"><span>${esc(marca)}</span><span>Uso exclusivo del destinatario</span></div></div>`;
}
function textoWhatsapp(t) {
  const marca = (state.ajustes.marca || '').trim(), L = [];
  L.push(marca ? `*${marca} — Recomendación de tratamiento*` : '*Recomendación de tratamiento*');
  const cli = t.cli ? nomCli(t.cli) : '';
  if (cli) L.push('Cliente: ' + cli);
  if (t.finNom) L.push('Finca/parcela: ' + t.finNom);
  if (t.cultivo) L.push('Cultivo: ' + t.cultivo);
  if (t.problema) L.push('Problema: ' + t.problema);
  const prods = AL.ordenMezcla(t.prods);
  if (prods.length) { L.push('', '*Orden de mezclado — dosis /1000 L de caldo:*'); prods.forEach((p, i) => L.push(`${i + 1}. ${p.nombre} — ${AL.dosisTxt(p)}`)); }
  if (t.plazo) L.push('', '⏳ Plazo de seguridad: ' + t.plazo);
  if (t.cond) L.push('', '*Condiciones de aplicación:*\n' + t.cond);
  if (t.obs) L.push('', '*Observaciones:*\n' + t.obs);
  return L.join('\n');
}
const nombreImagen = (t) => 'recomendacion_' + (nomCli(t.cli) || 'tratamiento').replace(/[^\wáéíóúñü-]+/gi, '_') + '_' + (t.fecha || '') + '.png';
async function crearImagen(t) {
  await cargarScript('vendor/html2canvas.min.js');
  const r = $('#render'); r.innerHTML = cardHTML(t);
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) { /* nada */ }
  const canvas = await window.html2canvas(r.firstElementChild, { scale: 3, backgroundColor: null, logging: false });
  r.innerHTML = '';
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return { blob, url: URL.createObjectURL(blob) };
}

/* ---------- Detalle de un tratamiento ---------- */
async function abrirTrat(id, conImagen = false) {
  const t = state.trat.find((x) => x.id === id); if (!t) return;
  let img = null;
  const draw = () => {
    const x = state.trat.find((y) => y.id === id); if (!x) { closeSheet(); return; }
    const body = $('.sheet-body', sheetRoot);
    body.innerHTML = `${img ? `<div class="imgres"><img src="${img.url}" alt="Recomendación de tratamiento"></div>
        <div class="actions two"><button class="btn primary" id="tdS">Compartir (WhatsApp)</button><button class="btn" id="tdD">Descargar imagen</button></div>
        <p class="small">Si no se comparte directamente, mantén pulsada la imagen y elige «Guardar imagen».</p>`
      : `${cardHTML(x)}<div class="actions"><button class="btn primary" id="tdI">Crear imagen para WhatsApp</button></div>`}
      <div class="actions two" style="margin-top:8px"><button class="btn" id="tdC">Copiar texto</button><button class="btn" id="tdDu">Duplicar</button></div>
      <div class="actions two"><button class="btn" id="tdE">Editar</button><button class="btn" id="tdF">Ficha del cliente</button></div>
      <div class="actions"><button class="btn danger" id="tdB">Borrar tratamiento</button></div>`;
    const gen = $('#tdI', body);
    if (gen) gen.onclick = async () => {
      gen.disabled = true; gen.textContent = 'Creando imagen…';
      try { img = await crearImagen(x); draw(); } catch (e) { console.error(e); toast('No se pudo crear la imagen', true); gen.disabled = false; gen.textContent = 'Crear imagen para WhatsApp'; }
    };
    const sh = $('#tdS', body);
    if (sh) sh.onclick = async () => {
      try {
        const file = new File([img.blob], nombreImagen(x), { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Recomendación de tratamiento' });
        else toast('Este navegador no deja compartir la imagen: descárgala y adjúntala en WhatsApp', true);
      } catch (e) { if (!(e && e.name === 'AbortError')) toast('No se pudo compartir', true); }
    };
    const dl = $('#tdD', body); if (dl) dl.onclick = () => descargar(nombreImagen(x), img.blob);
    $('#tdC', body).onclick = async () => {
      const txt = textoWhatsapp(x);
      try { await navigator.clipboard.writeText(txt); toast('Texto copiado'); }
      catch (_) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Texto copiado'); } catch (e) { toast('No se pudo copiar', true); } ta.remove(); }
    };
    $('#tdDu', body).onclick = () => reopen(() => abrirTratForm({ base: x }));
    $('#tdE', body).onclick = () => reopen(() => abrirTratForm({ base: x, editar: true }));
    $('#tdF', body).onclick = () => { if (x.cli) reopen(() => abrirFicha(x.cli)); };
    armDelete($('#tdB', body), () => { commit((s) => { s.trat = s.trat.filter((y) => y.id !== id); }); closeSheet(); toast('Tratamiento borrado'); }, 'Borrar tratamiento');
  };
  openSheet('Tratamiento · ' + (t.cli ? nomCli(t.cli) : ''), '', draw);
  draw();
  if (conImagen) { const g = $('#tdI', sheetRoot); if (g) g.click(); }
}

/* ---------- Plantillas ---------- */
function abrirPlantillas() {
  const draw = () => {
    const body = $('.sheet-body', sheetRoot);
    body.innerHTML = state.plantillas.length ? `<div class="list compact">${state.plantillas.map((p, i) => `<div class="mini"><div><div class="name">${esc(p.nombre)}</div><div class="sub">${esc([p.cultivo, p.problema, plural((p.prods || []).length, 'producto', 'productos')].filter(Boolean).join(' · '))}</div></div>
      <div style="display:flex;gap:6px"><button class="paid on" data-pu="${i}">Usar</button><button class="paid" data-pb="${i}">Borrar</button></div></div>`).join('')}</div>
      <p class="small">Para crear una plantilla: rellena un tratamiento y abre «Guardar como plantilla» al final del formulario.</p>`
      : '<div class="empty">No hay plantillas. Rellena un tratamiento y abre «Guardar como plantilla» al final del formulario.</div>';
    $$('[data-pu]', body).forEach((b) => { b.onclick = () => { const p = state.plantillas[+b.dataset.pu]; reopen(() => abrirTratForm({ base: p })); }; });
    $$('[data-pb]', body).forEach((b) => {
      let armed = false;
      b.onclick = () => { if (!armed) { armed = true; b.textContent = '¿Seguro?'; b.classList.add('on'); setTimeout(() => { armed = false; b.textContent = 'Borrar'; b.classList.remove('on'); }, 3000); return; }
        commit((s) => { s.plantillas.splice(+b.dataset.pb, 1); }); draw(); toast('Plantilla borrada'); };
    });
  };
  openSheet('Plantillas de tratamiento', '', draw); draw();
}

/* ---------- Catálogo de productos de tratamiento ---------- */
function abrirProductos() {
  const draw = () => {
    const body = $('.sheet-body', sheetRoot);
    const L = state.productos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    body.innerHTML = `<p class="small" style="margin-top:0">Tus productos para las recomendaciones, con su formulación (para el orden de mezcla). Cada uno queda ligado a su ficha del maestro de productos cuando existe; si no está allí, no pasa nada.</p>
      ${L.length ? `<div class="list compact">${L.map((p) => `<button class="mini" data-pe="${esc(p.id)}"><div><div class="name">${esc(p.nombre)}</div><div class="sub">${esc(AL.formInfo(p.tipo).label)}</div></div><div class="side">${p.mid ? esc(p.mid) : 'sin enlazar'}</div></button>`).join('')}</div>` : '<div class="empty">Aún no hay productos. Se añaden solos al guardar tratamientos.</div>'}`;
    $$('[data-pe]', body).forEach((b) => { b.onclick = () => reopen(() => editarProducto(b.dataset.pe)); });
  };
  openSheet('Productos de tratamiento', '', draw); draw();
}
function editarProducto(id) {
  const p = state.productos.find((x) => x.id === id); if (!p) return;
  const prods = IX ? [...IX.prod.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) : [];
  const body = openSheet('Producto', `
    <label class="fld"><span>Nombre</span><input type="text" id="peN" value="${esc(p.nombre)}" autocomplete="off"></label>
    <label class="fld"><span>Formulación</span><select id="peT">${AL.FORM_TYPES.map((t) => opt(t.v, t.label, t.v === p.tipo)).join('')}</select></label>
    <label class="fld"><span>Ficha del maestro de productos</span><select id="peM"><option value="">(sin enlazar)</option>${prods.map((m) => opt(m.id, m.nombre + ' · ' + m.id + (m.categoria ? ' · ' + m.categoria : ''), m.id === p.mid)).join('')}</select></label>
    <p class="hint">${IX ? 'Los tratamientos ya guardados mantienen el nombre con que se hicieron.' : 'Conecta los maestros para poder enlazarlo.'}</p>
    <div class="actions"><button class="btn primary" id="peG">Guardar</button><button class="btn danger" id="peB">Quitar del catálogo</button></div>`);
  $('#peG', body).onclick = () => {
    const nombre = $('#peN', body).value.trim(); if (!nombre) return toast('Falta el nombre', true);
    if (state.productos.some((x) => x.id !== id && N(x.nombre) === N(nombre))) return toast('Ya hay un producto con ese nombre', true);
    commit((s) => { const x = s.productos.find((y) => y.id === id); x.nombre = nombre; x.tipo = $('#peT', body).value; x.mid = $('#peM', body).value || null; });
    toast('Producto guardado'); reopen(abrirProductos);
  };
  armDelete($('#peB', body), () => { commit((s) => { s.productos = s.productos.filter((y) => y.id !== id); }); toast('Quitado del catálogo'); reopen(abrirProductos); }, 'Quitar del catálogo');
}

/* ---------- Excel de tratamientos ---------- */
async function exportarExcel(items, etiqueta) {
  if (!items.length) return toast('No hay tratamientos para exportar', true);
  try {
    await cargarScript('vendor/xlsx.mini.min.js');
    const serial = (f) => { if (!f) return ''; const [y, m, d] = f.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569; };
    const cab = ['Fecha', 'Cliente', 'Finca', 'Cultivo', 'Problema', 'Plazo de seguridad', 'Nº mezcla', 'Producto', 'Formulación', 'Dosis /1000 L', 'Unidad', 'Condiciones de aplicación', 'Observaciones'];
    const filas = [cab];
    const orden = items.slice().sort((a, b) => nomCli(a.cli).localeCompare(nomCli(b.cli), 'es') || (b.fecha || '').localeCompare(a.fecha || ''));
    for (const t of orden) {
      const base = [serial(t.fecha), t.cli ? nomCli(t.cli) : '', t.finNom || '', t.cultivo || '', t.problema || '', t.plazo || ''];
      const cola = [t.cond || '', t.obs || ''];
      const prods = AL.ordenMezcla(t.prods);
      if (!prods.length) filas.push([...base, '', '', '', '', '', ...cola]);
      prods.forEach((p, i) => { const n = parseNum(p.dv); filas.push([...base, i + 1, p.nombre, AL.formInfo(p.tipo).label, isFinite(n) ? n : (p.dv || ''), AL.unidad(p.du), ...cola]); });
    }
    const ws = XLSX.utils.aoa_to_sheet(filas);
    for (let r = 1; r < filas.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 0 })]; if (c && typeof c.v === 'number') c.z = 'dd/mm/yyyy'; }
    ws['!cols'] = [12, 22, 18, 18, 20, 16, 10, 26, 30, 14, 8, 45, 45].map((w) => ({ wch: w }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tratamientos');
    const datos = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const slug = String(etiqueta || 'todos').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'todos';
    descargar('tratamientos-' + slug + '-' + hoy() + '.xlsx', new Blob([datos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    toast('Excel descargado (' + plural(orden.length, 'tratamiento', 'tratamientos') + ')');
  } catch (e) { console.error(e); toast('No se pudo crear el Excel', true); }
}

/* ---------- Clientes nuevos en Asesor ---------- */
function abrirNuevoCliente() {
  const usados = new Set(state.clientes.filter((c) => c.ases).map((c) => c.mid).filter(Boolean));
  const ocultos = state.clientes.filter((c) => !c.ases).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const otros = IX ? [...IX.cli.values()].filter((m) => !usados.has(m.id) && !state.clientes.some((c) => c.mid === m.id) && !MX.deBaja(m) && N(m.tipo) !== 'proveedor').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) : [];
  const body = openSheet('Añadir cliente a Asesor', `
    <label class="fld"><span>Cliente del maestro</span><select id="ncS"><option value="">Elige…</option>${ocultos.map((c) => opt(c.id, c.nombre + ' (oculto)', false)).join('')}${otros.map((m) => opt('mx:' + m.id, m.nombre, false)).join('')}</select></label>
    <div class="actions"><button class="btn primary" id="ncG">Añadir</button></div>
    <div class="sep"></div>
    <label class="fld"><span>¿No está en el maestro? Cliente nuevo</span><input type="text" id="ncN" autocomplete="off" placeholder="Nombre"></label>
    <p class="hint">Se dará de alta en el maestro de clientes con el servicio «Asesoría» (queda en amarillo para revisarlo).</p>
    <div class="actions"><button class="btn" id="ncA">Crear cliente nuevo</button></div>`);
  const fin = (val, nombre) => {
    let id = null;
    if (commit((s) => { id = resolverCliente(s, val, nombre); })) { toast('Cliente añadido'); refreshMx({}); reopen(() => abrirFicha(id)); }
  };
  $('#ncG', body).onclick = () => { const v = $('#ncS', body).value; if (!v) return toast('Elige un cliente', true); fin(v); };
  $('#ncA', body).onclick = () => { const n = $('#ncN', body).value.trim(); if (!n) return toast('Escribe el nombre', true); fin('__nuevo', n); };
}
function abrirAnadirAnio() {
  const y = ui.year, t = state.años[y] || {};
  const L = AL.delAsesor(state).filter((c) => !t[c.id]);
  if (!L.length) return toast('Todos los clientes de Asesor ya están en ' + y);
  const body = openSheet('Añadir a planes y cobros ' + y, `<label class="fld"><span>Cliente</span><select id="aaS"><option value="">Elige…</option>${L.map((c) => opt(c.id, c.nombre, false)).join('')}</select></label>
    <div class="actions"><button class="btn primary" id="aaG">Seguir</button></div>`);
  $('#aaG', body).onclick = () => { const id = $('#aaS', body).value; if (!id) return toast('Elige un cliente', true); reopen(() => abrirPlanCobro(id, y)); };
}

/* ---------- Ajustes ---------- */
function abrirAjustes() {
  const draw = () => {
    const body = $('.sheet-body', sheetRoot);
    const sinCli = state.clientes.filter((c) => !c.mid && !state.mxPend.some((p) => p.tipo === 'cliente' && p.ref === c.id));
    const sinFin = state.fincasNuevas.filter((f) => !state.mxPend.some((p) => p.tipo === 'finca' && p.ref === f.id));
    const imp = state.importes || {};
    body.innerHTML = `
      <h3 style="margin-top:4px">Maestros (clientes, fincas y productos)</h3><div id="mxBox"></div>
      <h3>Copia a la hoja «Asesor» y fotos</h3><div id="syBox"></div>
      <h3>Traer datos de las apps antiguas</h3>
      <p class="small">En cada app antigua pulsa «Descargar copia» o «Exportar copia (.json)» y elige aquí los archivos (puedes elegir los tres a la vez). No se borra nada: lo que ya esté no se duplica.</p>
      <div class="box"><div><span>Visitas</span><b>${imp.visitas ? 'traída ' + fF(imp.visitas.slice(0, 10)) : '—'}</b></div><div><span>Generador de tratamientos</span><b>${imp.generador ? 'traída ' + fF(imp.generador.slice(0, 10)) : '—'}</b></div><div><span>Clientes</span><b>${imp.clientes ? 'traída ' + fF(imp.clientes.slice(0, 10)) : '—'}</b></div></div>
      <label class="filebtn" style="width:100%;margin-bottom:14px">📂 Elegir copias de las apps antiguas<input type="file" id="ajImp" accept=".json,application/json,text/plain" multiple></label>
      <div id="ajImpRes">${ultimoImport}</div>
      <h3>Enlaces con el maestro</h3>
      <div class="box"><div><span>Clientes sin enlazar</span><b>${sinCli.length}</b></div><div><span>Fincas nuevas sin dar de alta</span><b>${sinFin.length}</b></div><div><span>Altas pendientes de enviar</span><b>${state.mxPend.length}</b></div></div>
      <div class="actions"><button class="btn" id="ajSin">Revisar enlaces</button></div>
      <h3>Recomendaciones de tratamiento</h3>
      <label class="fld"><span>Marca / firma de la tarjeta</span><input type="text" id="ajMarca" value="${esc(state.ajustes.marca || '')}" placeholder="FG Agro"></label>
      <div class="actions two"><button class="btn" id="ajProd">Productos (${state.productos.length})</button><button class="btn" id="ajPlant">Plantillas (${state.plantillas.length})</button></div>
      <h3>Frecuencia de visita (días entre visitas)</h3>
      <div class="grid3">${AL.MC.map((n, i) => `<label class="fld"><span>${n}</span><input type="text" inputmode="numeric" data-dia="${i + 1}" value="${esc(state.ajustes.dias[i + 1])}"></label>`).join('')}</div>
      <h3>Listas</h3>
      <label class="fld"><span>Cultivos (uno por línea)</span><textarea class="inp" id="ajCult" rows="5">${esc(state.cultivos.join('\n'))}</textarea></label>
      <label class="fld"><span>Estados fenológicos (uno por línea, en el orden en que quieras verlos)</span><textarea class="inp" id="ajFen" rows="5">${esc(state.fenologias.map((f) => f.nombre).join('\n'))}</textarea></label>
      <label class="fld"><span>Plagas y enfermedades (una por línea)</span><textarea class="inp" id="ajPlag" rows="6">${esc(state.plagas.map((p) => p.nombre).join('\n'))}</textarea></label>
      <div class="actions"><button class="btn primary" id="ajListas">Guardar frecuencia y listas</button></div>
      <h3>Copia de seguridad en archivo</h3>
      <p class="small">Guarda en un archivo todos los datos de Asesor (sin las fotos por subir). ${state.ajustes.ultimaCopia ? 'Última: ' + fF(state.ajustes.ultimaCopia.slice(0, 10)) + '.' : 'Aún no has hecho ninguna.'}</p>
      <div class="actions two"><button class="btn" id="ajExp">Descargar copia</button><label class="btn" style="display:grid;place-items:center">Restaurar copia<input type="file" id="ajRes" accept=".json,application/json" hidden></label></div>
      <p class="small" style="text-align:center;margin-top:18px">Asesor ${APP_VERSION} · FG Agro</p>`;
    drawMx($('#mxBox', body)); drawSync($('#syBox', body));
    $('#ajImp', body).onchange = (e) => importarArchivos(Array.from(e.target.files || []), $('#ajImpRes', body));
    $('#ajSin', body).onclick = () => reopen(abrirSinEnlazar);
    $('#ajMarca', body).onchange = (e) => commit((s) => { s.ajustes.marca = e.target.value.trim(); });
    $('#ajProd', body).onclick = () => reopen(abrirProductos);
    $('#ajPlant', body).onclick = () => reopen(abrirPlantillas);
    $('#ajListas', body).onclick = () => {
      const lineas = (id) => AL.uniq($(id, body).value.split('\n').map(AL.limpiar));
      commit((s) => {
        $$('[data-dia]', body).forEach((i) => { const n = Math.round(parseNum(i.value)); if (n > 0) s.ajustes.dias[i.dataset.dia] = n; });
        s.cultivos = lineas('#ajCult');
        s.fenologias = lineas('#ajFen').map((n) => { const o = s.fenologias.find((f) => N(f.nombre) === N(n)); return { nombre: n, usos: o ? o.usos : 0 }; });
        s.plagas = lineas('#ajPlag').map((n) => { const o = s.plagas.find((p) => N(p.nombre) === N(n)); return { nombre: n, usos: o ? o.usos : {} }; });
      });
      toast('Guardado'); redrawSheet();
    };
    $('#ajExp', body).onclick = () => {
      const copia = { app: 'asesor', version: APP_VERSION, fecha: new Date().toISOString(), estado: state };
      descargar('copia-asesor-' + hoy() + '.json', new Blob([JSON.stringify(copia)], { type: 'application/json' }));
      commit((s) => { s.ajustes.ultimaCopia = new Date().toISOString(); }, { render: false });
      toast('Copia descargada: guárdala en Drive › Apps › Copia de seguridad'); redrawSheet();
    };
    $('#ajRes', body).onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = AL.detectarCopia(JSON.parse(rd.result));
          if (!d || d.tipo !== 'asesor' || !AL.valido(d.datos)) throw new Error('formato');
          if (!confirm(`Se sustituyen los datos de este móvil por los del archivo (${d.datos.visitas.length} visitas, ${d.datos.trat.length} tratamientos, ${d.datos.clientes.length} clientes). ¿Continuar?`)) return;
          state = AL.migrar(d.datos); persist(); renderAll(); redrawSheet(); toast('Copia restaurada');
        } catch (_) { toast('Ese archivo no es una copia de Asesor. Las copias de las apps antiguas se traen en «Traer datos de las apps antiguas».', true); }
      };
      rd.readAsText(f);
    };
  };
  openSheet('Ajustes', '', draw); draw();
}

function drawMx(box) {
  if (mxOn()) {
    box.innerHTML = `<p class="small" id="mxLine">${esc(mxStatusText())}</p>
      <div class="actions two"><button class="btn primary" id="mxNow">Actualizar ahora</button><button class="btn" id="mxOff">Desconectar</button></div>`;
    $('#mxNow', box).onclick = () => refreshMx({ manual: true });
    $('#mxOff', box).onclick = () => { if (!confirm('¿Desconectar los maestros? Lo enlazado se conserva, pero dejarás de ver las fincas hasta volver a conectarlos.')) return; mx = { ...mx, url: '', clave: '', lastError: '' }; saveMx(); renderStatus(); drawMx(box); };
  } else {
    box.innerHTML = `<p class="small">Clientes, fincas y cultivos salen del maestro de Drive (Apps › Maestros). Es el mismo script y la misma clave que en Ventas, Gestión fincas y AgroServicios.</p>
      <label class="fld"><span>Dirección del script de maestros (termina en /exec)</span><input id="mxU" type="url" value="${esc(mx.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="fld"><span>Clave</span><input id="mxK" type="password" value="${esc(mx.clave)}" autocomplete="off"></label>
      <div class="actions"><button class="btn primary" id="mxOn">Probar y conectar</button></div>`;
    $('#mxOn', box).onclick = async () => {
      const url = $('#mxU', box).value.trim(), clave = $('#mxK', box).value.trim();
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec\/?$/.test(url)) return toast('La dirección debe ser la del script y terminar en /exec', true);
      if (!clave) return toast('Escribe la clave', true);
      try {
        const r = await postScript(url, clave, 'ping');
        if (!r.ok) throw new Error(mxErr(r, 'El script no responde'));
        mx = { ...mx, url, clave, lastError: '' }; saveMx(); toast('Maestros conectados');
        await refreshMx({ manual: true });
      } catch (e) { toast(e.message || 'No se pudo conectar', true); }
    };
  }
}
function drawSync(box) {
  if (syncOn()) {
    box.innerHTML = `<p class="small" id="syncLine">${esc(syncStatusText())}</p>
      <p class="small">Cada cambio se copia solo en tu hoja «Asesor» (pestañas Clientes, Visitas, Tratamientos, Planes y Cobros) y las fotos van a la carpeta «Fotos de visitas» junto a la hoja. Sin conexión queda pendiente y se envía al volver.</p>
      <div class="actions"><button class="btn primary" id="syNow">Enviar ahora</button><button class="btn" id="syRes">Restaurar desde la hoja</button><button class="btn danger" id="syOff">Desactivar</button></div>`;
    $('#syNow', box).onclick = () => { if (!navigator.onLine) return toast('Sin conexión: se enviará al volver', true); sync.lastError = ''; markDirty(); clearTimeout(syncTimer); runSync(); };
    $('#syRes', box).onclick = async () => {
      try {
        const est = await callSync('estado');
        if (!est.ok || !est.estado) throw new Error(est.error === 'sin copia' ? 'La hoja todavía no tiene copia' : (est.error || 'No se pudo leer la copia'));
        const s = JSON.parse(est.estado);
        if (!AL.valido(s)) throw new Error('La copia de la hoja no es válida');
        if (!confirm(`Se sustituyen los datos de este móvil por los de la hoja (${s.visitas.length} visitas, ${s.trat.length} tratamientos, copia ${haceTxt(est.fecha)}). ¿Continuar?`)) return;
        state = AL.migrar(s); persist(); renderAll(); redrawSheet(); toast('Restaurado desde la hoja');
      } catch (e) { toast(e.message || 'No se pudo restaurar', true); }
    };
    $('#syOff', box).onclick = () => { sync.enabled = false; sync.dirty = false; sync.lastError = ''; saveSync(); renderStatus(); drawSync(box); toast('Copia automática desactivada'); };
  } else {
    box.innerHTML = `<p class="small">Copia automática a la hoja de Google «Asesor» de tu Drive y subida de las fotos. Se configura una vez con el script que se explica en el README.</p>
      <label class="fld"><span>Dirección del script (termina en /exec)</span><input id="syU" type="url" value="${esc(sync.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="fld"><span>Clave</span><input id="syK" type="password" value="${esc(sync.clave)}" autocomplete="off"></label>
      <div class="actions"><button class="btn primary" id="syOn">Probar y activar</button></div>`;
    $('#syOn', box).onclick = () => activarSync($('#syU', box).value.trim(), $('#syK', box).value.trim(), box);
  }
}
async function activarSync(url, clave, box) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec\/?$/.test(url)) return toast('La dirección debe ser la del script y terminar en /exec', true);
  if (!clave) return toast('Escribe la clave', true);
  const prev = { ...sync };
  sync.url = url; sync.clave = clave;
  const fin = () => { sync.enabled = true; sync.dirty = true; sync.lastError = ''; syncRev++; saveSync(); renderStatus(); drawSync(box); runSync(); toast('Conectado con la hoja «Asesor»'); };
  try {
    const ping = await callSync('ping');
    if (!ping.ok) throw new Error(ping.error === 'clave' ? 'La clave no coincide con la del script' : (ping.error || 'El script no responde'));
    const est = await callSync('estado');
    if (est.ok && est.estado) {
      let info = null; try { info = JSON.parse(est.estado); } catch (_) { /* nada */ }
      const ok = AL.valido(info);
      box.innerHTML = `<p><b>La hoja ya tiene una copia</b> (${ok ? info.visitas.length + ' visitas y ' + info.trat.length + ' tratamientos' : 'datos'}, ${haceTxt(est.fecha)}).</p>
        <p class="small">Si este móvil es nuevo, usa la copia de la hoja. Si lo de este móvil es lo correcto, sobrescribe la hoja.</p>
        <div class="actions"><button class="btn primary" id="syUse" ${ok ? '' : 'disabled'}>Usar la copia de la hoja en este móvil</button><button class="btn" id="syOver">Sobrescribir la hoja con este móvil</button><button class="btn" id="syCan">Cancelar</button></div>`;
      $('#syUse', box).onclick = () => { state = AL.migrar(info); persist(); renderAll(); fin(); };
      $('#syOver', box).onclick = fin;
      $('#syCan', box).onclick = () => { sync = prev; drawSync(box); };
      return;
    }
    fin();
  } catch (e) { sync = prev; toast(e.message || 'No se pudo conectar', true); }
}

/* ---------- Importar las apps antiguas ---------- */
let ultimoImport = '';
async function importarArchivos(files, out) {
  if (!files.length) return;
  if (mxOn() && !IX) await refreshMx({});
  if (!IX && !confirm('Los maestros no están conectados: los clientes y fincas no se podrán enlazar ahora (podrás hacerlo después en «Revisar enlaces»). ¿Seguir?')) return;
  const lineas = [];
  for (const f of files) {
    let d;
    try { d = AL.detectarCopia(JSON.parse(await f.text())); } catch (_) { d = null; }
    if (!d || d.tipo === 'asesor') { lineas.push(`<div><span>${esc(f.name)}</span><b class="neg">${d ? 'es una copia de Asesor: usa «Restaurar copia»' : 'no es una copia válida'}</b></div>`); continue; }
    let res = null;
    commit((s) => {
      const fn = { visitas: AL.importarVisitas, generador: AL.importarGenerador, clientes: AL.importarClientes }[d.tipo];
      res = fn(s, IX, d.datos, uid);
      s.importes[d.tipo] = new Date().toISOString();
    });
    const t = { visitas: 'Visitas', generador: 'Generador', clientes: 'Clientes' }[d.tipo];
    const partes = [];
    if (res.visitas) partes.push(plural(res.visitas, 'visita', 'visitas'));
    if (res.tratamientos) partes.push(plural(res.tratamientos, 'tratamiento', 'tratamientos'));
    if (res.plantillas) partes.push(plural(res.plantillas, 'plantilla', 'plantillas'));
    if (res.productos) partes.push(plural(res.productos, 'producto', 'productos'));
    if (res.filasAnio) partes.push(plural(res.filasAnio, 'fila de planes y cobros', 'filas de planes y cobros'));
    if (res.clientesNuevos) partes.push(plural(res.clientesNuevos, 'cliente', 'clientes'));
    if (res.fincasNuevas) partes.push(plural(res.fincasNuevas, 'finca sin maestro', 'fincas sin maestro'));
    if (res.saltadas) partes.push(res.saltadas + ' ya estaban');
    lineas.push(`<div><span>${t}</span><b>${esc(partes.join(' · ') || 'nada nuevo')}</b></div>`);
    if (res.sinEnlazar.size) lineas.push(`<div><span>Sin enlazar</span><b>${esc([...res.sinEnlazar].join(', '))}</b></div>`);
  }
  // Los cultivos que faltan en el maestro se piden solos
  commit((s) => {
    for (const fid of Object.keys(s.cultivosExtra)) {
      const m = IX && IX.fin.get(fid);
      if (m) pedirAlta(s, 'cultivo', fid, { nombre: m.nombre, clienteId: m.clienteId, clienteNombre: '', cultivos: AL.uniq([...(m.cultivos || []), ...s.cultivosExtra[fid]]) });
    }
  }, { render: true });
  ultimoImport = `<div class="box">${lineas.join('')}</div><p class="small">Si hay clientes o fincas sin enlazar, pulsa «Revisar enlaces».</p>`;
  if (out && out.isConnected) out.innerHTML = ultimoImport;
  redrawSheet();
  refreshMx({});
}

/* ---------- Revisar enlaces con el maestro ---------- */
function abrirSinEnlazar() {
  const draw = () => {
    const body = $('.sheet-body', sheetRoot);
    const sinCli = state.clientes.filter((c) => !c.mid).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const fins = state.fincasNuevas.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const pend = (tipo, ref) => state.mxPend.some((p) => p.tipo === tipo && p.ref === ref);
    body.innerHTML = `${!IX ? '<div class="okline warn">Conecta los maestros para poder enlazar.</div>' : ''}
      <h3 style="margin-top:4px">Clientes sin enlazar (${sinCli.length})</h3>
      ${sinCli.length ? `<div class="list compact">${sinCli.map((c) => `<div class="mini"><div><div class="name">${esc(c.nombre)}</div><div class="sub">${pend('cliente', c.id) ? 'Alta pedida al maestro' : 'Sin ficha en el maestro'}</div></div><button class="paid on" data-ec="${esc(c.id)}">Enlazar</button></div>`).join('')}</div>` : '<div class="okline">✓ Todos los clientes están enlazados</div>'}
      <h3>Fincas que no están en el maestro (${fins.length})</h3>
      ${fins.length ? fins.map((f) => {
        const c = AL.cliente(state, f.cli);
        const ops = c && c.mid && IX ? [...IX.fin.values()].filter((m) => m.clienteId === c.mid) : [];
        return `<div class="trow"><div class="name">${esc(f.nombre)}</div><div class="sub">${esc(c ? c.nombre : '')} · ${esc((f.cultivos || []).join(', ') || 'sin cultivos')}${pend('finca', f.id) ? ' · alta pedida' : ''}</div>
          ${ops.length ? `<select data-ef="${esc(f.id)}"><option value="">Es la misma que…</option>${ops.map((m) => opt(m.id, m.nombre + ' · ' + m.id, false)).join('')}</select>` : ''}
          <div class="actions two">${ops.length ? `<button class="btn" data-efg="${esc(f.id)}">Enlazar</button>` : '<span></span>'}<button class="btn" data-efa="${esc(f.id)}" ${pend('finca', f.id) ? 'disabled' : ''}>Dar de alta</button></div></div>`;
      }).join('<div style="height:8px"></div>') : '<div class="okline">✓ Todas las fincas están en el maestro</div>'}
      <h3>Altas pendientes de enviar (${state.mxPend.length})</h3>
      ${state.mxPend.length ? `<p class="small">Se envían solas al haber conexión. Las fincas esperan a que su cliente tenga ficha en el maestro.</p><div class="actions"><button class="btn" id="seNow">Enviar ahora</button></div>` : '<p class="small">Ninguna.</p>'}`;
    $$('[data-ec]', body).forEach((b) => { b.onclick = () => reopen(() => abrirEnlazarCliente(b.dataset.ec, abrirSinEnlazar)); });
    $$('[data-efg]', body).forEach((b) => {
      b.onclick = () => {
        const fid = b.dataset.efg, mid = $(`[data-ef="${CSS.escape(fid)}"]`, body).value;
        if (!mid) return toast('Elige la finca del maestro', true);
        const m = IX.fin.get(mid);
        commit((s) => { AL.cambiarFinca(s, fid, mid, m.nombre); }); toast('Finca enlazada'); draw();
      };
    });
    $$('[data-efa]', body).forEach((b) => { b.onclick = () => { if (!mxOn()) return toast('Conecta primero los maestros', true); commit((s) => pedirAlta(s, 'finca', b.dataset.efa, {})); toast('Alta pedida'); refreshMx({}); draw(); }; });
    const sn = $('#seNow', body); if (sn) sn.onclick = () => refreshMx({ manual: true });
  };
  openSheet('Revisar enlaces', '', draw); draw();
}

/* ---------- Arranque ---------- */
async function init() {
  try {
    const [s, m, y] = await Promise.all([dbGet('state'), dbGet('mx'), dbGet('sync')]);
    state = AL.migrar(s);
    if (m) mx = { ...mx, ...m };
    if (y) sync = { ...sync, ...y };
    IX = mx.data ? MX.indexar(mx.data) : null;
    if (s && s.v !== state.v) await dbSet('state', state);
  } catch (e) { toast('No se pudieron leer los datos del móvil: ' + (e.message || e), true); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $$('.tab').forEach((b) => { b.onclick = () => { ui.tab = b.dataset.tab; renderAll(); window.scrollTo(0, 0); }; });
  $('#btnSettings').onclick = abrirAjustes;
  $('#mxStatus').onclick = abrirAjustes;
  $('#syncStatus').onclick = abrirAjustes;
  $('#fab').onclick = () => {
    if (ui.tab === 'visitas') abrirVisitaForm();
    else if (ui.tab === 'trat') abrirTratForm();
    else if (ui.cSeg === 'fichas') abrirNuevoCliente();
    else abrirAnadirAnio();
  };
  renderAll();
  await contarFotos();
  const alVolver = () => { refreshMx({ auto: true }); if (syncOn() && (sync.dirty || fotosPend)) runSync(); };
  window.addEventListener('online', alVolver);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderAll(); alVolver(); } });
  alVolver();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
