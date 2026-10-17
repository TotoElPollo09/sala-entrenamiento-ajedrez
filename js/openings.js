// Página Aperturas: árbol de jugadas de tus partidas, de un rival, de la base local o del explorador de Lichess.
/* global d3 */
import { StudyBoard, uciToSan, numberLine, Chess } from './board.js'
import { sharedEngine, formatScore } from './engine.js'
import { settings, on, emit } from './store.js'
import { fetchExplorer } from './lichess.js'
import { getGames } from './lichess-data.js'
import { gamesOfPlayer } from './db.js'
import { buildTree, movesAt, colorOf, scoreFor } from './explorer.js'
import { state } from './state.js'

const pct = d3.format('.0%')
const REP_KEY = 'ajedrez-web:repertorio'

const HTML = `
<div class="page-head"><div><h1>Aperturas</h1>
<p class="lead">Explora qué jugadas se juegan en cada posición y cómo te va con ellas. Guarda tus líneas en el repertorio.</p></div></div>
<div class="study">
  <div class="board-col">
    <div class="board-wrap"><div class="board" id="o-board"></div></div>
    <div class="nav">
      <button class="btn icon" data-nav="first" type="button" aria-label="Inicio">⏮</button>
      <button class="btn icon" data-nav="prev" type="button" aria-label="Anterior">◀</button>
      <button class="btn icon" data-nav="next" type="button" aria-label="Siguiente">▶</button>
      <button class="btn icon" data-nav="last" type="button" aria-label="Final">⏭</button>
      <button class="btn" data-nav="flip" type="button">Girar</button>
      <button class="btn" data-nav="reset" type="button">Inicio</button>
      <button class="btn" id="o-to-analysis" type="button">Abrir en Análisis</button>
    </div>
    <p class="line" id="o-line"></p>
  </div>
  <div class="side-col">
    <section class="card">
      <div class="row gap flexwrap">
        <label class="field grow"><span>Partidas de</span><select id="o-source"></select></label>
        <label class="field" id="o-color-field"><span>Color</span><select id="o-color">
          <option value="">Ambos</option><option value="w">Con blancas</option><option value="b">Con negras</option></select></label>
      </div>
      <div class="row gap" id="o-local-row" hidden>
        <label class="field grow"><span>Jugador en la base local</span><input id="o-local-name" placeholder="Apellido, Nombre"></label>
        <button class="btn" id="o-local-go" type="button">Buscar</button>
      </div>
      <p class="note" id="o-status"></p>
      <h3 id="o-opening">—</h3>
      <div class="tablebox"><table class="table clickable" id="o-moves"><thead><tr>
        <th>Jugada</th><th class="n">Partidas</th><th class="hide-narrow">Blancas / tablas / negras</th><th class="n" id="o-score-h">Puntos</th>
      </tr></thead><tbody></tbody></table></div>
      <p class="note" id="o-engine">Stockfish: —</p>
    </section>
    <section class="card">
      <h3>Partidas en esta posición</h3>
      <ul class="games" id="o-games"></ul>
    </section>
    <section class="card">
      <h3>Mi repertorio</h3>
      <div class="row gap"><input id="o-rep-name" class="grow" placeholder="Nombre de la línea, p. ej. Pirc con …g6"><button class="btn primary" id="o-rep-save" type="button">Guardar línea</button></div>
      <ul class="rep" id="o-rep"></ul>
    </section>
  </div>
</div>`

let root, board, engine
let tree = null
let srcPlayer = '' // nombre del jugador cuyas partidas forman el árbol (para puntuar desde su lado)
const cache = new Map()

export function init(el) {
  root = el
  root.innerHTML = HTML
  board = new StudyBoard(root.querySelector('#o-board'), { onChange: changed })
  engine = sharedEngine()
  fillSources()
  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.nav
    if (a === 'reset') board.reset(); else board[a]()
  }))
  root.querySelector('#o-source').addEventListener('change', () => loadSource())
  root.querySelector('#o-color').addEventListener('change', () => { rebuild(); if (board.orientation !== (root.querySelector('#o-color').value || 'w')) board.setOrientation(root.querySelector('#o-color').value || 'w'); changed() })
  root.querySelector('#o-local-go').addEventListener('click', () => loadSource())
  root.querySelector('#o-moves').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-san]'); if (tr) board.play(tr.dataset.san) })
  root.querySelector('#o-games').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]')
    if (!li) return
    const g = currentGames[Number(li.dataset.i)]
    emit('open-game', g); emit('go', 'analysis')
  })
  root.querySelector('#o-to-analysis').addEventListener('click', () => {
    emit('open-game', { white: '?', black: '?', result: '*', moves: board.moves.map((m) => m.san) })
    emit('go', 'analysis')
  })
  root.querySelector('#o-rep-save').addEventListener('click', saveLine)
  root.querySelector('#o-rep').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]')
    const open = e.target.closest('[data-open]')
    const reps = loadRep()
    if (del) { reps.splice(Number(del.dataset.del), 1); storeRep(reps); renderRep() }
    else if (open) { const r = reps[Number(open.dataset.open)]; board.setOrientation(r.color); board.loadMoves(r.moves, undefined, { goto: 'end' }) }
  })
  on('study-opening', async ({ player, color, opening }) => {
    emit('go', 'openings')
    const idx = settings.players.findIndex((p) => p.name === player)
    root.querySelector('#o-source').value = `me:${idx}`
    root.querySelector('#o-color').value = color
    board.setOrientation(color)
    await loadSource()
    if (tree && opening) followOpening(opening)
  })
  on('study-rival', async ({ username, color }) => {
    emit('go', 'openings')
    fillSources()
    root.querySelector('#o-source').value = 'rival'
    root.querySelector('#o-color').value = color
    board.setOrientation(color === 'w' ? 'b' : 'w') // estudias desde tu lado, contra su color
    await loadSource()
  })
  renderRep()
}

export function getBoard() { return board }
export function shown() { fillSources(); changed() }

function fillSources() {
  const sel = root.querySelector('#o-source')
  const cur = sel.value
  const opts = settings.players.map((p, i) => [`me:${i}`, `Mis partidas: ${p.name}${p.lichess ? ` (${p.lichess})` : ' (falta usuario de Lichess)'}`])
  if (state.rival) opts.push(['rival', `Rival: ${state.rival.name} (${state.rival.games.length} partidas)`])
  opts.push(['local', 'Base local de partidas (PGN)'], ['masters', 'Maestros (explorador de Lichess)'], ['lichess', 'Lichess 2000+ (explorador)'])
  sel.replaceChildren(...opts.map(([v, t]) => new Option(t, v)))
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur
}

let currentGames = []
let sourceGames = []

async function loadSource() {
  const v = root.querySelector('#o-source').value
  const status = root.querySelector('#o-status')
  root.querySelector('#o-local-row').hidden = v !== 'local'
  root.querySelector('#o-color-field').hidden = v === 'masters' || v === 'lichess'
  tree = null; sourceGames = []; srcPlayer = ''
  try {
    if (v.startsWith('me:')) {
      const p = settings.players[Number(v.slice(3))]
      if (!p?.lichess) { status.textContent = `Escribe el usuario de Lichess de ${p?.name} en Ajustes para cargar sus partidas.`; changed(); return }
      srcPlayer = p.lichess
      if (!cache.has(p.lichess)) {
        status.textContent = `Descargando partidas de ${p.lichess} desde Lichess…`
        cache.set(p.lichess, await getGames(p.lichess, (n) => { status.textContent = `Descargando partidas nuevas de ${p.lichess}: ${n}…` }))
      }
      sourceGames = cache.get(p.lichess)
    } else if (v === 'rival') {
      srcPlayer = state.rival.name
      sourceGames = state.rival.games
    } else if (v === 'local') {
      const name = root.querySelector('#o-local-name').value.trim()
      if (!name) { status.textContent = 'Escribe el nombre de un jugador de tu base local.'; changed(); return }
      status.textContent = 'Buscando en la base local…'
      sourceGames = await gamesOfPlayer(name)
      // Usa el nombre exacto más frecuente que coincide con la búsqueda.
      const counts = new Map()
      for (const g of sourceGames) for (const n of [g.white, g.black]) if (n.toLowerCase().includes(name.toLowerCase())) counts.set(n, (counts.get(n) || 0) + 1)
      srcPlayer = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || name
    }
    rebuild()
    if (v === 'masters' || v === 'lichess') status.textContent = 'Datos del explorador de aperturas de Lichess.'
    else status.textContent = `${sourceGames.length} partidas de ${srcPlayer}.`
  } catch (e) {
    status.textContent = e.message
  }
  changed()
}

function rebuild() {
  const v = root.querySelector('#o-source').value
  if (v === 'masters' || v === 'lichess') { tree = null; return }
  const color = root.querySelector('#o-color').value || null
  tree = buildTree(sourceGames, { maxPly: 30, onlyColor: color, player: srcPlayer })
}

// Sigue la jugada más frecuente mientras la mayoría de partidas de esa familia la juegan.
function followOpening(family) {
  const fam = family.toLowerCase()
  const games = sourceGames.filter((g) => (g.opening || '').toLowerCase().startsWith(fam) && (!root.querySelector('#o-color').value || colorOf(g, srcPlayer) === root.querySelector('#o-color').value))
  if (!games.length) return
  const t = buildTree(games, { maxPly: 20 })
  board.reset()
  for (let i = 0; i < 20; i++) {
    const at = movesAt(t, board.fen)
    const top = at.moves[0]
    if (!top || top.n < Math.max(2, at.n * 0.5)) break
    board.play(top.san)
  }
}

let pending = 0
async function changed() {
  if (!root || root.closest('[hidden]')) return
  root.querySelector('#o-line').textContent = board.moves.length ? numberLine(board.positions[0], board.sanLine()) : ''
  const v = root.querySelector('#o-source').value
  const tb = root.querySelector('#o-moves tbody')
  const gl = root.querySelector('#o-games')
  const id = ++pending
  let at
  if (v === 'masters' || v === 'lichess') {
    try {
      const r = await fetchExplorer(board.fen, v)
      if (id !== pending) return
      at = { n: r.moves.reduce((a, m) => a + m.n, 0), moves: r.moves, opening: r.opening ? `${r.opening.eco} ${r.opening.name}` : '', games: [] }
    } catch (e) {
      if (id !== pending) return
      root.querySelector('#o-status').textContent = e.message
      at = { n: 0, moves: [], opening: '', games: [] }
    }
  } else {
    at = tree ? movesAt(tree, board.fen) : { n: 0, moves: [], opening: '', games: [] }
  }
  root.querySelector('#o-opening').textContent = at.opening ? `Lo más jugado desde aquí: ${at.opening}` : (board.ply ? 'Posición sin nombre en estas partidas' : 'Posición inicial')
  const side = board.turn
  root.querySelector('#o-score-h').textContent = srcPlayer ? `Puntos de ${srcPlayer}` : 'Puntos del que mueve'
  tb.replaceChildren()
  for (const m of at.moves.slice(0, 14)) {
    const tr = document.createElement('tr'); tr.dataset.san = m.san
    const td1 = document.createElement('td'); td1.textContent = m.san; td1.className = 'san'
    const td2 = document.createElement('td'); td2.className = 'n'; td2.textContent = `${d3.format(',')(m.n)} · ${pct(at.n ? m.n / at.n : 0)}`
    const td3 = document.createElement('td'); td3.className = 'hide-narrow'
    const bar = document.createElement('div'); bar.className = 'wdl'
    ;[[m.w, 'wh'], [m.d, 'd'], [m.l, 'bl']].forEach(([n, c]) => { const s = document.createElement('div'); s.className = c; s.style.flex = n; bar.appendChild(s) })
    td3.appendChild(bar)
    const td4 = document.createElement('td'); td4.className = 'n'
    let score
    if (srcPlayer && tree) score = m.pn ? m.pts / m.pn : null // puntos del jugador elegido
    else score = side === 'w' ? (m.w + m.d / 2) / m.n : (m.l + m.d / 2) / m.n
    td4.textContent = score == null ? '—' : pct(score)
    tr.append(td1, td2, td3, td4); tb.appendChild(tr)
  }
  if (!at.moves.length) {
    const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 4; td.className = 'muted'
    td.textContent = tree || v === 'masters' || v === 'lichess' ? 'Nadie llegó a esta posición en estas partidas.' : 'Elige de dónde salen las partidas.'
    tr.appendChild(td); tb.appendChild(tr)
  }

  currentGames = at.games.slice(0, 12)
  gl.replaceChildren(...currentGames.map((g, i) => {
    const li = document.createElement('li'); li.dataset.i = i
    const s = srcPlayer ? scoreFor(g, srcPlayer) : null
    li.textContent = `${g.white} – ${g.black} · ${g.result} · ${g.opening || g.eco || ''} · ${g.date || ''}`
    if (s != null) li.className = s === 1 ? 'win' : s === 0 ? 'loss' : 'draw'
    return li
  }))
  if (!currentGames.length) gl.innerHTML = '<li class="muted">Sin partidas en esta posición.</li>'

  // Evaluación rápida
  const fen = board.fen
  const chess = new Chess(fen)
  const eng = root.querySelector('#o-engine')
  if (chess.isGameOver()) { eng.textContent = 'Stockfish: partida terminada.'; return }
  eng.textContent = 'Stockfish: pensando…'
  engine.analyze(fen, {
    depth: 16, multipv: 1,
    onInfo: ({ depth, lines }) => {
      if (id !== pending || !lines[0]) return
      eng.textContent = `Stockfish (prof. ${depth}): ${formatScore(lines[0].score, fen)} · ${numberLine(fen, uciToSan(fen, lines[0].pv, 6))}`
    },
  })
}

function loadRep() { try { return JSON.parse(localStorage.getItem(REP_KEY) || '[]') } catch { return [] } }
function storeRep(r) { try { localStorage.setItem(REP_KEY, JSON.stringify(r)) } catch { /* sin almacenamiento */ } }
function saveLine() {
  const name = root.querySelector('#o-rep-name').value.trim() || numberLine(board.positions[0], board.sanLine()).slice(0, 60)
  if (!board.ply) return
  const reps = loadRep()
  reps.push({ name, color: board.orientation, moves: board.sanLine() })
  storeRep(reps); renderRep()
  root.querySelector('#o-rep-name').value = ''
}
function renderRep() {
  const ul = root.querySelector('#o-rep')
  const reps = loadRep()
  ul.replaceChildren(...reps.map((r, i) => {
    const li = document.createElement('li')
    const a = document.createElement('button'); a.type = 'button'; a.className = 'link'; a.dataset.open = i
    a.textContent = `${r.color === 'w' ? '♔' : '♚'} ${r.name}`
    const d = document.createElement('button'); d.type = 'button'; d.className = 'btn small'; d.dataset.del = i; d.textContent = 'Borrar'
    li.append(a, d); return li
  }))
  if (!reps.length) ul.innerHTML = '<li class="muted">Aún no has guardado líneas.</li>'
}
