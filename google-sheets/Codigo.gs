/**
 * Asesor · FG Agro · receptor para la hoja de Google «Asesor»
 *
 * Va pegado en el Apps Script de la hoja «Asesor» (Extensiones → Apps Script).
 * Recibe de la app el estado completo y lo refleja en estas pestañas:
 *   Clientes      -> clientes de asesoría: fincas, última visita, fincas que toca visitar, planes y cobros del año
 *   Visitas       -> una fila por cultivo visitado (la más reciente arriba), con enlaces a las fotos
 *   Tratamientos  -> una fila por producto de cada recomendación, en orden de mezcla
 *   Planes        -> planes de abonado enviados por cliente y mes (todos los años)
 *   Cobros        -> cobros por cliente y mes (todos los años)
 *   _copia        -> copia completa para poder restaurar la app (oculta; no tocar)
 * Las fotos de las visitas se guardan en la carpeta «Fotos de visitas», junto a esta hoja, con una subcarpeta por cliente.
 *
 * IMPORTANTE: la hoja es un espejo. La app reescribe estas pestañas en cada envío,
 * así que no escribas dentro de ellas. Para tus cálculos usa otra pestaña u otro archivo.
 *
 * Desde Asesor 1.2.0 la copia (_copia) es la copia común de todos tus aparatos (móvil, tablet y ordenador):
 * cada aparato la baja («bajar»), la junta con lo suyo y la sube («subir») solo si nadie la ha cambiado
 * entretanto (número de revisión). Si alguien la cambió, le devuelve la nueva para que vuelva a juntar.
 */

const CLAVE = 'CAMBIA-ESTA-CLAVE'; // debe ser idéntica a la que escribes en la app (⚙ Ajustes → Copia a la hoja «Asesor»)

const PERMITIDAS = ['Clientes', 'Visitas', 'Tratamientos', 'Planes', 'Cobros'];
const COPIA = '_copia';
const CARPETA_FOTOS = 'Fotos de visitas';
const COLOR = '#1f5f3b';

function doGet() {
  return salida({ ok: true, mensaje: 'Asesor: receptor activo' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return salida({ ok: false, error: 'petición no válida' }); }
  if (!req || req.clave !== CLAVE) return salida({ ok: false, error: 'clave' });
  try {
    if (req.accion === 'ping') return salida({ ok: true });
    if (req.accion === 'estado') return salida(leerEstado());
    if (req.accion === 'foto') return salida(guardarFoto(req));
    if (req.accion === 'bajar' || req.accion === 'subir' || req.accion === 'sincronizar') {
      // De uno en uno: nadie lee la copia mientras otro la está escribiendo
      const lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try { return salida(req.accion === 'bajar' ? bajar() : req.accion === 'subir' ? subir(req) : sincronizar(req)); } finally { lock.releaseLock(); }
    }
    return salida({ ok: false, error: 'accion desconocida' });
  } catch (err) {
    return salida({ ok: false, error: String((err && err.message) || err) });
  }
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hoja(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function aFecha(iso) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.parseDate(String(iso).slice(0, 10), tz, 'yyyy-MM-dd');
}

function escribirTabla(t) {
  const cab = t.cabecera;
  const filas = (t.filas || []).map(function (r) {
    const x = r.slice(0, cab.length);
    while (x.length < cab.length) x.push('');
    (t.fechas || []).forEach(function (i) { if (x[i] && /^\d{4}-\d{2}-\d{2}/.test(String(x[i]))) x[i] = aFecha(x[i]); });
    return x;
  });
  const sh = hoja(t.nombre);
  sh.clear();
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground(COLOR).setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (filas.length) {
    const rng = sh.getRange(2, 1, filas.length, cab.length);
    rng.setNumberFormat('@'); // primero texto: que Sheets no convierta nombres o dosis en fechas
    rng.setValues(filas);
    (t.formatos || []).forEach(function (f, i) { if (f) sh.getRange(2, i + 1, filas.length, 1).setNumberFormat(f); });
    // Las columnas de números se vuelven a escribir para que sean números de verdad
    (t.formatos || []).forEach(function (f, i) {
      if (!f) return;
      const col = filas.map(function (r) { return [r[i]]; });
      sh.getRange(2, i + 1, filas.length, 1).setValues(col);
    });
  }
  sh.autoResizeColumns(1, cab.length);
  return filas.length;
}

/* Versiones antiguas de la app (1.1 y anteriores): suben todo y pisan la copia. Si la copia ya es común
   (la ha subido la 1.2.0 o posterior), se rechaza para no pisar lo de los otros aparatos. */
function sincronizar(req) {
  if (revision() > 0) return { ok: false, error: 'Actualiza Asesor a la versión 1.2.0: cierra la app y vuelve a abrirla con conexión' };
  escribirTablas(req.tablas);
  guardarCopia(String(req.estado || ''), new Date().toISOString(), 0);
  return { ok: true, fecha: new Date().toISOString() };
}

/* Copia común + número de revisión */
function bajar() {
  const e = leerEstado();
  if (!e.ok) return { ok: true, estado: '', rev: 0, fecha: '' };
  return { ok: true, estado: e.estado, rev: revision(), fecha: e.fecha };
}

function subir(req) {
  const rev = revision();
  if (Number(req.base) !== rev) {
    // Otro aparato ha subido entretanto: se le devuelve la copia nueva para que vuelva a juntar
    const e = leerEstado();
    return { ok: false, conflicto: true, estado: e.ok ? e.estado : '', rev: rev };
  }
  if (!req.estado) return { ok: false, error: 'copia vacía' };
  escribirTablas(req.tablas);
  const fecha = new Date().toISOString();
  guardarCopia(String(req.estado), fecha, rev + 1);
  return { ok: true, rev: rev + 1, fecha: fecha };
}

function escribirTablas(lista) {
  const tablas = (lista || []).filter(function (t) { return t && PERMITIDAS.indexOf(t.nombre) > -1 && Array.isArray(t.cabecera); });
  tablas.forEach(function (t) { escribirTabla(t); });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PERMITIDAS.forEach(function (n, i) { const sh = ss.getSheetByName(n); if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); } });
}

function revision() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COPIA);
  if (!sh) return 0;
  return Number(sh.getRange(1, 3).getValue()) || 0;
}

function guardarCopia(estado, fecha, rev) {
  const sh = hoja(COPIA);
  sh.clear();
  sh.getRange(1, 1, 1, 3).setValues([['Copia automática de Asesor (no editar ni borrar)', fecha, rev || 0]]);
  const trozos = [];
  for (let i = 0; i < estado.length; i += 40000) trozos.push([estado.substr(i, 40000)]);
  if (trozos.length) {
    const rng = sh.getRange(2, 1, trozos.length, 1);
    rng.setNumberFormat('@');
    rng.setValues(trozos);
  }
  sh.hideSheet();
}

function leerEstado() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(COPIA);
  if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'sin copia' };
  const n = sh.getLastRow() - 1;
  const trozos = sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); });
  const f = sh.getRange(1, 2).getValue();
  return { ok: true, estado: trozos.join(''), fecha: f instanceof Date ? f.toISOString() : String(f) };
}

/* ---------- Fotos ---------- */
function carpeta(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}
function guardarFoto(req) {
  if (!req.base64) return { ok: false, error: 'foto vacía' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const padres = DriveApp.getFileById(ss.getId()).getParents();
  const base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  let dest = carpeta(base, CARPETA_FOTOS);
  const cli = String(req.cliente || '').replace(/[\\/:*?"<>|]/g, ' ').trim();
  if (cli) dest = carpeta(dest, cli);
  const nombre = String(req.nombre || ('foto ' + req.k + '.jpg')).replace(/[\\/:*?"<>|]/g, ' ').trim();
  // Si ya se subió (reintento tras un corte), se devuelve la misma
  const previas = dest.getFilesByName(nombre);
  if (previas.hasNext()) { const f0 = previas.next(); return { ok: true, id: f0.getId(), url: f0.getUrl() }; }
  const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mime || 'image/jpeg', nombre);
  const f = dest.createFile(blob);
  return { ok: true, id: f.getId(), url: f.getUrl() };
}

/* Ejecuta esta función una vez desde el editor para dar los permisos (hoja y Drive). */
function autorizar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const padres = DriveApp.getFileById(ss.getId()).getParents();
  Logger.log('Hoja: ' + ss.getName() + ' · carpeta: ' + (padres.hasNext() ? padres.next().getName() : 'Mi unidad'));
}
