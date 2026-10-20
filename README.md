# Asesor · FG Agro

App para el móvil (y consulta en el ordenador) que une **Visitas**, el **Generador de tratamientos** y **Clientes**:

- **Visitas**: fincas que toca visitar, seguimientos pendientes, nueva visita con plagas por nivel, estado fenológico, acción pendiente y fotos.
- **Tratamientos**: recomendación con orden de mezcla, plantillas, imagen para WhatsApp, historial y Excel.
- **Clientes**: ficha de cada cliente (última visita, fincas que tocan, visitas, tratamientos, planes y cobros), planes de abonado enviados por mes y cobros.

Clientes, fincas y cultivos salen de los **maestros** (Drive › Apps › Maestros). Los datos viven en el móvil y funcionan sin conexión. Hay copia automática de un solo sentido a la hoja **«Asesor»** (Drive › Apps › Asesor) y las fotos se suben a la carpeta «Fotos de visitas» junto a esa hoja.

El repositorio es público: **no lleva ningún dato de clientes**. Los datos se traen desde las copias de las apps antiguas (⚙ Ajustes → «Traer datos de las apps antiguas»).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html`, `style.css`, `app.js` | La app |
| `logic.js` | Cálculos (visitas, planes y cobros, importación, tablas de la hoja) |
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
2. ⚙ → **Copia a la hoja «Asesor»**: la dirección del paso 1 y su clave → «Probar y activar».
3. En cada app antigua descarga su copia (Visitas: Ajustes → «Descargar copia»; Generador: «Copia de seguridad» → «Descargar copia»; Clientes: ⚙ → «Exportar copia (.json)»).
4. En Asesor: ⚙ → «Traer datos de las apps antiguas» → elige los tres archivos.
5. ⚙ → «Revisar enlaces»: enlaza o da de alta los clientes y fincas que no se reconozcan.

## Actualizar la app
Al cambiar cualquier archivo, sube `VERSION` en `sw.js` (y `APP_VERSION` en `app.js`) para que el móvil recoja la versión nueva. Los datos están en el móvil y no se pierden.
