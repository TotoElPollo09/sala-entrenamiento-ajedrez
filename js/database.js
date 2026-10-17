// Página Base de datos: importar PGN (FIDE, TWIC, torneos) y buscar partidas.
import { parsePgnFile, addGames, countGames, clearGames, findGames } from './db.js'
import { emit } from './store.js'

const HTML = `
<div class="page-head"><div><h1>Base de datos</h1>
<p class="lead">Guarda en este navegador partidas oficiales y de torneos en formato PGN para estudiar rivales que no juegan en Lichess.</p></div></div>
<section class="card">
  <h3>Importar PGN</h3>
  <p class="note">Descarga partidas oficiales en PGN, por ejemplo de The Week in Chess (theweekinchess.com/twic) o de la web de tu federación o torneo, y arrástralas aquí. Un archivo puede tener miles de partidas.</p>
  <label class="drop" id="b-drop">
    <input type="file" id="b-file" accept=".pgn,.txt" multiple>
    <span>Arrastra archivos .pgn o pulsa para elegirlos</span>
  </label>
  <p class="note" id="b-status"></p>
  <div class="row gap"><span id="b-count" class="muted"></span><button class="btn small" id="b-clear" type="button">Vaciar la base</button></div>
</section>
<section class="card">
  <h3>Buscar partidas</h3>
  <div class="row gap flexwrap end">
    <label class="field grow"><span>Jugador</span><input id="b-player" placeholder="Apellido o usuario"></label>
    <label class="field grow"><span>Torneo o apertura</span><input id="b-event" placeholder="Olimpiada, Sicilian, B90…"></label>
    <button class="btn primary" id="b-go" type="button">Buscar</button>
  </div>
  <div class="tablebox tall"><table class="table clickable" id="b-res"><thead><tr>
    <th>Fecha</th><th>Blancas</th><th>Negras</th><th>Resultado</th><th class="hide-narrow">Apertura</th><th class="hide-narrow">Torneo</th>
  </tr></thead><tbody></tbody></table></div>
</section>`

let root
let results = []

export function init(el) {
  root = el
  root.innerHTML = HTML
  const input = root.querySelector('#b-file')
  input.addEventListener('change', () => importFiles([...input.files]))
  const drop = root.querySelector('#b-drop')
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); importFiles([...e.dataTransfer.files]) })
  root.querySelector('#b-clear').addEventListener('click', async () => {
    const b = root.querySelector('#b-clear')
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Pulsa otra vez para borrar todo'; return }
    await clearGames(); b.dataset.confirm = ''; b.textContent = 'Vaciar la base'; refreshCount()
  })
  root.querySelector('#b-go').addEventListener('click', search)
  root.querySelectorAll('#b-player, #b-event').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') search() }))
  root.querySelector('#b-res').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]')
    if (tr) { emit('open-game', results[Number(tr.dataset.i)]); emit('go', 'analysis') }
  })
  refreshCount()
}

async function refreshCount() {
  const n = await countGames()
  root.querySelector('#b-count').textContent = `${n.toLocaleString('es')} partidas guardadas en este navegador.`
}

async function importFiles(files) {
  const st = root.querySelector('#b-status')
  let total = 0
  for (const f of files) {
    st.textContent = `Leyendo ${f.name}…`
    const games = parsePgnFile(await f.text(), f.name)
    for (let i = 0; i < games.length; i += 2000) {
      await addGames(games.slice(i, i + 2000))
      st.textContent = `${f.name}: ${Math.min(i + 2000, games.length)} de ${games.length} partidas guardadas…`
    }
    total += games.length
  }
  st.textContent = `Importadas ${total.toLocaleString('es')} partidas.`
  refreshCount()
}

async function search() {
  const p = root.querySelector('#b-player').value.trim().toLowerCase()
  const ev = root.querySelector('#b-event').value.trim().toLowerCase()
  results = await findGames((g) => (!p || g.whiteLower.includes(p) || g.blackLower.includes(p))
    && (!ev || `${g.event} ${g.opening} ${g.eco}`.toLowerCase().includes(ev)), 500)
  results.sort((a, b) => (a.date < b.date ? 1 : -1))
  const tb = root.querySelector('#b-res tbody')
  tb.replaceChildren(...results.map((g, i) => {
    const tr = document.createElement('tr'); tr.dataset.i = i
    ;[[g.date, ''], [`${g.white}${g.whiteElo ? ` (${g.whiteElo})` : ''}`, ''], [`${g.black}${g.blackElo ? ` (${g.blackElo})` : ''}`, ''], [g.result, ''],
      [[g.eco, g.opening].filter(Boolean).join(' '), 'hide-narrow'], [g.event, 'hide-narrow']].forEach(([t, cls]) => {
      const td = document.createElement('td'); td.textContent = t; td.className = cls; tr.appendChild(td)
    })
    return tr
  }))
  if (!results.length) tb.innerHTML = '<tr><td colspan="6" class="muted">Sin resultados.</td></tr>'
}
