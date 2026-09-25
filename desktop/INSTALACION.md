# Instalar Brickwise

Guía para **usar** Brickwise. Si lo que quieres es construir los instalables, eso está en
[README.md](README.md).

## Tres formas de tenerlo

| Vía | Para quién | ¿Necesita Node? |
|---|---|---|
| **App de escritorio** (`.dmg` / `.exe`) | Uso normal. Un icono, doble clic, listo. | No — lleva su propio Node 24 dentro |
| **`npx brickwise`** | Ya tienes Node y no quieres instalar nada más | Sí, 18.18+ |
| **Clonar el repo** | Desarrollo | Sí, 18.18+ |

Las tres comparten la **misma base de datos** (`~/.brickwise/brickwise.db`), así que puedes
alternar entre ellas sin perder nada. Eso sí: **no las abras a la vez**, son dos procesos
escribiendo en el mismo SQLite.

## Requisitos

| | macOS | Windows |
|---|---|---|
| Versión | 12 Monterey o superior | 10 / 11, 64 bits |
| Procesador | **Apple Silicon** (M1/M2/M3/M4). No hay build para Intel | x64 |
| Disco | ~400 MB | ~330 MB |
| Permisos | Ninguno especial | No pide administrador (se instala para tu usuario) |

Internet hace falta para consultar Property Finder, no para arrancar. La app **no expone nada
a la red**: el servidor escucha solo en `127.0.0.1`.

---

## macOS

1. Descarga **`Brickwise-<versión>-mac-arm64.dmg`**.
2. Ábrelo y **arrastra Brickwise a la carpeta Aplicaciones** que aparece al lado.
3. Expulsa el disco montado (clic derecho → Expulsar) y borra el `.dmg` si quieres.
4. **El primer arranque va por clic derecho**, no por doble clic:
   **clic derecho sobre Brickwise → Abrir → Abrir**.

### Por qué macOS protesta la primera vez

El build está firmado **ad-hoc**: sin certificado "Developer ID Application" de Apple y sin
notarizar. Gatekeeper lo bloquea con un mensaje tipo *"No se puede abrir porque Apple no puede
comprobar si contiene software malicioso"*. Es esperable, no es que esté roto. Tres salidas, de
menos a más bruta:

- **Clic derecho → Abrir**, y luego **Abrir** en el diálogo. Se recuerda para siempre.
- Si ya te lo bloqueó con doble clic: **Ajustes del Sistema → Privacidad y seguridad**, bajar hasta
  el aviso de Brickwise → **"Abrir de todos modos"**.
- Si sale *"está dañado y no se puede abrir"* (pasa al descargarlo desde ciertos navegadores o
  servicios de mensajería, que le ponen la marca de cuarentena):

  ```bash
  xattr -dr com.apple.quarantine /Applications/Brickwise.app
  ```

Para que esto deje de pasar del todo hay que firmar con Developer ID y notarizar: los pasos están
en [README.md → Firmar (macOS)](README.md#firmar-macos).

### Comprobar que el descargado es el bueno

```bash
shasum -a 256 ~/Descargas/Brickwise-*-mac-arm64.dmg
```

Compáralo con el hash que te hayan pasado junto al archivo.

### El `.zip` en vez del `.dmg`

Al lado del DMG hay un `.zip` con la misma app. Sirve para lo mismo: descomprimir y mover
`Brickwise.app` a `/Applications`. Es el formato que usan los actualizadores automáticos; para
instalar a mano, el DMG es más cómodo.

---

## Windows

1. Descarga **`Brickwise-<versión>-win-x64-setup.exe`**.
2. Ejecútalo. **SmartScreen** dirá que no reconoce al editor:
   **"Más información" → "Ejecutar de todas formas"**. Mismo motivo que en macOS: el ejecutable no
   está firmado con un certificado de código.
3. Si te pregunta para quién instalar, con **"Solo para mí"** no hace falta administrador.
4. Puedes cambiar la carpeta. Por defecto va a:

   ```
   %LOCALAPPDATA%\Programs\Brickwise
   ```

5. Al terminar tendrás **acceso directo en el escritorio y en el menú Inicio**.

El firewall de Windows **no debería preguntar nada**, porque el servidor interno se ata a
`127.0.0.1` y no a `0.0.0.0`. Si aparece un aviso de firewall, puedes darle a **Cancelar** sin que
la app deje de funcionar.

Para verificar la descarga:

```powershell
Get-FileHash .\Brickwise-0.1.44-win-x64-setup.exe -Algorithm SHA256
```

---

## Qué pasa al abrirla

1. Se abre una ventana de 1440×900 con la app dentro.
2. Por debajo arranca un servidor Next.js local en **`http://127.0.0.1:41797`** — si ese puerto
   está ocupado, coge el siguiente libre.
3. La base de datos se crea sola en la primera ejecución:

   | | Ruta |
   |---|---|
   | macOS | `~/.brickwise/brickwise.db` |
   | Windows | `%USERPROFILE%\.brickwise\brickwise.db` |

4. **Cerrar la ventana cierra la app y mata su servidor.** No queda nada corriendo por detrás.

### Copia de seguridad

Todo tu histórico —favoritos, análisis, pipeline, service charges, ajustes— está en ese único
fichero `.db`. Copiarlo es la copia de seguridad; restaurar es volver a ponerlo en su sitio con la
app cerrada.

### El bookmarklet de Property Finder

Dentro de la app de escritorio **no se puede arrastrar el bookmarklet a la barra de marcadores**
(Electron no permite el arrastre hacia el navegador). Se hace así:

1. **Clic derecho sobre el enlace del bookmarklet → "Copiar enlace"**.
2. En tu navegador, crea un marcador nuevo cualquiera.
3. Edítalo y **pega lo copiado en el campo de la URL**.

---

## Actualizar

Los datos viven **fuera** de la app, así que una actualización nunca los toca.

- **macOS** — abre el DMG nuevo y arrastra a Aplicaciones; cuando pregunte, **Reemplazar**.
  Cierra Brickwise antes. Si el sistema vuelve a pedir confirmación al abrir, es el mismo
  clic derecho → Abrir de la primera vez.
- **Windows** — ejecuta el nuevo `setup.exe` encima. No hace falta desinstalar la versión anterior.

La versión instalada se ve en el log (primera línea al arrancar) y, en macOS, en
**Finder → Aplicaciones → Brickwise → Obtener información**.

## Desinstalar

| | App | Logs | Datos |
|---|---|---|---|
| macOS | `/Applications/Brickwise.app` → Papelera | `~/Library/Logs/Brickwise/` | `~/.brickwise/` |
| Windows | Configuración → Aplicaciones → Brickwise → Desinstalar | `%APPDATA%\Brickwise\logs\` | `%USERPROFILE%\.brickwise\` |

**Borra la carpeta de datos solo si quieres perder el histórico**: es lo único que no se recupera
reinstalando.

---

## Sin instalar nada: `npx`

Si ya tienes [Node.js](https://nodejs.org) 18.18 o superior:

```bash
npx brickwise
```

Copia la app a `~/.brickwise/app`, instala sus dependencias (~1 min la primera vez), busca un puerto
libre y la abre en tu navegador. Misma base de datos que la app de escritorio.

Y para desarrollo:

```bash
git clone https://github.com/eljommys/brickwise.git
cd brickwise
npm install
npm run dev      # → http://localhost:3000
```

---

## Cuando algo no va

**Lo primero, siempre, es el log del servidor:**

| macOS | `~/Library/Logs/Brickwise/server.log` |
|---|---|
| **Windows** | `%APPDATA%\Brickwise\logs\server.log` |

```bash
# macOS: ver el log en vivo mientras abres la app
tail -f ~/Library/Logs/Brickwise/server.log
```

Se rota solo al pasar de 5 MB (el anterior queda como `server.log.1`). Arranque sano:

```
[brickwise ...] Brickwise 0.1.44 · electron 43.4.1 · darwin-arm64
[brickwise ...] node=/Applications/Brickwise.app/Contents/Resources/node/node server=... port=41797
▲ Next.js 16.2.10
✓ Ready in 0ms
[brickwise ...] listo en http://127.0.0.1:41797 · datos en /Users/tu-usuario/.brickwise
```

| Síntoma | Qué pasa |
|---|---|
| *"No se puede abrir porque Apple no puede comprobar…"* | Firma ad-hoc. Clic derecho → Abrir (arriba). |
| *"Brickwise está dañado"* | Marca de cuarentena. `xattr -dr com.apple.quarantine /Applications/Brickwise.app`. |
| SmartScreen bloquea el `.exe` | Sin firma de código. "Más información" → "Ejecutar de todas formas". |
| No abre en un Mac Intel | No hay build para Intel. Usa `npx brickwise`. |
| Ventana en blanco o error del servidor | Mira el log. Suele ser la base de datos: prueba a renombrar `~/.brickwise/brickwise.db` y reabrir para descartar. |
| "El servidor local se cerró inesperadamente" | El diálogo trae la ruta del log; el motivo está en sus últimas líneas. |
| El puerto 41797 está ocupado | No es problema: coge el siguiente libre. Lo dice el log. |
| Quiero la base de datos en otro sitio | Variable de entorno `BRICKWISE_DB`. En la app de escritorio hay que ponerla a nivel de sistema (`launchctl setenv` en macOS) porque no hereda el entorno de la terminal; con `npx brickwise` basta exportarla antes. |

Ni la base de datos ni los logs salen de tu máquina: no hay telemetría, ni cuenta, ni servidor
de Brickwise en ninguna parte. Las únicas conexiones que abre la app son a las fuentes de datos
que consulta —Property Finder, OpenStreetMap (Overpass), Dubai Pulse y AirROI—, y solo cuando le
pides un análisis.
