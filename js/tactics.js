// Página Táctica: problemas sacados de tus errores graves en Lichess y de libros (PGN/EPD), con repaso espaciado.
import { StudyBoard, Chess, DEFAULT_POSITION, uciToSan, numberLine, ARROW_TYPE } from './board.js'
import { MARKER_TYPE } from '../vendor/cm-chessboard/src/extensions/markers/Markers.js'
import { Engine, sharedEngine, whitePov } from './engine.js'
import { fetchUserGames } from './lichess.js'
import { settings, emit } from './store.js'
import { allPuzzles, addPuzzles, savePuzzle, deleteSet, scannedIds, markScanned, graded } from './tactics-db.js'
import { puzzlesFromLichessAnalysis, puzzlesWithEngine, parseBookFile, winChance } from './tactics-import.js'

const PREFS_KEY = 'ajedrez-web:tactica'
const SPEED = { bullet: 'bullet', blitz: 'blitz', rapid: 'rápida', classical: 'clásica', correspondence: 'por correspondencia', ultraBullet: 'ultrabullet' }

const HTML = `
<div class="page-head"><div><h1>Táctica</h1>
<p class="lead">Resuelve las posiciones donde cometiste errores graves y problemas de tus libros. Lo que falles vuelve a salir hasta que lo domines.</p></div></div>
<div class="tiles" id="t-tiles"></div>
<div class="study">
  <div class="board-col">
    <div class="board-wrap"><div class="board" id="t-board"></div></div>
  </div>
  <div class="side-col">
    <section class="card">
      <div class="row gap flexwrap end">
        <label class="field grow"><span>Problemas de</span><select id="t-src"></select></label>
        <label class="field"><span>Orden</span><select id="t-order">
          <option value="due">Repaso pendiente</option><option value="random">Al azar</option><option value="order">En orden</option></select></label>
      </div>
    </section>
    <section class="card tz-card">
      <p class="tz-turn" id="t-turn"></p>
      <p class="note" id="t-context"></p>
      <p class="tz-fb" id="t-fb" role="status"></p>
      <p class="line" id="t-line" hidden></p>
      <div class="row gap flexwrap">
        <button class="btn" id="t-hint" type="button">Pista</button>
        <button class="btn" id="t-show" type="button">Ver solución</button>
        <button class="btn primary" id="t-next" type="button">Siguiente</button>
      </div>
      <div class="row gap flexwrap">
        <button class="link" id="t-analysis" type="button">Abrir en Análisis</button>
        <a id="t-lichess" target="_blank" rel="noopener" hidden>Ver la partida en Lichess</a>
      </div>
    </section>
  </div>
</div>
<div class="grid2">
  <section class="card">
    <h3>Mis errores graves</h3>
    <p class="note">Descarga tus partidas de Lichess y convierte cada error grave tuyo en un problema: la posición antes del error, y tienes que encontrar la jugada buena. Si la partida ya tiene análisis de Lichess se usa ese; si no, la analiza Stockfish aquí mismo (tarda unos segundos por partida). Las partidas ya revisadas no se repiten.</p>
    <div class="row gap flexwrap end">
      <label class="field grow"><span>Jugador</span><select id="m-user"></select></label>
      <label class="field"><span>Partidas</span><select id="m-max"><option>20</option><option selected>50</option><option>100</option><option>300</option></select></label>
      <label class="field"><span>Ritmo</span><select id="m-speed"><option value="">Todos</option><option value="bullet">Bullet</option><option value="blitz">Blitz</option><option value="rapid">Rápidas</option><option value="classical">Clásicas</option></select></label>
    </div>
    <label class="switch"><input type="checkbox" id="m-engine" checked> Analizar con Stockfish las partidas sin análisis de Lichess</label>
    <label class="switch"><input type="checkbox" id="m-mistakes"> Incluir también los errores (?), no solo los graves (??)</label>
    <div class="row gap flexwrap">
      <button class="btn primary" id="m-go" type="button">Buscar mis errores</button>
      <button class="btn" id="m-stop" type="button" hidden>Detener</button>
      <button class="btn small" id="m-clear" type="button">Borrar mis errores</button>
    </div>
    <p class="note" id="m-status"></p>
    <div class="progress" id="m-prog" hidden><div></div></div>
  </section>
  <section class="card">
    <h3>Problemas de libros</h3>
    <p class="note">Importa los ejercicios de un libro en PGN (cada problema con su etiqueta [FEN] y la solución como jugadas) o en EPD (una posición por línea, con <code>bm</code> para la jugada buena). Si un problema no trae solución, Stockfish la calcula al mostrarlo.</p>
    <label class="field"><span>Nombre del libro</span><input id="k-name" placeholder="p. ej. Polgar, 5334 problemas"></label>
    <label class="drop" id="k-drop">
      <input type="file" id="k-file" accept=".pgn,.epd,.fen,.txt">
      <span>Arrastra un archivo .pgn, .epd o .fen o pulsa para elegirlo</span>
    </label>
    <details><summary class="note">O pega el texto aquí</summary>
      <label class="field"><span>PGN, EPD o FEN</span><textarea id="k-text" rows="5" placeholder='[FEN "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"]&#10;&#10;1. Qxf7# *'></textarea></label>
      <button class="btn" id="k-paste" type="button">Importar texto</button>
    </details>
    <p class="note" id="k-status"></p>
    <div class="tablebox"><table class="table" id="k-sets"><thead><tr><th>Libro</th><th class="n">Problemas</th><th class="n">Hechos</th><th class="n">Acierto</th><th></th></tr></thead><tbody></tbody></table></div>
  </section>
</div>`

let root, board
let puzzles = []
let prefs = { src: 'all', order: 'due' }
let cur = null // { p, base, step, failed, phase: 'solve' | 'check' | 'done', graded }
let quiet = false // cambios del tablero hechos por la página, no por el jugador
let scan = null // { ctrl, engine }

export function init(el) {
  root = el
  root.innerHTML = HTML
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) } catch { /* sin almacenamiento */ }
  board = new StudyBoard(root.querySelector('#t-board'), { onChange: moved })
  root.querySelector('#t-order').value = prefs.order
  root.querySelector('#t-src').addEventListener('change', (e) => { prefs.src = e.target.value; savePrefs(); next() })
  root.querySelector('#t-order').addEventListener('change', (e) => { prefs.order = e.target.value; savePrefs(); next() })
  root.querySelector('#t-next').addEventListener('click', next)
  root.querySelector('#t-hint').addEventListener('click', hint)
  root.querySelector('#t-show').addEventListener('click', showSolution)
  root.querySelector('#t-analysis').addEventListener('click', openInAnalysis)
  root.querySelector('#m-go').addEventListener('click', findMistakes)
  root.querySelector('#m-stop').addEventListener('click', () => scan?.ctrl.abort())
  root.querySelector('#m-clear').addEventListener('click', async () => {
    if (!confirm('¿Borrar todos los problemas sacados de tus partidas? Podrás volver a buscarlos.')) return
    await deleteSet('mine')
    await reload(); next()
  })
  const file = root.querySelector('#k-file')
  file.addEventListener('change', () => { if (file.files[0]) importFile(file.files[0]); file.value = '' })
  const drop = root.querySelector('#k-drop')
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]) })
  root.querySelector('#k-paste').addEventListener('click', () => importText(root.querySelector('#k-text').value, root.querySelector('#k-name').value.trim() || 'Mis problemas'))
  root.querySelector('#k-sets').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]')
    if (!b) return
    const set = b.closest('tr').dataset.set
    if (b.dataset.act === 'train') { prefs.src = `book:${set}`; savePrefs(); renderSources(); next(); root.querySelector('.study').scrollIntoView({ behavior: 'smooth' }) }
    if (b.dataset.act === 'del' && confirm(`¿Borrar los problemas de "${set}"?`)) { await deleteSet('book', set); if (prefs.src === `book:${set}`) prefs.src = 'all'; await reload(); next() }
  })
  shown()
  reload().then(next)
}

export function shown() {
  // Los jugadores pueden haber cambiado en Ajustes.
  const sel = root.querySelector('#m-user')
  const keep = sel.value
  sel.replaceChildren(...settings.players.filter((p) => p.lichess).map((p) => new Option(`${p.name} (${p.lichess})`, p.lichess)))
  if (keep) sel.value = keep
}

function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* sin almacenamiento */ } }

async function reload() {
  puzzles = await allPuzzles()
  renderSources()
  renderTiles()
  renderSets()
}

// ---- Selección de problemas ----

function inSource(p) {
  if (prefs.src === 'all') return true
  if (prefs.src === 'mine') return p.kind === 'mine'
  if (prefs.src === 'book') return p.kind === 'book'
  return p.kind === 'book' && `book:${p.set}` === prefs.src
}

function pick() {
  const list = puzzles.filter(inSource).filter((p) => p.id !== cur?.p.id || puzzles.length === 1)
  if (!list.length) return null
  if (prefs.order === 'random') return list[Math.floor(Math.random() * list.length)]
  if (prefs.order === 'order') {
    const sorted = list.sort((a, b) => (a.kind === 'mine' ? (b.game?.ts || 0) - (a.game?.ts || 0) : (a.n || 0) - (b.n || 0)))
    const tried = sorted.findIndex((p) => !p.tries)
    return sorted[tried >= 0 ? tried : 0]
  }
  const now = Date.now()
  const due = list.filter((p) => (p.due || 0) <= now).sort((a, b) => (a.due || 0) - (b.due || 0) || (a.added || 0) - (b.added || 0))
  return due[0] || null
}

function next() {
  const p = pick()
  if (!p) return empty()
  load(p)
}

function empty() {
  cur = null
  quiet = true; board.loadMoves([]); quiet = false
  const any = puzzles.some(inSource)
  root.querySelector('#t-turn').textContent = any ? 'No tienes repasos pendientes.' : 'Todavía no hay problemas aquí.'
  root.querySelector('#t-context').textContent = any
    ? 'Has hecho todos los que tocaban hoy. Cambia el orden a "Al azar" para seguir practicando.'
    : 'Busca tus errores en Lichess o importa un libro (abajo).'
  setFeedback('')
  root.querySelector('#t-line').hidden = true
  root.querySelector('#t-lichess').hidden = true
  for (const id of ['#t-hint', '#t-show', '#t-analysis']) root.querySelector(id).disabled = true
}

// Posición anterior al problema (la jugada del rival), para ver qué acaba de pasar.
function previous(p) {
  if (p.kind !== 'mine' || !p.ply) return null
  const chess = new Chess()
  try { for (const san of p.game.moves.slice(0, p.ply - 1)) chess.move(san) } catch { return null }
  const fen = chess.fen()
  try { chess.move(p.game.moves[p.ply - 1]) } catch { return null }
  return chess.fen() === p.fen ? { fen, san: p.game.moves[p.ply - 1] } : null
}

async function load(p) {
  const prev = previous(p)
  cur = { p, base: prev ? 1 : 0, step: 0, failed: false, phase: 'solve', graded: false }
  quiet = true
  if (prev) board.loadMoves([prev.san], prev.fen, { goto: 'end' })
  else board.loadMoves([], p.fen)
  board.setOrientation(p.fen.split(' ')[1])
  board.setArrows([])
  board.board.removeMarkers(MARKER_TYPE.circlePrimary)
  quiet = false
  for (const id of ['#t-hint', '#t-show', '#t-analysis']) root.querySelector(id).disabled = false
  root.querySelector('#t-line').hidden = true
  const side = p.fen.split(' ')[1] === 'w' ? 'blancas' : 'negras'
  root.querySelector('#t-turn').textContent = `Juegan ${side}: encuentra la mejor jugada.`
  root.querySelector('#t-context').textContent = context(p)
  const a = root.querySelector('#t-lichess')
  a.hidden = !p.game?.url
  if (p.game?.url) a.href = `${p.game.url}#${p.ply}`
  setFeedback(p.tries ? `Ya lo intentaste ${p.tries} ${p.tries === 1 ? 'vez' : 'veces'}${p.last === 'fail' ? '; la última fallaste.' : '.'}` : '')
  if (!p.solution?.length) {
    cur.phase = 'check'
    setFeedback('Stockfish está buscando la solución…')
    const r = await sharedEngine().analyze(p.fen, { depth: 18, multipv: 1 })
    if (cur?.p !== p) return
    if (!r.lines[0]?.pv?.length) { setFeedback('Stockfish no encontró jugadas en esta posición.', 'bad'); cur.phase = 'done'; return }
    p.solution = [r.lines[0].pv[0]]
    p.line = uciToSan(p.fen, r.lines[0].pv, 10)
    p.bestEval = whitePov(r.lines[0].score, p.fen)
    await savePuzzle(p)
    cur.phase = 'solve'
    setFeedback('')
  }
}

function context(p) {
  if (p.kind === 'book') return [p.set, p.name || `Problema ${p.n}`, p.comment].filter(Boolean).join(' · ')
  const g = p.game
  const me = p.fen.split(' ')[1] === 'w'
  const opp = me ? g.black : g.white
  const elo = me ? g.blackElo : g.whiteElo
  const n = Math.floor(p.ply / 2) + 1
  return `Tu partida contra ${opp}${elo ? ` (${elo})` : ''}, ${g.date}${g.speed ? `, ${SPEED[g.speed] || g.speed}` : ''}. Aquí jugaste ${n}${me ? '.' : '…'} ${p.played}${p.cls === 'blunder' ? '??' : '?'}`
}

function setFeedback(text, cls = '') {
  const fb = root.querySelector('#t-fb')
  fb.textContent = text
  fb.className = `tz-fb ${cls}`
}

// ---- Resolver ----

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
function uciAt(fen, san) { const m = new Chess(fen).move(san); return m.from + m.to + (m.promotion || '') }

async function moved() {
  if (quiet || !cur || cur.phase !== 'solve') return
  const at = cur.base + cur.step
  if (board.ply !== at + 1 || board.moves.length !== at + 1) return
  const { p } = cur
  const fen = board.positions[at]
  const san = board.moves[at].san
  const uci = uciAt(fen, san)
  const want = p.solution[cur.step]
  const mate = new Chess(board.positions[at + 1]).isCheckmate()
  if (uci === want || mate || (cur.step === 0 && p.alts?.includes(uci))) return good(mate)
  // Otra jugada puede valer igual: lo decide Stockfish (en tus errores y en problemas de una jugada).
  if (cur.step === 0 && (p.kind === 'mine' || p.solution.length === 1)) {
    cur.phase = 'check'
    setFeedback('Comprobando tu jugada con Stockfish…')
    const ok = await alsoGood(p, board.positions[at + 1])
    if (cur?.p !== p) return
    cur.phase = 'solve'
    if (ok) return good(true, `¡Bien! ${san} también gana. La de Stockfish era ${uciToSan(p.fen, [want], 1)[0]}.`)
  }
  bad(at, san)
}

async function alsoGood(p, after) {
  const engine = sharedEngine()
  const side = p.fen.split(' ')[1] === 'w' ? 1 : -1
  if (p.bestEval == null) {
    const r = await engine.analyze(p.fen, { depth: 14, multipv: 1 })
    p.bestEval = r.lines[0] ? whitePov(r.lines[0].score, p.fen) : 0
  }
  const chess = new Chess(after)
  let ev
  if (chess.isCheckmate()) ev = side * 100
  else if (chess.isGameOver()) ev = 0
  else {
    const r = await engine.analyze(after, { depth: 14, multipv: 1 })
    if (!r.lines[0]) return false
    ev = whitePov(r.lines[0].score, after)
  }
  return side * (winChance(p.bestEval) - winChance(ev)) <= 0.05
}

function good(finished, msg) {
  const { p } = cur
  cur.step += 1
  if (finished || cur.step >= p.solution.length) return solved(msg)
  setFeedback('¡Bien! Sigue…', 'good')
  // Respuesta del rival según la solución.
  setTimeout(() => {
    if (cur?.p !== p) return
    quiet = true; board.play(toMove(p.solution[cur.step])); quiet = false
    cur.step += 1
    if (cur.step >= p.solution.length) solved()
  }, 400)
}

function bad(at, san) {
  cur.failed = true
  grade(false)
  setFeedback(`${san} no es la buena. Inténtalo otra vez.`, 'bad')
  const { p } = cur
  setTimeout(() => {
    if (cur?.p !== p || cur.phase !== 'solve') return
    quiet = true
    board.loadMoves(board.moves.slice(0, at).map((m) => m.san), board.startFen, { goto: 'end' })
    quiet = false
  }, 700)
}

function solved(msg) {
  cur.phase = 'done'
  grade(true)
  setFeedback(msg || (cur.failed ? '¡Resuelto! Volverá a salir pronto para afianzarlo.' : '¡Correcto!'), 'good')
  showLine()
}

function hint() {
  if (!cur || cur.phase !== 'solve') return
  const uci = cur.p.solution[cur.step]
  if (!uci) return
  cur.failed = true
  grade(false)
  board.board.removeMarkers(MARKER_TYPE.circlePrimary)
  board.board.addMarker(MARKER_TYPE.circlePrimary, uci.slice(0, 2))
  setFeedback('Pista: mueve la pieza marcada.')
}

function showSolution() {
  if (!cur || cur.phase === 'done' || !cur.p.solution?.length) return
  const { p } = cur
  cur.failed = true
  grade(false)
  cur.phase = 'done'
  quiet = true
  board.loadMoves(board.moves.slice(0, cur.base + cur.step).map((m) => m.san), board.startFen, { goto: 'end' })
  const first = p.solution[cur.step]
  for (const u of p.solution.slice(cur.step)) board.play(toMove(u))
  board.goto(cur.base + cur.step + 1)
  board.setArrows([{ from: first.slice(0, 2), to: first.slice(2, 4), type: ARROW_TYPE.info }])
  quiet = false
  setFeedback(`La solución era ${uciToSan(board.positions[cur.base + cur.step], [first], 1)[0]}. Lo repasarás pronto.`, 'bad')
  showLine()
}

function showLine() {
  const { p } = cur
  const el = root.querySelector('#t-line')
  const sans = p.kind === 'mine' && p.line?.length ? p.line : uciToSan(p.fen, p.solution, 30)
  el.textContent = `${p.kind === 'mine' ? 'Línea de Stockfish' : 'Solución'}: ${numberLine(p.fen, sans)}`
  if (p.kind === 'mine' && p.bestEval != null) el.textContent += ` (${pawns(p.bestEval)})`
  el.hidden = false
}

const pawns = (v) => (v >= 99 ? '#' : v <= -99 ? '#-' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2))

// Una sola nota por intento: la primera (acierto limpio o fallo).
async function grade(ok) {
  if (cur.graded) return
  cur.graded = true
  const g = graded(cur.p, ok)
  Object.assign(cur.p, g)
  await savePuzzle(cur.p)
  renderTiles()
  renderSets()
}

function openInAnalysis() {
  if (!cur) return
  const { p } = cur
  const g = p.kind === 'mine'
    ? { ...p.game, moves: p.game.moves, fen: '', view: { ply: p.ply, orientation: p.fen.split(' ')[1] } }
    : { white: p.name || `Problema ${p.n}`, black: p.set, result: '*', event: p.set, moves: uciToSan(p.fen, p.solution || [], 60), fen: p.fen === DEFAULT_POSITION ? '' : p.fen, view: { orientation: p.fen.split(' ')[1] } }
  emit('open-game', g)
  emit('go', 'analysis')
}

// ---- Buscar errores en Lichess ----

async function findMistakes() {
  const user = root.querySelector('#m-user').value
  const status = root.querySelector('#m-status')
  if (!user) { status.textContent = 'Pon tu usuario de Lichess en Ajustes.'; return }
  const useEngine = root.querySelector('#m-engine').checked
  const mistakes = root.querySelector('#m-mistakes').checked
  const prog = root.querySelector('#m-prog')
  const ctrl = new AbortController()
  scan = { ctrl, engine: null }
  root.querySelector('#m-go').disabled = true
  root.querySelector('#m-stop').hidden = false
  let added = 0, done = 0, withLichess = 0
  try {
    status.textContent = 'Descargando tus partidas de Lichess…'
    const games = await fetchUserGames(user, {
      max: Number(root.querySelector('#m-max').value), perfType: root.querySelector('#m-speed').value, evals: true, signal: ctrl.signal,
      onProgress: (n) => { status.textContent = `Descargando tus partidas de Lichess… ${n}` },
    })
    const seen = await scannedIds()
    const u = user.toLowerCase()
    const todo = games.filter((g) => !seen.has(g.id) && g.result !== '*' && g.moves.length >= 10 && (g.white.toLowerCase() === u || g.black.toLowerCase() === u))
    const skippedNoEngine = useEngine ? 0 : todo.filter((g) => !g.analysis).length
    const list = useEngine ? todo : todo.filter((g) => g.analysis)
    if (!list.length) {
      status.textContent = games.length ? `No hay partidas nuevas que revisar (${games.length - todo.length} ya estaban revisadas${skippedNoEngine ? `, ${skippedNoEngine} sin análisis de Lichess` : ''}).` : 'Lichess no devolvió partidas con ese filtro.'
      return
    }
    prog.hidden = false
    for (const g of list) {
      if (ctrl.signal.aborted) break
      status.textContent = `Revisando partida ${done + 1} de ${list.length} (${g.white} – ${g.black})… ${added} problemas nuevos.`
      prog.firstElementChild.style.width = `${(done / list.length) * 100}%`
      let found
      if (g.analysis) { found = puzzlesFromLichessAnalysis(g, user, { mistakes }); withLichess++ }
      else {
        scan.engine ||= new Engine()
        found = await puzzlesWithEngine(g, user, scan.engine, { mistakes, signal: ctrl.signal })
        if (ctrl.signal.aborted) break
      }
      added += await addPuzzles(found)
      await markScanned([g.id])
      done++
      puzzles = await allPuzzles()
      renderTiles(); renderSources()
    }
    status.textContent = `${ctrl.signal.aborted ? 'Detenido' : 'Listo'}: ${done} partidas revisadas (${withLichess} con análisis de Lichess), ${added} problemas nuevos.` +
      (skippedNoEngine ? ` ${skippedNoEngine} partidas sin análisis se saltaron; activa Stockfish para revisarlas.` : '')
    if (added && (!cur || cur.phase === 'done')) { prefs.src = 'mine'; savePrefs(); renderSources(); next() }
  } catch (e) {
    status.textContent = ctrl.signal.aborted ? `Detenido: ${done} partidas revisadas, ${added} problemas nuevos.` : `No se pudo: ${e.message}`
  } finally {
    scan.engine?.worker.terminate()
    scan = null
    prog.hidden = true
    root.querySelector('#m-go').disabled = false
    root.querySelector('#m-stop').hidden = true
  }
}

// ---- Importar libros ----

async function importFile(f) {
  const name = root.querySelector('#k-name').value.trim() || f.name.replace(/\.[^.]+$/, '')
  importText(await f.text(), name)
}

async function importText(text, set) {
  const st = root.querySelector('#k-status')
  if (!text.trim()) { st.textContent = 'No hay nada que importar.'; return }
  const { puzzles: list, skipped } = parseBookFile(text, set)
  if (!list.length) { st.textContent = 'No encontré problemas. El PGN necesita la etiqueta [FEN] en cada problema; el EPD, una posición por línea.'; return }
  const n = await addPuzzles(list)
  const noSol = list.filter((p) => !p.solution.length).length
  st.textContent = `"${set}": ${n} problemas nuevos${list.length > n ? ` (${list.length - n} ya estaban)` : ''}${skipped ? `, ${skipped} entradas sin posición ignoradas` : ''}${noSol ? `. ${noSol} sin solución: la calculará Stockfish` : ''}.`
  root.querySelector('#k-text').value = ''
  prefs.src = `book:${set}`; savePrefs()
  await reload()
  next()
}

// ---- Resúmenes ----

function renderSources() {
  const sel = root.querySelector('#t-src')
  const sets = [...new Set(puzzles.filter((p) => p.kind === 'book').map((p) => p.set))].sort()
  const mine = puzzles.filter((p) => p.kind === 'mine').length
  const books = puzzles.length - mine
  sel.replaceChildren(
    new Option(`Todos (${puzzles.length})`, 'all'),
    new Option(`Mis errores graves (${mine})`, 'mine'),
    new Option(`Todos los libros (${books})`, 'book'),
    ...sets.map((s) => new Option(`Libro: ${s} (${puzzles.filter((p) => p.kind === 'book' && p.set === s).length})`, `book:${s}`)),
  )
  if (![...sel.options].some((o) => o.value === prefs.src)) prefs.src = 'all'
  sel.value = prefs.src
}

function renderTiles() {
  const now = Date.now()
  const tried = puzzles.filter((p) => p.tries)
  const tries = tried.reduce((s, p) => s + p.tries, 0)
  const fails = tried.reduce((s, p) => s + p.fails, 0)
  const tiles = [
    ['Problemas', puzzles.length, `${puzzles.filter((p) => p.kind === 'mine').length} de tus partidas`],
    ['Para repasar hoy', puzzles.filter((p) => (p.due || 0) <= now).length, 'nuevos o que toca repetir'],
    ['Acierto', tries ? `${Math.round(((tries - fails) / tries) * 100)}%` : '–', `${tries} intentos`],
    ['Dominados', puzzles.filter((p) => (p.box || 0) >= 3).length, 'acertados 3 veces seguidas'],
  ]
  root.querySelector('#t-tiles').replaceChildren(...tiles.map(([l, b, s]) => {
    const d = document.createElement('div'); d.className = 'tile'
    d.innerHTML = '<span class="label"></span><span class="big"></span><span class="sub"></span>'
    d.children[0].textContent = l; d.children[1].textContent = b; d.children[2].textContent = s
    return d
  }))
}

function renderSets() {
  const body = root.querySelector('#k-sets tbody')
  const by = new Map()
  for (const p of puzzles) if (p.kind === 'book') { if (!by.has(p.set)) by.set(p.set, []); by.get(p.set).push(p) }
  body.replaceChildren(...[...by].sort(([a], [b]) => a.localeCompare(b)).map(([set, list]) => {
    const tr = document.createElement('tr'); tr.dataset.set = set
    const tries = list.reduce((s, p) => s + (p.tries || 0), 0)
    const fails = list.reduce((s, p) => s + (p.fails || 0), 0)
    const cells = [set, list.length, list.filter((p) => p.tries).length, tries ? `${Math.round(((tries - fails) / tries) * 100)}%` : '–']
    cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = c; if (i) td.className = 'n'; tr.appendChild(td) })
    const td = document.createElement('td'); td.className = 'n nowrap'
    td.innerHTML = '<button class="btn small" data-act="train" type="button">Entrenar</button> <button class="btn small" data-act="del" type="button">Borrar</button>'
    tr.appendChild(td)
    return tr
  }))
  if (!by.size) {
    const tr = document.createElement('tr'); const td = document.createElement('td')
    td.colSpan = 5; td.className = 'muted'; td.textContent = 'Aún no has importado ningún libro.'
    tr.appendChild(td); body.appendChild(tr)
  }
}
