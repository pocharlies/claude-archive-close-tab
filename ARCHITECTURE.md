# ARCHITECTURE — claude-archive-close-tab

Extensión de VS Code que cierra la pestaña de editor de una sesión de Claude Code cuando se archiva en la extensión oficial de Anthropic. **Desactivada en el host desde el 01-10-2026** (carpeta `claude-archive-close-tab.disabled-20261001T1420` en `~/.vscode-server/extensions`).

## Clientes y versiones

- Un cliente: VS Code (`engines.vscode ^1.94.0`) con la extensión oficial `claude-code`. Versión 0.1.0, publisher `local`, licencia MIT.
- Un único fichero, `extension.js` (333 líneas). Sin API ni otros clientes.

## Dependencias (en ambos sentidos)

- Depende de: el estado **privado y no documentado** que VS Code persiste: `state.vscdb` de `globalStorage` (clave `Anthropic.claude-code`, campo `hiddenSessionIds`) y de `workspaceStorage` (`panelTabSessions`), leídos con `/usr/bin/sqlite3` en solo lectura; y de los webviews cuyo tipo contiene `claudeVSCodePanel`.
- No depende de él ningún servicio.
- Riesgo: la extensión oficial puede cambiar ese esquema sin aviso (la ruta de la base descrita en el README es la del Mac; la del host remoto x86 no está verificada).

## Stack

JavaScript sin build ni dependencias de npm. `sqlite3` del sistema por línea de comandos. API de VS Code: `fs.watch` sobre el directorio, `onDidChangeTabs` y un sondeo de seguridad cada 60 s.

## Componentes compartidos

Ninguno: no reutiliza ni exporta nada. El título de la pestaña se compara con el título truncado con `…` de `panelTabSessions`; si coincide más de una pestaña, no cierra ninguna.

## Cómo se construye

Un fichero de JavaScript plano. Nunca escribe en las bases de VS Code (solo lectura). Al activarse siembra el conjunto de sesiones ya archivadas para no cerrar pestañas antiguas en masa.

## Tests

Ninguno. Sin CI.

## CI/CD y despliegue

Sin CI. Se instala empaquetada o desde la carpeta de extensiones (hoy, deshabilitada).

## Decisiones y trampas

- Lee un formato interno de otra extensión: se rompe con cualquier actualización de `claude-code`. Por eso está desactivada.
- Propuesta (no se ejecuta aquí): archivar el repo (ver C5 de SC-1425).
