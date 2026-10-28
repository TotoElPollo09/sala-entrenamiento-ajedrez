// Página Ranking: liga por puntos entre los jugadores de Ajustes, por semana o por mes.
import { loadAll } from './sheet.js'
import { REGLAS, PESO, CATS, todayIso, historial } from './league.js'
import { settings, onSettingsChange } from './store.js'

const MOD = { blitz: 'blitz', bullet: 'bullet', rapid: 'rápidas', classical: 'clásicas', puzzle: 'puzzles', correspondence: 'correspondencia' }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const fd = (d) => `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1].slice(0, 3)}`
const label = (p) => (p.kind === 'mes' ? `${MESES[Number(p.start.slice(5, 7)) - 1]} ${p.start.slice(0, 4)}` : `${fd(p.start)} – ${fd(p.end)}`)
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const HTML = `
<div class="page-head">
  <div>
    <h1>Ranking</h1>
    <p class="lead" id="k-take">Cargando tu hoja de entrenamiento…</p>
  </div>
  <div class="row gap">
    <div class="seg" role="group" aria-label="Periodo" id="k-kind">
      <button type="button" data-kind="semana" aria-pressed="true">Semana</button>
      <button type="button" data-kind="mes" aria-pressed="false">Mes</button>
    </div>
    <button class="btn" id="k-reload" type="button">Recargar</button>
  </div>
</div>
<div class="alert" id="k-error" hidden></div>
<div class="row gap k-nav">
  <button class="btn" id="k-prev" type="button" aria-label="Periodo anterior">‹</button>
  <label class="field grow k-sel"><select id="k-period" aria-label="Periodo"></select></label>
  <button class="btn" id="k-next" type="button" aria-label="Periodo siguiente">›</button>
</div>
<div class="tiles" id="k-tiles"></div>
<section class="card">
  <h3>Clasificación</h3>
  <p class="note" id="k-note"></p>
  <div class="tablebox"><table class="table" id="k-table"><thead></thead><tbody></tbody></table></div>
  <div id="k-det" class="k-det"></div>
</section>
<div class="grid2">
  <section class="card">
    <h3>Palmarés</h3>
    <p class="note" id="k-pal-note"></p>
    <div class="tablebox"><table class="table clickable" id="k-hist"><thead></thead><tbody></tbody></table></div>
  </section>
  <section class="card">
    <h3>Cómo se puntúa</h3>
    <ul class="k-rules">
      <li><b>Peso por modalidad</b>: en partidas y en rating, rápidas cuenta ×${PESO.rapid}, blitz ×${PESO.blitz} y bullet ×${PESO.bullet}.</li>
      <li><b>Partidas</b> (solo puntuables): victoria ${REGLAS.victoria}, empate ${REGLAS.empate}, y +${REGLAS.sorpresa} si ganas a un rival con más rating, multiplicado por el peso. Una victoria en rápidas vale ${REGLAS.victoria * PESO.rapid}, en blitz ${REGLAS.victoria * PESO.blitz} y en bullet ${REGLAS.victoria * PESO.bullet}. Cuentan las ${REGLAS.partidasDia} primeras de cada día.</li>
      <li><b>Puzzles</b>: ${REGLAS.puzzle} por puzzle acertado, hasta ${REGLAS.puzzlesDia} al día. Solo cuentan si la hoja tiene puzzles de todos los jugadores.</li>
      <li><b>Puzzle Storm</b>: 1 punto por cada ${REGLAS.stormDiv} de tu mejor puntuación del día, y +${REGLAS.stormRecord} cada vez que bates tu récord.</li>
      <li><b>Rating</b>: 1 punto por cada ${REGLAS.ratingDiv} de rating que subes en cada modalidad durante el periodo, multiplicado por el peso (puzzles ×1). Bajar no resta.</li>
      <li><b>Constancia</b>: ${REGLAS.dia} puntos por cada día con alguna partida, puzzle o Storm.</li>
    </ul>
    <p class="note">La semana va de lunes a domingo. Los datos empiezan el 1 de enero de 2026. El periodo en curso no suma al palmarés hasta que termina.</p>
  </section>
</div>`

let root, data = null, kind = 'semana', idx = 0, hist = null

export function init(el) {
  root = el
  root.innerHTML = HTML
  root.querySelector('#k-reload').addEventListener('click', load)
  root.querySelector('#k-kind').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]')
    if (!b || b.dataset.kind === kind) return
    kind = b.dataset.kind; idx = 0
    root.querySelectorAll('#k-kind button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    compute()
  })
  root.querySelector('#k-period').addEventListener('change', (e) => { idx = Number(e.target.value); drawPeriod() })
  root.querySelector('#k-prev').addEventListener('click', () => { if (hist && idx < hist.tablas.length - 1) { idx++; drawPeriod() } })
  root.querySelector('#k-next').addEventListener('click', () => { if (idx > 0) { idx--; drawPeriod() } })
  root.querySelector('#k-hist').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]')
    if (tr) { idx = Number(tr.dataset.i); drawPeriod(); root.querySelector('#k-tiles').scrollIntoView({ behavior: 'smooth', block: 'center' }) }
  })
  onSettingsChange(() => load())
}

let loaded = false
export function shown() { if (!loaded) load() }

async function load() {
  loaded = true
  const err = root.querySelector('#k-error')
  err.hidden = true
  try {
    data = await loadAll()
    compute()
  } catch (e) {
    loaded = false
    err.textContent = e.message
    err.hidden = false
    root.querySelector('#k-take').textContent = 'No se pudieron cargar los datos.'
  }
}

const players = () => settings.players.map((p) => p.name).filter(Boolean)

function compute() {
  if (!data) return
  hist = historial(data, players(), kind, todayIso())
  const sel = root.querySelector('#k-period')
  sel.replaceChildren(...hist.tablas.map((t, i) => {
    const o = document.createElement('option')
    o.value = i
    o.textContent = label(t.period) + (i === 0 ? ' (en curso)' : '')
    return o
  }))
  drawPeriod()
  drawHistory()
}

function drawPeriod() {
  const t = hist.tablas[idx]
  if (!t) return
  const prev = hist.tablas[idx + 1]
  root.querySelector('#k-period').value = idx
  root.querySelector('#k-prev').disabled = idx >= hist.tablas.length - 1
  root.querySelector('#k-next').disabled = idx === 0
  const [a, b] = t.rows
  const enCurso = idx === 0
  const take = !a || a.total === 0
    ? 'Nadie ha sumado puntos todavía en este periodo.'
    : b && b.total === a.total
      ? `Empate a ${a.total} puntos ${enCurso ? 'por ahora' : 'en este periodo'}.`
      : `${a.jugador} ${enCurso ? 'va primero' : 'ganó'} con ${a.total} puntos${b ? `, ${a.total - b.total} más que ${b.jugador}` : ''}.`
  root.querySelector('#k-take').textContent = take

  // Tarjetas por jugador
  root.querySelector('#k-tiles').innerHTML = t.rows.map((r) => {
    const pp = prev?.rows.find((x) => x.jugador === r.jugador)
    const mov = pp ? pp.puesto - r.puesto : 0
    const sub = pp ? (mov > 0 ? `Sube ${mov} puesto${mov > 1 ? 's' : ''}` : mov < 0 ? `Baja ${-mov} puesto${mov < -1 ? 's' : ''}` : `Mismo puesto que el periodo anterior (${pp.total} pts)`) : 'Primer periodo'
    return `<div class="tile${r.puesto === 1 && r.total > 0 ? ' k-lead' : ''}"><span class="label">${r.puesto}º · ${esc(r.jugador)}</span><span class="big">${r.total} <small>pts</small></span><span class="sub ${mov > 0 ? 'up' : mov < 0 ? 'down' : ''}">${sub}</span></div>`
  }).join('')

  root.querySelector('#k-note').textContent = t.puzzlesOn
    ? 'Puntos de cada categoría en el periodo elegido.'
    : `Puntos de cada categoría en el periodo elegido. Los puzzles no suman: la hoja no tiene puzzles de ${players().filter((p) => !(data.puzzles || []).some((r) => r.Jugador === p)).join(' ni ')}.`

  const table = root.querySelector('#k-table')
  const cats = CATS.filter((c) => c.id !== 'puzzles' || t.puzzlesOn)
  table.tHead.innerHTML = `<tr><th class="n">#</th><th>Jugador</th>${cats.map((c) => `<th class="n">${c.name}</th>`).join('')}<th class="n">Total</th></tr>`
  table.tBodies[0].innerHTML = t.rows.map((r) =>
    `<tr${r.puesto === 1 && r.total > 0 ? ' class="total"' : ''}><td class="n">${r.puesto}</td><td>${esc(r.jugador)}</td>${cats.map((c) => `<td class="n">${r.pts[c.id]}</td>`).join('')}<td class="n"><b>${r.total}</b></td></tr>`).join('')

  root.querySelector('#k-det').innerHTML = t.rows.map((r) => `<p class="note"><b>${esc(r.jugador)}:</b> ${esc(detalle(r, t.puzzlesOn))}</p>`).join('')
}

function detalle(r, puzzlesOn) {
  const d = r.det, out = []
  const jug = d.victorias + d.empates + d.derrotas
  if (jug) out.push(`${d.victorias} victorias, ${d.empates} tablas y ${d.derrotas} derrotas${d.sorpresas ? ` (${d.sorpresas} contra más rating)` : ''}`)
  if (d.puzzles && puzzlesOn) out.push(`${d.puzzles} puzzles acertados`)
  if (d.stormDias) out.push(`Storm ${d.stormDias} día${d.stormDias > 1 ? 's' : ''}, mejor ${d.stormMejor}${d.records ? `, ${d.records} récord${d.records > 1 ? 's' : ''}` : ''}`)
  const rg = Object.entries(d.ratingGanado).map(([m, g]) => `${MOD[m] || m} ${signed(g)}`)
  if (rg.length) out.push(`rating ${rg.join(', ')}`)
  out.push(`${d.dias} día${d.dias === 1 ? '' : 's'} entrenando`)
  return out.join(' · ') + '.'
}

function drawHistory() {
  const names = players()
  const cerrados = hist.tablas.filter((t) => t.period.end < todayIso()).length
  const tit = Object.entries(hist.titulos).sort((a, b) => b[1] - a[1])
  root.querySelector('#k-pal-note').textContent = cerrados
    ? `${kind === 'mes' ? 'Meses' : 'Semanas'} ganados desde el 1 de enero: ${tit.map(([n, c]) => `${n} ${c}`).join(', ')}. Pulsa una fila para verla.`
    : 'Todavía no ha terminado ningún periodo.'
  const table = root.querySelector('#k-hist')
  table.tHead.innerHTML = `<tr><th>${kind === 'mes' ? 'Mes' : 'Semana'}</th><th>Ganador</th>${names.map((n) => `<th class="n">${esc(n)}</th>`).join('')}</tr>`
  table.tBodies[0].innerHTML = hist.tablas.map((t, i) => {
    const top = t.rows.filter((r) => r.puesto === 1 && r.total > 0)
    const win = i === 0 ? 'En curso' : !top.length ? '—' : top.length > 1 ? 'Empate' : top[0].jugador
    return `<tr data-i="${i}"><td>${esc(label(t.period))}</td><td>${esc(win)}</td>${names.map((n) => `<td class="n">${t.rows.find((r) => r.jugador === n)?.total ?? '—'}</td>`).join('')}</tr>`
  }).join('')
}
