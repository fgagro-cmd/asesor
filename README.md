# Asesor · FG Agro

App para el móvil, la tablet y el ordenador que une **Visitas**, el **Generador de tratamientos** y **Clientes**:

- **Visitas**: fincas que toca visitar, seguimientos pendientes, nueva visita con plagas por nivel, estado fenológico, acción pendiente y fotos.
- **Tratamientos**: recomendación con orden de mezcla, plantillas, imagen para WhatsApp, historial y Excel.
- **Clientes**: ficha de cada cliente (última visita, fincas que tocan, visitas, tratamientos, planes y cobros), planes de abonado enviados por mes y cobros.

Clientes, fincas y cultivos salen de los **maestros** (Drive › Apps › Maestros). Cada aparato guarda sus datos y funciona sin conexión. Desde la **1.2.0** la hoja **«Asesor»** (Drive › Apps › Asesor) es la copia común de todos tus aparatos: cada cambio se envía solo, cada 3 minutos (y al abrir la app) se recogen los cambios de los otros aparatos, y si un mismo dato se cambia en dos sitios se queda el cambio más reciente. Los borrados también pasan de un aparato a otro. Las fotos se suben a la carpeta «Fotos de visitas» junto a esa hoja.

Pantalla: en el móvil, pestañas abajo; desde 760 px de ancho (tablet y ordenador), pestañas en una columna a la izquierda, listas a lo ancho (a dos columnas desde 1024 px) y la ficha y los formularios en un panel a la derecha (se cierra con Esc).

El repositorio es público: **no lleva ningún dato de clientes**. Los datos se traen desde las copias de las apps antiguas (⚙ Ajustes → «Traer datos de las apps antiguas»).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html`, `style.css`, `app.js` | La app |
| `logic.js` | Cálculos (visitas, planes y cobros, importación, tablas de la hoja, fusión entre aparatos) |
| `maestros.js` | Enlace con los maestros (el mismo que en Ventas, Gestión fincas y AgroServicios) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y funcionamiento sin conexión |
| `vendor/` | Letras de la tarjeta, html2canvas (imagen) y xlsx (Excel) |
| `google-sheets/Codigo.gs` | Script de la hoja «Asesor» |
| `google-sheets/Maestros-Codigo.gs` | Script de los maestros, versión que añade cultivos nuevos a una finca |

## Puesta en marcha

### 1. Script de la hoja «Asesor»
1. Abre la hoja **Asesor** (Drive › Apps › Asesor) → **Extensiones → Apps Script**.
2. Borra lo que haya, pega `google-sheets/Codigo.gs` y cambia `CAMBIA-ESTA-CLAVE` por una clave tuya.
3. Guarda. En el desplegable de funciones elige **autorizar** → **Ejecutar** → acepta los permisos (hoja y Drive, para las fotos).
4. **Implementar → Nueva implementación** → tipo **Aplicación web** → Ejecutar como **Yo** → Quién tiene acceso **Cualquier usuario** → **Implementar**. Copia la dirección que termina en `/exec`.

### 2. Script de los maestros (opcional, recomendado)
Para que los cultivos que añadas en una visita lleguen al Maestro de fincas:
1. Abre **Maestro de clientes** → Extensiones → Apps Script.
2. Copia tu línea `const CLAVE = '…'`, borra todo, pega `google-sheets/Maestros-Codigo.gs` y vuelve a poner tu línea de la clave.
3. Guarda → **Implementar → Gestionar implementaciones** → lápiz ✏ → Versión: **Nueva versión** → **Implementar**. La dirección no cambia.

Sin este paso todo funciona igual; los cultivos nuevos se quedan solo en Asesor.

### 3. En la app
1. ⚙ → **Maestros**: la misma dirección y clave que en Ventas → «Probar y conectar».
2. ⚙ → **Tus aparatos (hoja «Asesor»)**: la dirección del paso 1 y su clave → «Probar y conectar».
3. En cada app antigua descarga su copia (Visitas: Ajustes → «Descargar copia»; Generador: «Copia de seguridad» → «Descargar copia»; Clientes: ⚙ → «Exportar copia (.json)»).
4. En Asesor: ⚙ → «Traer datos de las apps antiguas» → elige los tres archivos.
5. ⚙ → «Revisar enlaces»: enlaza o da de alta los clientes y fincas que no se reconozcan.

### 4. Otro aparato (tablet u ordenador)
1. Abre https://fgagro-cmd.github.io/asesor/ en Edge o Chrome e instálala (menú ⋯ → Aplicaciones → Instalar).
2. ⚙ → **Tus aparatos (hoja «Asesor»)**: la misma dirección y clave → «Probar y conectar» → «Cargar y conectar».
3. Se carga todo lo de la hoja y se conectan solos los maestros y Planes de abonado (sus direcciones viajan en la copia de la hoja).

Las fotos que aún no se han subido solo están en el aparato donde se hicieron; en los demás salen como «en otro aparato, por subir» hasta que se suben.

## Actualizar la app
Al cambiar cualquier archivo, sube `VERSION` en `sw.js` (y `APP_VERSION` en `app.js`) para que los aparatos recojan la versión nueva. Los datos están en cada aparato y en la hoja, y no se pierden.

### Paso a la 1.2.0 (varios aparatos)
1. Sube los archivos nuevos a GitHub.
2. Pega el `google-sheets/Codigo.gs` nuevo en el Apps Script de la hoja «Asesor» (conservando tu línea `const CLAVE = '…'`) → Guardar → **Implementar → Gestionar implementaciones** → lápiz ✏ → **Nueva versión** → Implementar. La dirección no cambia.
3. **Primero el móvil**: abre Asesor con conexión, ciérrala y vuélvela a abrir hasta ver «Asesor 1.2.0» al final de ⚙ Ajustes. Comprueba que pone «☁ Al día con tus aparatos».
4. Después la tablet y el ordenador (apartado 4).

Si un aparato se queda con la versión antigua, la hoja ya no le deja subir nada («Actualiza Asesor a la versión 1.2.0»), para que no pise lo de los demás.
