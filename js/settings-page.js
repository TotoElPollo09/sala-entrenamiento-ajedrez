// Página Ajustes.
import { settings, updateSettings } from './store.js'

const HTML = `
<div class="page-head"><div><h1>Ajustes</h1><p class="lead">Se guardan solo en este navegador.</p></div></div>
<section class="card narrow">
  <h3>Jugadores</h3>
  <p class="note">El nombre debe coincidir con la columna Jugador de tu hoja. El usuario de Lichess sirve para el árbol de tus aperturas.</p>
  <div id="s-players"></div>
  <h3>Hoja de Google</h3>
  <label class="field"><span>Enlace o ID de la hoja</span><input id="s-sheet" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
  <p class="note">La hoja tiene que estar compartida como "Cualquier persona con el enlace: lector" para que la web la pueda leer.</p>
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
    <div class="row gap">
      <label class="field"><span>Nombre</span><input data-p="${i}" data-k="name"></label>
      <label class="field grow"><span>Usuario de Lichess</span><input data-p="${i}" data-k="lichess" placeholder="usuario"></label>
    </div>`).join('')
  box.querySelectorAll('input').forEach((inp) => { inp.value = settings.players[inp.dataset.p][inp.dataset.k] || '' })
  root.querySelector('#s-sheet').value = settings.sheetId
  root.querySelector('#s-token').value = settings.lichessToken
  root.querySelector('#s-depth').value = settings.engineDepth
  root.querySelector('#s-lines').value = settings.engineLines
  root.querySelector('#s-save').addEventListener('click', () => {
    const players = settings.players.map((p, i) => ({
      name: box.querySelector(`[data-p="${i}"][data-k="name"]`).value.trim() || p.name,
      lichess: box.querySelector(`[data-p="${i}"][data-k="lichess"]`).value.trim(),
    }))
    updateSettings({
      players,
      sheetId: sheetIdFrom(root.querySelector('#s-sheet').value),
      lichessToken: root.querySelector('#s-token').value.trim(),
      engineDepth: Math.max(8, Math.min(30, Number(root.querySelector('#s-depth').value) || 18)),
      engineLines: Math.max(1, Math.min(5, Number(root.querySelector('#s-lines').value) || 3)),
    })
    root.querySelector('#s-msg').textContent = 'Guardado.'
  })
}

// Acepta el enlace completo de la hoja o solo su ID.
function sheetIdFrom(text) {
  const t = text.trim()
  const m = /\/spreadsheets\/d\/([\w-]+)/.exec(t)
  return m ? m[1] : t
}
