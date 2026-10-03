# ARCHITECTURE — claude-archive-close-tab

Extensión de VS Code que cierra la pestaña de editor de una sesión de Claude Code cuando se archiva en la extensión oficial de Anthropic. Corre en el **cliente** (`extensionKind: ui`): instalada en los dos Macs (casa y CloudBlue). La copia del servidor x86 está desactivada desde el 01-10-2026 (`claude-archive-close-tab.disabled-20261001T1420` en `~/.vscode-server/extensions`): allí el estado que lee está vacío.

## Clientes y versiones

- Un cliente: VS Code (`engines.vscode ^1.94.0`) con la extensión oficial `claude-code` (verificada con 2.1.286). Publisher `local`, licencia MIT; la versión manda en `package.json`.
- `extension.js` (enganche con VS Code) y `lib/matching.js` (lógica pura de qué pestaña cerrar). Sin API ni otros clientes.

## Ajustes y comandos

`enabled`, `notifications` (`off`/`statusBar`/`notification`), `skipPinnedTabs`, `recentLabelSeconds`, `safetyNetSeconds` y `sqlitePath` (sección `claudeArchiveCloseTab`), más los comandos «Open Settings» y «Show Log». Textos en `package.nls.json` y `package.nls.es.json`. Logo: `images/icon.svg` → `images/icon.png` (el PNG es el que empaqueta el VSIX).

## Dependencias (en ambos sentidos)

- Depende de: el estado **privado y no documentado** que VS Code persiste: `state.vscdb` de `globalStorage` (clave `Anthropic.claude-code`, campo `hiddenSessionIds`) y de `workspaceStorage` (`panelTabSessions`), leídos con `/usr/bin/sqlite3` en solo lectura; y de los webviews cuyo tipo contiene `claudeVSCodePanel`.
- No depende de él ningún servicio.
- Riesgo: la extensión oficial puede cambiar ese esquema sin aviso (la ruta de la base descrita en el README es la del Mac; la del host remoto x86 no está verificada).

## Stack

JavaScript sin build ni dependencias de npm. `sqlite3` del sistema por línea de comandos. API de VS Code: `fs.watch` sobre el directorio, `onDidChangeTabs` y un sondeo de seguridad cada 60 s.

## Componentes compartidos

Ninguno: no reutiliza ni exporta nada. El título de la pestaña se compara con el título truncado con `…` de `panelTabSessions`; si coincide más de una pestaña, no cierra ninguna.

Al archivar la sesión que una pestaña está mostrando, la extensión oficial cambia esa misma pestaña a otra sesión (o a una nueva, «Claude Code») en el acto, antes de que el archivado llegue a `state.vscdb`. Por eso la extensión recuerda la etiqueta que cada pestaña tuvo hasta hace `max(90, safetyNetSeconds + 30)` s y los títulos de `panelTabSessions` ya vistos: gana la pestaña que aún muestra el título y, si no hay, la que lo mostraba hace un momento.

## Cómo se construye

Un fichero de JavaScript plano. Nunca escribe en las bases de VS Code (solo lectura). Al activarse siembra el conjunto de sesiones ya archivadas para no cerrar pestañas antiguas en masa.

## Tests

`npm test`: `node:test` sobre `lib/matching.js` (coincidencia de títulos, pestaña que cambió de sesión, ambigüedad).

## CI/CD y despliegue

- `ci.yml`: en cada PR, tests y empaquetado del `.vsix`.
- `release.yml`: un merge a `main` con una `version` sin tag es una versión nueva. El build del `.vsix` y el **changelog** van en paralelo; el changelog sale del título y la descripción de cada PR mergeada y de los commits desde el tag anterior (`scripts/changelog.sh`). Los dos acaban en una GitHub release `vX.Y.Z`.
- `pr-review.yml`: la review automática de la casa (reusable de `k8s-gitops-pocharlies`).
- Runners de GitHub (repo personal y público): `arc-k8s` es solo de `pocharlies-org`.
- Despliegue: `code --install-extension` del `.vsix` de la release en cada Mac y recargar la ventana.

## Decisiones y trampas

- Lee un formato interno de otra extensión: se puede romper con cualquier actualización de `claude-code`. El log del canal «Claude Archive Close Tab» dice qué decidió en cada archivado.
- `LabelHistory` supone que VS Code conserva el mismo objeto `Tab` mientras la pestaña está abierta y solo le cambia los campos. No está documentado; si VS Code recreara los objetos, el plugin vuelve al comportamiento anterior (cerrar solo si la etiqueta actual coincide), nunca cierra una equivocada. Un «matched by recent label» en el log confirma la suposición.
- Falso positivo acotado: si una pestaña pasa de la sesión X a otra por otra vía y X se archiva desde la lista dentro de la ventana (`recentLabelSeconds`), se cierra esa pestaña. No se pierde ninguna sesión: cerrar una pestaña no archiva ni borra nada.
