// Página Análisis: tablero libre con Stockfish, carga de PGN y análisis de partida completa.
/* global d3 */
import { StudyBoard, uciToSan, numberLine, ARROW_TYPE, Chess, fenKey } from './board.js'
import { sharedEngine, whitePov, formatScore } from './engine.js'
import { settings, on } from './store.js'
import { lineChart } from './charts.js'
import { gameToPgn } from './db.js'
import { ExplorerPanel } from './explorer-panel.js'

const HTML = `
<div class="page-head"><div><h1>Análisis</h1><p class="lead" id="a-title">Mueve las piezas o pega un PGN. Stockfish analiza cada posición.</p></div></div>
<div class="study">
  <div class="board-col">
    <div class="board-wrap">
      <div class="evalbar" id="a-evalbar" aria-hidden="true"><div class="evalfill" id="a-evalfill"></div><span id="a-evaltext">0.0</span></div>
      <div class="board" id="a-board"></div>
    </div>
    <div class="nav">
      <button class="btn icon" data-nav="first" type="button" aria-label="Inicio">⏮</button>
      <button class="btn icon" data-nav="prev" type="button" aria-label="Anterior">◀</button>
      <button class="btn icon" data-nav="next" type="button" aria-label="Siguiente">▶</button>
      <button class="btn icon" data-nav="last" type="button" aria-label="Final">⏭</button>
      <button class="btn" data-nav="flip" type="button">Girar</button>
      <button class="btn" data-nav="reset" type="button">Nueva</button>
    </div>
  </div>
  <div class="side-col">
    <section class="card">
      <div class="row between"><h3>Stockfish 18</h3>
        <label class="switch"><input type="checkbox" id="a-engine-on" checked> Analizar</label></div>
      <p class="note" id="a-engine-status">Cargando motor…</p>
      <ol class="pv-list" id="a-lines"></ol>
    </section>
    <section class="card" id="a-explorer"></section>
    <section class="card">
      <h3>Jugadas</h3>
      <div class="moves" id="a-moves"></div>
      <div class="row gap flexwrap">
        <button class="btn primary" id="a-full" type="button">Analizar partida completa</button>
        <button class="btn" id="a-copy" type="button">Copiar PGN</button>
      </div>
      <p class="note" id="a-full-status"></p>
      <div class="chart short" id="a-graph"></div>
    </section>
    <section class="card">
      <h3>Cargar partida</h3>
      <label class="field"><span>PGN o FEN</span><textarea id="a-pgn" rows="5" placeholder='[Event "..."] 1. e4 e5 2. Nf3 …'></textarea></label>
      <div class="row gap"><button class="btn" id="a-load" type="button">Cargar</button><span class="note" id="a-load-msg"></span></div>
    </section>
  </div>
</div>`

let root, board, engine, explorer
let annotations = [] // por medio-jugada: {cls, mark}
let gameInfo = null
let evals = [] // evaluación (peones, blancas) por posición, del análisis completo

export function init(el) {
  root = el
  root.innerHTML = HTML
  board = new StudyBoard(root.querySelector('#a-board'), { onChange: changed })
  engine = sharedEngine()
  engine.ready.then(() => { root.querySelector('#a-engine-status').textContent = 'Listo.'; changed() })
  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.nav
    if (a === 'reset') { gameInfo = null; annotations = []; evals = []; root.querySelector('#a-graph').replaceChildren(); setTitle(); board.reset() }
    else board[a]()
  }))
  root.querySelector('#a-engine-on').addEventListener('change', changed)
  root.querySelector('#a-load').addEventListener('click', loadText)
  root.querySelector('#a-copy').addEventListener('click', copyPgn)
  root.querySelector('#a-full').addEventListener('click', analyzeGame)
  root.querySelector('#a-moves').addEventListener('click', (e) => {
    const m = e.target.closest('[data-ply]')
    if (m) board.goto(Number(m.dataset.ply))
  })
  root.querySelector('#a-lines').addEventListener('click', (e) => {
    const li = e.target.closest('[data-move]')
    if (li) board.play(li.dataset.move)
  })
  explorer = new ExplorerPanel(root.querySelector('#a-explorer'), {
    onMove: (san) => board.play(san),
    onGame: openPgn,
  })
  on('open-game', (g) => openGame(g))
}

export function getBoard() { return board }
export function shown() { changed() }

function setTitle() {
  root.querySelector('#a-title').textContent = gameInfo
    ? `${gameInfo.white}${gameInfo.whiteElo ? ` (${gameInfo.whiteElo})` : ''} – ${gameInfo.black}${gameInfo.blackElo ? ` (${gameInfo.blackElo})` : ''} · ${gameInfo.result || ''} · ${[gameInfo.event, gameInfo.date].filter((x) => x && !/^[?.\s]+$/.test(x)).join(', ')}`
    : 'Mueve las piezas o pega un PGN. Stockfish analiza cada posición.'
}

export function openGame(g, { ply = 0, orientation } = {}) {
  gameInfo = g
  annotations = []
  evals = []
  root.querySelector('#a-graph').replaceChildren()
  root.querySelector('#a-full-status').textContent = ''
  const n = board.loadMoves(g.moves, g.fen || undefined)
  if (n < g.moves.length) root.querySelector('#a-load-msg').textContent = `La partida tiene una jugada no válida tras ${n} medias jugadas; se cargó hasta ahí.`
  if (orientation) board.setOrientation(orientation)
  board.goto(ply)
  setTitle()
}

// Partida del explorador: se carga entera y el tablero se queda en la posición que se estaba mirando.
function openPgn(pgn) {
  const here = fenKey(board.fen)
  root.querySelector('#a-pgn').value = pgn
  if (!loadText()) throw new Error('No se pudo leer esa partida.')
  const ply = board.positions.findIndex((f) => fenKey(f) === here)
  board.goto(ply >= 0 ? ply : 0)
  root.querySelector('.board-col').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function loadText() {
  const t = root.querySelector('#a-pgn').value.trim()
  const msg = root.querySelector('#a-load-msg')
  if (!t) return
  try {
    if (/^[rnbqkpRNBQKP1-8/]+ [wb] /.test(t)) {
      new Chess(t) // valida
      gameInfo = null
      board.loadMoves([], t)
      msg.textContent = 'Posición cargada.'
    } else {
      const { headers, count } = board.loadPgn(t)
      gameInfo = { white: headers.White || '?', black: headers.Black || '?', whiteElo: headers.WhiteElo, blackElo: headers.BlackElo,
        result: headers.Result, event: headers.Event, date: headers.Date, moves: board.moves.map((m) => m.san), fen: headers.FEN }
      msg.textContent = `${count} medias jugadas cargadas.`
    }
    annotations = []; evals = []; root.querySelector('#a-graph').replaceChildren()
    setTitle(); changed()
    return true
  } catch (e) {
    msg.textContent = 'No se pudo leer: revisa que sea un PGN o FEN válido.'
    return false
  }
}

async function copyPgn() {
  const g = { ...(gameInfo || { white: '?', black: '?', result: '*' }), moves: board.moves.map((m) => m.san), fen: board.startFen === board.positions[0] && board.startFen.startsWith('rnbqkbnr/pppppppp') ? '' : board.startFen }
  const pgn = gameToPgn(g)
  try { await navigator.clipboard.writeText(pgn); root.querySelector('#a-load-msg').textContent = 'PGN copiado.' }
  catch { root.querySelector('#a-pgn').value = pgn; root.querySelector('#a-load-msg').textContent = 'PGN puesto en el cuadro de texto.' }
}

function renderMoves() {
  const box = root.querySelector('#a-moves')
  box.replaceChildren()
  const startTurn = board.positions[0].split(' ')[1]
  let num = Number(board.positions[0].split(' ')[5]) || 1
  board.moves.forEach((m, i) => {
    const white = (i % 2 === 0) === (startTurn === 'w')
    if (white || i === 0) {
      const n = document.createElement('span'); n.className = 'mnum'; n.textContent = white ? `${num}.` : `${num}…`; box.appendChild(n)
    }
    const s = document.createElement('button')
    s.type = 'button'; s.className = 'mv' + (i + 1 === board.ply ? ' on' : '') + (annotations[i]?.cls ? ' ' + annotations[i].cls : '')
    s.dataset.ply = i + 1
    s.textContent = m.san + (annotations[i]?.mark || '')
    box.appendChild(s)
    if (!white) num += 1
  })
  box.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
}

function setEval(pawns, text) {
  const v = Math.max(-8, Math.min(8, pawns))
  const white = 50 + (v / 8) * 50
  root.querySelector('#a-evalfill').style.height = `${white}%`
  root.querySelector('#a-evaltext').textContent = text
}

let pending = 0
async function changed() {
  renderMoves()
  if (root.closest('[hidden]')) return
  explorer?.update(board.fen)
  const on = root.querySelector('#a-engine-on').checked
  const list = root.querySelector('#a-lines')
  const status = root.querySelector('#a-engine-status')
  board.setArrows([])
  if (!on) { engine.stop(); list.replaceChildren(); status.textContent = 'Análisis pausado.'; return }
  const fen = board.fen
  const chess = new Chess(fen)
  if (chess.isGameOver()) {
    engine.stop(); list.replaceChildren()
    status.textContent = chess.isCheckmate() ? 'Jaque mate.' : 'Tablas.'
    setEval(chess.isCheckmate() ? (chess.turn() === 'w' ? -8 : 8) : 0, chess.isCheckmate() ? '#' : '½')
    return
  }
  const id = ++pending
  status.textContent = 'Pensando…'
  await engine.analyze(fen, {
    depth: settings.engineDepth, multipv: settings.engineLines,
    onInfo: ({ depth, lines }) => {
      if (id !== pending) return
      status.textContent = `Profundidad ${depth}`
      list.replaceChildren(...lines.map((l) => {
        const li = document.createElement('li')
        const san = uciToSan(fen, l.pv, 12)
        li.dataset.move = san[0] || ''
        const sc = document.createElement('span'); sc.className = 'score'; sc.textContent = formatScore(l.score, fen)
        const tx = document.createElement('span'); tx.className = 'pv'; tx.textContent = numberLine(fen, san)
        li.append(sc, tx)
        return li
      }))
      if (lines[0]) {
        setEval(whitePov(lines[0].score, fen), formatScore(lines[0].score, fen))
        const best = lines[0].pv[0]
        if (best) board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4), type: ARROW_TYPE.info }])
      }
    },
  })
}

// Probabilidad de ganar (−1 a 1) a partir de la evaluación, como hace Lichess.
const winChance = (pawns) => 2 / (1 + Math.exp(-0.368208 * pawns)) - 1

async function analyzeGame() {
  const btn = root.querySelector('#a-full')
  const st = root.querySelector('#a-full-status')
  if (!board.moves.length) { st.textContent = 'Primero carga o juega una partida.'; return }
  btn.disabled = true
  root.querySelector('#a-engine-on').checked = false
  evals = []
  const fens = board.positions
  for (let i = 0; i < fens.length; i++) {
    st.textContent = `Analizando posición ${i + 1} de ${fens.length}…`
    const chess = new Chess(fens[i])
    if (chess.isCheckmate()) { evals.push(chess.turn() === 'w' ? -100 : 100); continue }
    if (chess.isGameOver()) { evals.push(0); continue }
    const r = await engine.analyze(fens[i], { depth: 13, multipv: 1 })
    evals.push(r.lines[0] ? whitePov(r.lines[0].score, fens[i]) : 0)
  }
  annotations = board.moves.map((m, i) => {
    const before = winChance(Math.max(-15, Math.min(15, evals[i])))
    const after = winChance(Math.max(-15, Math.min(15, evals[i + 1])))
    const loss = m.color === 'w' ? before - after : after - before
    if (loss >= 0.3) return { cls: 'blunder', mark: '??', loss }
    if (loss >= 0.2) return { cls: 'mistake', mark: '?', loss }
    if (loss >= 0.1) return { cls: 'inacc', mark: '?!', loss }
    return { loss }
  })
  const count = (c, cls) => annotations.filter((a, i) => a.cls === cls && board.moves[i].color === c).length
  st.textContent = `Blancas: ${count('w', 'blunder')} errores graves, ${count('w', 'mistake')} errores, ${count('w', 'inacc')} imprecisiones. ` +
    `Negras: ${count('b', 'blunder')} errores graves, ${count('b', 'mistake')} errores, ${count('b', 'inacc')} imprecisiones. Pulsa la gráfica para ir a una jugada.`
  btn.disabled = false
  root.querySelector('#a-engine-on').checked = true
  drawGraph()
  changed()
}

function drawGraph() {
  if (!evals.length) return
  const pts = evals.map((v, i) => ({ d: i, v: Math.max(-6, Math.min(6, v)) }))
  lineChart(root.querySelector('#a-graph'), [{ name: 'Evaluación', color: 'var(--s1)', area: true, endLabel: false, points: pts }], {
    height: 160, xKind: 'number', yDomain: [-6, 6], yFmt: d3.format('+~f'),
    xFmt: (p) => (p === 0 ? 'Inicio' : `${Math.ceil(p / 2)}${p % 2 ? '.' : '…'} ${board.moves[p - 1]?.san || ''}`),
    onClick: (p) => board.goto(p),
  })
}
