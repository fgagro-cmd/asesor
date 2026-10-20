/**
 * Maestros · FG Agro · servicio privado para las apps
 *
 * Va pegado en el Apps Script de la hoja «Maestro de clientes» (Extensiones → Apps Script).
 * Busca «Maestro de fincas» y «Maestro de productos» en la misma carpeta de Drive (Apps › Maestros),
 * así que no lleva ningún dato ni identificador tuyo dentro.
 *
 * Acciones que piden las apps (siempre con la clave):
 *   ping  -> comprueba que responde
 *   leer  -> devuelve clientes, fincas y productos
 *   alta  -> da de alta un cliente, finca o producto nuevo con el siguiente ID libre
 *            y lo deja marcado en Revisar = «Sí» (amarillo) para que lo repases.
 *            Si la finca ya existe, añade los cultivos que falten (también con Revisar = «Sí»).
 *
 * Las apps solo leen y dan altas (y añaden cultivos a una finca): nunca borran nada de los maestros.
 */

const CLAVE = 'CAMBIA-ESTA-CLAVE'; // la misma que escribas en Ajustes → Maestros de cada app

const MAESTROS = {
  cliente: { archivo: 'Maestro de clientes', pestana: 'Clientes', prefijo: 'C' },
  finca: { archivo: 'Maestro de fincas', pestana: 'Fincas', prefijo: 'F' },
  producto: { archivo: 'Maestro de productos', pestana: 'Productos', prefijo: 'P' },
};

function doGet() {
  return salida({ ok: true, mensaje: 'Maestros FG Agro: servicio activo' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return salida({ ok: false, error: 'petición no válida' }); }
  if (!req || req.clave !== CLAVE) return salida({ ok: false, error: 'clave' });
  try {
    if (req.accion === 'ping') return salida({ ok: true });
    if (req.accion === 'leer') return salida(leerTodo());
    if (req.accion === 'alta') {
      const lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try { return salida(alta(req)); } finally { lock.releaseLock(); }
    }
    return salida({ ok: false, error: 'accion desconocida' });
  } catch (err) {
    return salida({ ok: false, error: String((err && err.message) || err) });
  }
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Acceso a las hojas ---------- */
function libro(tipo) {
  const m = MAESTROS[tipo];
  const propio = SpreadsheetApp.getActiveSpreadsheet();
  if (propio.getName() === m.archivo) return propio;
  const carpetas = DriveApp.getFileById(propio.getId()).getParents();
  while (carpetas.hasNext()) {
    const fs = carpetas.next().getFilesByName(m.archivo);
    while (fs.hasNext()) {
      const f = fs.next();
      if (f.getMimeType() === MimeType.GOOGLE_SHEETS && !f.isTrashed()) return SpreadsheetApp.open(f);
    }
  }
  throw new Error('No encuentro «' + m.archivo + '» en la carpeta de los maestros');
}

function hojaDe(tipo) {
  const m = MAESTROS[tipo];
  const ss = libro(tipo);
  const sh = ss.getSheetByName(m.pestana) || ss.getSheets()[0];
  return sh;
}

// Devuelve la cabecera y las filas como objetos {cabecera: valor}
function tabla(tipo) {
  const sh = hojaDe(tipo);
  const datos = sh.getDataRange().getValues();
  const cab = datos[0].map(function (c) { return String(c).trim(); });
  const filas = [];
  for (let i = 1; i < datos.length; i++) {
    const r = datos[i];
    if (!String(r[0]).trim()) continue;
    const o = {};
    cab.forEach(function (c, j) { o[c] = r[j] instanceof Date ? r[j].toISOString().slice(0, 10) : String(r[j]).trim(); });
    o._fila = i + 1;
    filas.push(o);
  }
  return { sh: sh, cab: cab, filas: filas };
}

const lista = function (s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
const num = function (s) { const n = parseFloat(String(s || '').replace(',', '.')); return isFinite(n) ? n : null; };

function leerTodo() {
  const cl = tabla('cliente').filas.map(function (r) {
    return { id: r['ID'], nombre: r['Nombre'], alias: lista(r['Alias']), tipo: r['Tipo'], servicios: lista(r['Servicios']), estado: r['Estado'] || 'Activo', municipio: r['Municipio'] || '' };
  });
  const fi = tabla('finca').filas.map(function (r) {
    return { id: r['ID'], nombre: r['Nombre'], clienteId: r['Cliente ID'], propia: /^s[ií]/i.test(r['Propia']), cultivos: lista(r['Cultivos']), municipio: r['Municipio'] || '', ha: num(r['Superficie (ha)']), alias: lista(r['Alias']) };
  });
  const pr = tabla('producto').filas.map(function (r) {
    return { id: r['ID'], nombre: r['Nombre'], proveedor: r['Proveedor'] || '', categoria: r['Categoría'] || '', subtipo: r['Subtipo'] || '', unidad: r['Unidad'] || '', presentaciones: lista(r['Presentaciones en Ventas']), alias: lista(r['Alias']), activo: !/^no/i.test(r['Activo'] || 'Sí') };
  });
  return { ok: true, fecha: new Date().toISOString(), clientes: cl, fincas: fi, productos: pr };
}

/* ---------- Altas ---------- */
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function hoy() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'); }

function alta(req) {
  const tipo = req.tipo;
  const m = MAESTROS[tipo];
  if (!m) return { ok: false, error: 'tipo desconocido' };
  const d = req.datos || {};
  const nombre = String(d.nombre || '').trim();
  if (!nombre) return { ok: false, error: 'falta el nombre' };
  const app = String(req.app || 'una app').trim();
  const t = tabla(tipo);

  // ¿Ya existe? (por nombre o alias; las fincas, además, del mismo cliente)
  const n = norm(nombre);
  const igual = t.filas.find(function (r) {
    if (tipo === 'finca' && r['Cliente ID'] !== String(d.clienteId || '')) return false;
    return norm(r['Nombre']) === n || lista(r['Alias']).some(function (a) { return norm(a) === n; });
  });
  if (igual) {
    // Finca que ya existe: se añaden los cultivos nuevos (p. ej. anotados en una visita de Asesor)
    if (tipo === 'finca' && Array.isArray(d.cultivos) && d.cultivos.length) {
      const colC = t.cab.indexOf('Cultivos');
      const actuales = lista(igual['Cultivos']);
      const nuevos = d.cultivos.filter(function (c) { return String(c || '').trim() && !actuales.some(function (x) { return norm(x) === norm(c); }); });
      if (colC > -1 && nuevos.length) {
        t.sh.getRange(igual._fila, colC + 1).setValue(actuales.concat(nuevos.map(function (c) { return String(c).trim(); })).join(', '));
        marcar(t, igual._fila, 'Cultivo ' + nuevos.join(', ') + ' añadido desde ' + app + ' el ' + hoy() + '.');
      }
    }
    if (tipo === 'producto' && d.presentacion) {
      const col = t.cab.indexOf('Presentaciones en Ventas');
      const pres = lista(igual['Presentaciones en Ventas']);
      if (col > -1 && !pres.some(function (p) { return norm(p) === norm(d.presentacion); })) {
        pres.push(String(d.presentacion).trim());
        t.sh.getRange(igual._fila, col + 1).setValue(pres.join(', '));
        marcar(t, igual._fila, 'Presentación «' + d.presentacion + '» añadida desde ' + app + ' el ' + hoy() + '.');
      }
    }
    return { ok: true, id: igual['ID'], existe: true };
  }

  // Siguiente ID libre (nunca se reutiliza uno)
  let max = 0;
  t.filas.forEach(function (r) { const k = parseInt(String(r['ID']).slice(1), 10); if (k > max) max = k; });
  const id = m.prefijo + String(max + 1).padStart(3, '0');
  const nota = 'Alta desde ' + app + ' el ' + hoy() + '.' + (d.nota ? ' ' + d.nota : '');

  const v = { 'ID': id, 'Nombre': nombre, 'Aparece en': app, 'Nota': nota, 'Revisar': 'Sí' };
  if (tipo === 'cliente') {
    v['Tipo'] = d.tipo || 'Cliente';
    v['Servicios'] = (d.servicios || []).join(', ');
    v['Estado'] = 'Activo';
  } else if (tipo === 'finca') {
    v['Cliente ID'] = d.clienteId || '';
    v['Cliente (nombre)'] = d.clienteNombre || '';
    v['Propia'] = d.propia ? 'Sí' : 'No';
    v['Cultivos'] = (d.cultivos || []).join(', ');
    v['Municipio'] = d.municipio || '';
  } else {
    v['Proveedor'] = d.proveedor || '';
    v['Categoría'] = d.categoria || '';
    v['Subtipo'] = d.subtipo || '';
    v['Unidad'] = d.unidad || '';
    v['Presentaciones en Ventas'] = d.presentacion || '';
    v['Activo'] = 'Sí';
  }
  t.sh.appendRow(t.cab.map(function (c) { return v[c] != null ? v[c] : ''; }));
  return { ok: true, id: id, existe: false };
}

function marcar(t, fila, texto) {
  const cr = t.cab.indexOf('Revisar'), cn = t.cab.indexOf('Nota');
  if (cr > -1) t.sh.getRange(fila, cr + 1).setValue('Sí');
  if (cn > -1) {
    const r = t.sh.getRange(fila, cn + 1);
    const prev = String(r.getValue() || '').trim();
    r.setValue(prev ? prev + ' ' + texto : texto);
  }
}
