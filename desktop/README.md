# Brickwise de escritorio

Instalables de Brickwise para macOS y Windows. **No modifica la app**: Electron solo dibuja la
ventana; dentro corre el mismo servidor de Next.js, ejecutado por un Node.js 24 embebido.

Los datos siguen en `~/.brickwise/brickwise.db` (en Windows, `%USERPROFILE%\.brickwise\`), así que
la app de escritorio, `npm run dev` y `npx brickwise` comparten la misma base de datos.

> **¿Solo quieres instalarlo y usarlo?** La guía para el usuario final está en
> [INSTALACION.md](INSTALACION.md). Esto de aquí es cómo se construye.

## Construir

```bash
cd desktop
npm install
npm run prepare-server     # next build + Node 24 + better-sqlite3 por plataforma (~3 min la 1ª vez)
npm start                  # probar en Electron sin empaquetar
npm run dist:mac           # → dist/Brickwise-<versión>-mac-arm64.dmg (+ .zip)
npm run dist:win           # → dist/Brickwise-<versión>-win-x64-setup.exe
npm run dist               # las dos
```

La versión sale del `package.json` de la raíz del proyecto; aquí no hay que tocar nada.
Para regenerar el icono (y el favicon de la web) a partir de la "B" del navbar: `npm run icon`.
Para regenerar el logotipo horizontal (icono + nombre): `npm run logo` — ver
[../public/brand/README.md](../public/brand/README.md).

## Cómo está montado

| Pieza | Para qué |
|---|---|
| `main.js` | Electron: busca puerto libre en `127.0.0.1`, lanza el servidor, abre la ventana, manda los enlaces externos al navegador del sistema y mata el servidor al salir. |
| `server-host.cjs` | Lo ejecuta el Node embebido. Si Electron muere de golpe, se cierra solo (vigila su `stdin`), así que nunca queda un servidor huérfano. |
| `scripts/prepare-server.mjs` | `next build` con `BRICKWISE_DESKTOP=1` → `.next/standalone`, + `public` y `.next/static`, + Node 24 oficial (sha256 verificado) y el `better_sqlite3.node` de cada plataforma. Deja un árbol listo por target en `stage/pkg/<os>-<arch>/server`. |
| `scripts/after-pack.cjs` | Copia ese árbol y el Node dentro del paquete. electron-builder no puede hacerlo con `extraResources` porque descarta `node_modules` en esas copias. |
| `electron-builder.cjs` | Empaquetado, iconos, DMG/NSIS y modo de firma. |

`better-sqlite3` no publica binarios para el ABI de Electron, por eso se embebe Node 24 (ABI 137),
que sí tiene prebuilds para macOS arm64 y Windows x64. Nada se compila al construir.

## Diagnóstico

- Log del servidor: `~/Library/Logs/Brickwise/server.log` · Windows: `%APPDATA%\Brickwise\logs\server.log`
- Puerto: 41797 si está libre (el siguiente si no). Solo escucha en `127.0.0.1`.
- Cerrar la ventana cierra la app y su servidor.
- El bookmarklet de Property Finder se copia con **clic derecho → Copiar enlace** (dentro de
  Electron no se puede arrastrar a la barra de marcadores del navegador).

## Firmar (macOS)

Sin certificado, el build se firma *ad-hoc*: funciona en tu Mac, pero al enviárselo a otra persona
macOS lo bloqueará (Ajustes → Privacidad y seguridad → "Abrir de todos modos", o
`xattr -dr com.apple.quarantine Brickwise.app`).

Para distribuirlo bien, con tu cuenta de Apple Developer:

1. **Certificado**: Xcode → Settings → Accounts → tu Apple ID → *Manage Certificates…* → "+" →
   **Developer ID Application**. Comprueba que aparece:
   ```bash
   security find-identity -v -p codesigning
   ```
   En cuanto exista, `electron-builder.cjs` lo usa solo (firma real + hardened runtime).
2. **Contraseña específica de app** para notarizar: appleid.apple.com → *Sign-In and Security* →
   *App-Specific Passwords*.
3. Exporta las credenciales antes de construir y el DMG saldrá notarizado (2–10 min extra):
   ```bash
   export APPLE_ID="tu-apple-id@ejemplo.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="4R2C44DHAS"
   npm run dist:mac
   ```
   El script imprime al arrancar qué modo de firma está usando.

En Windows la firma es aparte (certificado OV/EV o Azure Trusted Signing). Sin ella, SmartScreen
muestra "Más información → Ejecutar de todas formas"; la app funciona igual.

## Actualizar dependencias

Si cambia `better-sqlite3` o quieres subir el Node embebido, ajusta `NODE_VERSION` y `NODE_ABI` en
`scripts/prepare-server.mjs`. La comprobación final del script falla si el ABI no cuadra.
