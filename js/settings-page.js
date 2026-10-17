// Página Ajustes.
import { settings, updateSettings } from './store.js'
import { clearCache } from './lichess-data.js'

const HTML = `
<div class="page-head"><div><h1>Ajustes</h1><p class="lead">Se guardan solo en este navegador.</p></div></div>
<section class="card narrow">
  <h3>Jugadores</h3>
  <p class="note">El dashboard y el árbol de tus aperturas se leen directamente de estas cuentas de Lichess.</p>
  <div id="s-players"></div>
  <p class="note">El token de puzzles es opcional y solo sirve para ver el acierto por tema. Cada jugador lo crea con su cuenta en lichess.org/account/oauth/token marcando solo "Leer la actividad de puzzles".</p>
  <h3>Datos descargados</h3>
  <label class="field"><span>Partidas desde</span><input id="s-from" type="date"></label>
  <p class="note">La primera vez se descargan todas las partidas desde esta fecha; después solo las nuevas. Quedan guardadas en este navegador.</p>
  <div class="row gap"><button class="btn" id="s-clear" type="button">Borrar datos descargados</button><span class="note" id="s-clear-msg"></span></div>
  <h3>Lichess</h3>
  <label class="field"><span>Token personal (opcional)</span><input id="s-token" type="password" autocomplete="off" placeholder="lip_…"></label>
  <p class="note">Solo hace falta para el explorador de maestros y para descargar partidas más rápido. Créalo en lichess.org/account/oauth/token sin marcar ningún permiso.</p>
  <h3>Stockfish</h3>
  <div class="row gap">
    <label class="field"><span>Profundidad</span><input id="s-depth" type="number" min="8" max="30"></label>
    <label class="field"><span>Líneas</span><input id="s-lines" type="number" min="1" max="5"></label>
  </div>
  <div class="row gap"><button class="btn primary" id="s-save" type="button">Guardar</button><span class="note" id="s-msg"></span></div>
</section>`

export function init(root) {
  root.innerHTML = HTML
  const box = root.querySelector('#s-players')
  box.innerHTML = settings.players.map((p, i) => `
    <div class="row gap flexwrap">
      <label class="field"><span>Nombre</span><input data-p="${i}" data-k="name"></label>
      <label class="field grow"><span>Usuario de Lichess</span><input data-p="${i}" data-k="lichess" placeholder="usuario"></label>
      <label class="field grow"><span>Token de puzzles</span><input data-p="${i}" data-k="puzzleToken" type="password" autocomplete="off" placeholder="lip_…"></label>
    </div>`).join('')
  box.querySelectorAll('input').forEach((inp) => { inp.value = settings.players[inp.dataset.p][inp.dataset.k] || '' })
  root.querySelector('#s-from').value = settings.historyFrom
  root.querySelector('#s-token').value = settings.lichessToken
  root.querySelector('#s-depth').value = settings.engineDepth
  root.querySelector('#s-lines').value = settings.engineLines
  root.querySelector('#s-clear').addEventListener('click', async () => {
    await clearCache()
    root.querySelector('#s-clear-msg').textContent = 'Borrados. Se volverán a descargar al abrir el dashboard.'
  })
  root.querySelector('#s-save').addEventListener('click', () => {
    const val = (i, k) => box.querySelector(`[data-p="${i}"][data-k="${k}"]`).value.trim()
    const players = settings.players.map((p, i) => ({
      name: val(i, 'name') || p.name,
      lichess: val(i, 'lichess'),
      puzzleToken: val(i, 'puzzleToken'),
    }))
    updateSettings({
      players,
      historyFrom: root.querySelector('#s-from').value || '2026-01-01',
      lichessToken: root.querySelector('#s-token').value.trim(),
      engineDepth: Math.max(8, Math.min(30, Number(root.querySelector('#s-depth').value) || 18)),
      engineLines: Math.max(1, Math.min(5, Number(root.querySelector('#s-lines').value) || 3)),
    })
    root.querySelector('#s-msg').textContent = 'Guardado.'
  })
}
