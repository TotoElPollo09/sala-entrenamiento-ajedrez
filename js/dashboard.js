// Página Dashboard: métricas de la hoja de entrenamiento.
/* global d3 */
import { loadAll } from './sheet.js'
import * as M from './metrics.js'
import { lineChart, fDay, SERIES } from './charts.js'
import { settings, emit, onSettingsChange } from './store.js'
import { temaName } from './names.js'

const pct = d3.format('.0%')
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n)
const MOD = { blitz: 'Blitz', bullet: 'Bullet', rapid: 'Rápidas', classical: 'Clásicas', puzzle: 'Puzzles', correspondence: 'Correspondencia', total: 'Total' }

const HTML = `
<div class="page-head">
  <div>
    <h1>Dashboard</h1>
    <p class="lead" id="d-take">Cargando tu hoja de entrenamiento…</p>
  </div>
  <div class="row gap">
    <div class="seg" role="group" aria-label="Jugador" id="d-players"></div>
    <button class="btn" id="d-reload" type="button">Recargar</button>
  </div>
</div>
<div class="alert" id="d-error" hidden></div>
<div class="tiles" id="d-tiles"></div>
<section class="card" id="d-rating-card">
  <h3>Evolución del rating</h3>
  <p class="note">Rating de Lichess al cierre de cada día con partidas.</p>
  <div class="chart" id="d-rating"></div>
</section>
<div class="grid2">
  <section class="card">
    <h3>Puzzle Storm</h3>
    <p class="note">Puntos: mejor puntuación de cada día. Línea: media de los últimos 10 días jugados.</p>
    <div class="chart" id="d-storm"></div>
  </section>
  <section class="card">
    <h3>Acierto por tema</h3>
    <p class="note" id="d-temas-note">Temas con al menos 10 intentos, de peor a mejor. Los de arriba son los que más conviene entrenar.</p>
    <div class="bars" id="d-temas"></div>
  </section>
</div>
<div class="grid2">
  <section class="card">
    <h3>Resultados por modalidad</h3>
    <p class="note">Victoria 1 punto, empate ½.</p>
    <div class="tablebox"><table class="table" id="d-res"><thead><tr>
      <th>Modalidad</th><th class="n">Partidas</th><th class="n">V</th><th class="n">E</th><th class="n">D</th><th class="n">Puntos</th><th class="hide-narrow">V / E / D</th>
    </tr></thead><tbody></tbody></table></div>
    <p class="note" id="d-color"></p>
  </section>
  <section class="card">
    <h3>Aperturas más jugadas</h3>
    <p class="note">Familias con al menos 5 partidas. Pulsa una fila para estudiarla en el tablero.</p>
    <div class="tablebox"><table class="table clickable" id="d-ape"><thead><tr>
      <th>Apertura</th><th>Color</th><th class="n">Partidas</th><th class="n">Puntos</th><th class="n hide-narrow">Rival medio</th>
    </tr></thead><tbody></tbody></table></div>
  </section>
</div>
<section class="card">
  <h3>Rivales más frecuentes</h3>
  <p class="note">Pulsa un rival para ver su repertorio en la página Rivales.</p>
  <div class="tablebox"><table class="table clickable" id="d-riv"><thead><tr>
    <th>Rival</th><th class="n">Partidas</th><th class="n">Tus puntos</th><th class="n hide-narrow">Su rating</th>
  </tr></thead><tbody></tbody></table></div>
</section>`

let data = null
let player = null
let root

export function init(el) {
  root = el
  root.innerHTML = HTML
  player = settings.players[0]?.name || 'Johan'
  root.querySelector('#d-reload').addEventListener('click', load)
  root.querySelector('#d-ape').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]')
    if (!tr) return
    const a = currentApe[Number(tr.dataset.i)]
    emit('study-opening', { player, color: a.Color === 'Blancas' ? 'w' : 'b', opening: a.Apertura })
  })
  root.querySelector('#d-riv').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-rival]')
    if (tr) emit('open-rival', { username: tr.dataset.rival })
  })
  new ResizeObserver(() => data && drawCharts()).observe(root.querySelector('#d-rating'))
  onSettingsChange(() => load())
  load()
}

async function load() {
  const err = root.querySelector('#d-error')
  err.hidden = true
  try {
    data = await loadAll()
    draw()
  } catch (e) {
    err.textContent = e.message
    err.hidden = false
    root.querySelector('#d-take').textContent = 'No se pudieron cargar los datos.'
  }
}

function drawPlayers() {
  const seg = root.querySelector('#d-players')
  seg.replaceChildren(...settings.players.map((p) => {
    const b = document.createElement('button')
    b.type = 'button'; b.textContent = p.name; b.setAttribute('aria-pressed', String(p.name === player))
    b.addEventListener('click', () => { player = p.name; draw() })
    return b
  }))
}

let currentApe = []
function draw() {
  drawPlayers()
  const ra = M.ratingActual(data.ratings, player)
  const sd = M.stormDiario(data.storm, player)
  const sr = M.stormResumen(sd)
  const pr = M.puzzlesResumen(data.puzzles, player)

  // Frase resumen
  const main = ra.blitz ? ['blitz', ra.blitz] : Object.entries(ra).find(([k]) => k !== 'puzzle')
  const parts = []
  if (main) parts.push(`${MOD[main[0]].toLowerCase()} en ${main[1].actual} (${signed(main[1].cambio)} en 30 días)`)
  if (sr) parts.push(`récord de Puzzle Storm ${sr.record}`)
  if (pr) parts.push(`${pct(pr.precision)} de puzzles acertados`)
  root.querySelector('#d-take').textContent = parts.length ? `${player}: ${parts.join(', ').replace(/, ([^,]*)$/, ' y $1')}.` : `Sin datos de ${player}.`

  // Tarjetas
  const tile = (label, value, sub, cls = '') =>
    `<div class="tile"><span class="label">${label}</span><span class="big">${value}</span><span class="sub ${cls}">${sub}</span></div>`
  const tiles = ['blitz', 'bullet', 'rapid', 'puzzle'].map((mod) => {
    const r = ra[mod]
    if (!r) return tile(MOD[mod], '—', 'Sin datos')
    const sub = r.fecha === r.fechaPrevia ? '±0' : `${signed(r.cambio)} desde ${fDay(new Date(r.fechaPrevia.slice(0, 10) + 'T00:00:00Z'))}`
    return tile(MOD[mod] === 'Puzzles' ? 'Rating de puzzles' : MOD[mod], r.actual, sub, r.cambio > 0 ? 'up' : r.cambio < 0 ? 'down' : '')
  })
  tiles.push(tile('Récord Puzzle Storm', sr ? sr.record : '—', sr && sr.media30 != null ? `Media últimos 30 días: ${sr.media30.toFixed(1)}` : 'Sin sesiones recientes'))
  tiles.push(tile('Puzzles acertados', pr ? pct(pr.precision) : '—', pr ? `${pr.total} puzzles registrados` : 'Sin puzzles registrados'))
  root.querySelector('#d-tiles').innerHTML = tiles.join('')

  drawCharts()

  // Temas
  const tbox = root.querySelector('#d-temas')
  const temas = M.puzzlesTema(data.puzzles, player).slice(0, 14)
  tbox.replaceChildren()
  root.querySelector('#d-temas-note').textContent = temas.length
    ? 'Temas con al menos 10 intentos, de peor a mejor. Los de arriba son los que más conviene entrenar.'
    : `La hoja no tiene puzzles de ${player}. Falta su token de Lichess con permiso de puzzles en la sincronización.`
  for (const t of temas) {
    const row = document.createElement('div'); row.className = 'bar'
    const n = document.createElement('span'); n.className = 'bn'; n.textContent = `${temaName(t.tema)} · ${t.intentos}`
    const track = document.createElement('div'); track.className = 'bt'
    const fill = document.createElement('div'); fill.className = 'bf' + (t.precision < 0.6 ? ' bad' : ''); fill.style.width = t.precision * 100 + '%'
    track.appendChild(fill)
    const v = document.createElement('span'); v.className = 'bv'; v.textContent = pct(t.precision)
    row.append(n, track, v); tbox.appendChild(row)
  }

  // Resultados
  const tb = root.querySelector('#d-res tbody'); tb.replaceChildren()
  for (const r of M.partidasResumen(data.partidas, player)) {
    const tr = document.createElement('tr')
    if (r.Modalidad === 'total') tr.className = 'total'
    ;[MOD[r.Modalidad] || r.Modalidad, d3.format(',')(r.partidas), r.victorias, r.empates, r.derrotas, r.puntos == null ? '—' : pct(r.puntos)].forEach((c, i) => {
      const td = document.createElement('td'); td.textContent = c; if (i) td.className = 'n'; tr.appendChild(td)
    })
    const td = document.createElement('td'); td.className = 'hide-narrow'
    const wdl = document.createElement('div'); wdl.className = 'wdl'
    ;[[r.victorias, 'w'], [r.empates, 'd'], [r.derrotas, 'l']].forEach(([n, c]) => { const s = document.createElement('div'); s.className = c; s.style.flex = n; wdl.appendChild(s) })
    td.appendChild(wdl); tr.appendChild(td); tb.appendChild(tr)
  }
  const pc = M.porColor(data.partidas, player)
  root.querySelector('#d-color').textContent = `Con blancas: ${pc.Blancas == null ? '—' : pct(pc.Blancas)} de los puntos. Con negras: ${pc.Negras == null ? '—' : pct(pc.Negras)}.`

  // Aperturas
  currentApe = M.aperturas(data.partidas, player).sort((a, b) => b.partidas - a.partidas)
  const ab = root.querySelector('#d-ape tbody'); ab.replaceChildren()
  currentApe.forEach((a, i) => {
    const tr = document.createElement('tr'); tr.dataset.i = i
    ;[[a.Apertura, ''], [a.Color, ''], [a.partidas, 'n'], [pct(a.puntos), 'n'], [a.ratingRival, 'n hide-narrow']].forEach(([c, cls]) => {
      const td = document.createElement('td'); td.textContent = c; td.className = cls; tr.appendChild(td)
    })
    ab.appendChild(tr)
  })

  // Rivales
  const rb = root.querySelector('#d-riv tbody'); rb.replaceChildren()
  for (const r of M.rivalesFrecuentes(data.partidas, player)) {
    const tr = document.createElement('tr'); tr.dataset.rival = r.Rival
    ;[[r.Rival, ''], [r.partidas, 'n'], [pct(r.puntos), 'n'], [r.rating ?? '—', 'n hide-narrow']].forEach(([c, cls]) => {
      const td = document.createElement('td'); td.textContent = c; td.className = cls; tr.appendChild(td)
    })
    rb.appendChild(tr)
  }
}

function drawCharts() {
  const series = ['blitz', 'bullet', 'rapid', 'puzzle'].map((mod, i) => ({ name: MOD[mod], color: SERIES[i], points: M.ratingSeries(data.ratings, player, mod) }))
    .filter((s) => s.points.length)
  lineChart(root.querySelector('#d-rating'), series)
  const sd = M.stormDiario(data.storm, player)
  lineChart(root.querySelector('#d-storm'), [
    { name: 'Mejor del día', color: 'var(--muted-mark)', dots: true, endLabel: false, points: sd.map((r) => ({ d: r.d, v: r.puntuacion })) },
    { name: 'Media 10 días', color: SERIES[0], points: sd.map((r) => ({ d: r.d, v: Math.round(r.media10 * 10) / 10 })) },
  ], { yZero: true, yFmt: d3.format('~f') })
}
