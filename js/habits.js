// Página Hábitos: muestra el habit tracker mensual de la hoja de Google (pestañas "JOHAN - NOVIEMBRE", "MARI - OCTUBRE"…).
// Solo lectura: los hábitos se marcan en la hoja y aquí se ven con estadísticas y gráfico.
/* global d3 */
import { loadRange, isoDate } from './sheet.js'
import { settings, onSettingsChange } from './store.js'
import { lineChart } from './charts.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const PREF_KEY = 'ajedrez-web:habitos'
// Posición del tracker en la plantilla de la hoja.
const R = { names: 'C15:C39', nums: 'D17:AM17', dates: 'D18:AM18', active: 'D19:AM19', checks: 'D20:AM39' }
const COLS = 36 // D..AM: 6 semanas × 6 días (lunes a sábado)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
const pad = (n) => String(n).padStart(2, '0')
const localIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const HTML = `
<div class="page-head">
  <div>
    <h1>Hábitos</h1>
    <p class="lead" id="h-take">Cargando tu habit tracker…</p>
  </div>
  <div class="row gap flexwrap">
    <div class="seg" role="group" aria-label="Jugador" id="h-who"></div>
    <label class="field h-sel"><select id="h-month" aria-label="Mes"></select></label>
    <button class="btn" id="h-reload" type="button">Recargar</button>
    <a class="btn" id="h-open" target="_blank" rel="noopener" hidden>Marcar en la hoja ↗</a>
  </div>
</div>
<div class="alert" id="h-error" hidden></div>
<div id="h-body" hidden>
  <div class="tiles" id="h-tiles"></div>
  <section class="card">
    <div class="row between flexwrap gap"><h3 id="h-title">Seguimiento</h3><span class="note" id="h-tab"></span></div>
    <div class="tablebox h-box"><table class="h-grid" id="h-grid"></table></div>
    <p class="note">Semanas de lunes a sábado. El día de hoy va resaltado. Los hábitos se marcan en la hoja de Google; luego pulsa <b>Recargar</b>.</p>
  </section>
  <div class="grid2">
    <section class="card">
      <h3>Hábitos acumulados del mes</h3>
      <p class="note" id="h-chart-note"></p>
      <div class="chart" id="h-chart"></div>
    </section>
    <section class="card">
      <h3>Progreso mensual</h3>
      <div class="h-prog">
        <div class="h-dwrap"><div class="h-donut" id="h-donut"></div><span id="h-donut-v"></span></div>
        <div class="h-legend" id="h-legend"></div>
      </div>
      <div class="h-bars" id="h-bars"></div>
    </section>
  </div>
</div>`

let root, who, month, cache = new Map(), token = 0

function prefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } catch { return {} }
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ who, month })) } catch { /* sin almacenamiento */ }
}
const players = () => settings.players.map((p) => p.name).filter(Boolean)

export function init(el) {
  root = el
  root.innerHTML = HTML
  const p = prefs()
  month = Number.isInteger(p.month) ? p.month : new Date().getMonth()
  who = p.who
  const sel = root.querySelector('#h-month')
  sel.innerHTML = MESES.map((m, i) => `<option value="${i}">${cap(m)}</option>`).join('')
  sel.addEventListener('change', () => { month = Number(sel.value); savePrefs(); load() })
  root.querySelector('#h-who').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-who]')
    if (!b || b.dataset.who === who) return
    who = b.dataset.who; savePrefs(); drawWho(); load()
  })
  root.querySelector('#h-reload').addEventListener('click', () => { cache.clear(); load() })
  onSettingsChange(() => { cache.clear(); drawWho(); if (loaded) load() })
  drawWho()
}

function drawWho() {
  const names = players()
  if (!names.includes(who)) who = names[0]
  root.querySelector('#h-who').innerHTML = names.map((n) => `<button type="button" data-who="${esc(n)}" aria-pressed="${n === who}">${esc(n)}</button>`).join('')
  root.querySelector('#h-month').value = month
}

let loaded = false
export function shown() { if (!loaded) load() }

const tabName = () => `${norm(who)} - ${MESES[month].toUpperCase()}`

async function fetchTab(tab) {
  if (cache.has(tab)) return cache.get(tab)
  const [names, nums, dates, active, checks] = await Promise.all(Object.values(R).map((r) => loadRange(tab, r)))
  const head = names?.[0]?.[0]
  // gviz devuelve la primera pestaña si no encuentra el nombre: se comprueba que sea un tracker.
  const data = !names || norm(head) !== 'HABITOS' ? null : parseTracker({ names, nums, dates, active, checks })
  cache.set(tab, data)
  return data
}

function parseTracker({ names, nums, dates, active, checks }) {
  const row = (rows) => Array.from({ length: COLS }, (_, j) => String(rows?.[0]?.[j] ?? '').trim())
  const n = row(nums), d = row(dates), a = row(active)
  const days = []
  for (let j = 0; j < COLS; j++) {
    let iso = isoDate(d[j])
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) continue
    iso = iso.slice(0, 10)
    // Si la hoja exporta la fecha en formato mes/día, el número del día de la fila 17 lo corrige.
    const num = Number(n[j])
    if (num && Number(iso.slice(8)) !== num && Number(iso.slice(5, 7)) === num) iso = `${iso.slice(0, 4)}-${iso.slice(8)}-${iso.slice(5, 7)}`
    days.push({ col: j, iso, week: Math.floor(j / 6), on: a[j] === '' ? null : a[j] === '1' })
  }
  // Mes principal: el más repetido entre los días activos.
  const count = d3.rollup(days.filter((x) => x.on !== false), (v) => v.length, (x) => x.iso.slice(0, 7))
  const ym = [...count].sort((x, y) => y[1] - x[1])[0]?.[0]
  for (const x of days) if (x.on === null) x.on = x.iso.slice(0, 7) === ym
  const habits = []
  for (let i = 0; i < 20; i++) {
    const name = String(names[5 + i]?.[0] ?? '').trim()
    if (!name || /^INGRESA UN HABITO/.test(norm(name))) continue
    const r = checks?.[i] || []
    habits.push({ name, done: days.map((x) => String(r[x.col] ?? '').trim().toUpperCase() === 'TRUE') })
  }
  return { ym, days, habits }
}

async function load() {
  loaded = true
  const my = ++token
  const err = root.querySelector('#h-error')
  err.hidden = true
  const tab = tabName()
  root.querySelector('#h-take').textContent = `Cargando la pestaña «${tab}»…`
  try {
    const data = await fetchTab(tab)
    if (my !== token) return
    if (!data) {
      root.querySelector('#h-body').hidden = true
      root.querySelector('#h-take').textContent = `No hay pestaña «${tab}» en tu hoja.`
      err.textContent = `Para ver ${MESES[month]} de ${who}, crea en la hoja una pestaña llamada «${tab}» (por ejemplo duplicando la del mes anterior y cambiando el mes).`
      err.hidden = false
      return
    }
    draw(data, tab)
  } catch (e) {
    if (my !== token) return
    loaded = false
    root.querySelector('#h-body').hidden = true
    err.textContent = e.message
    err.hidden = false
    root.querySelector('#h-take').textContent = 'No se pudo cargar el habit tracker.'
  }
}

function draw({ ym, days, habits }, tab) {
  const today = localIso()
  const act = days.map((x, k) => ({ ...x, k })).filter((x) => x.on)
  const H = habits.length
  const posibles = H * act.length
  const hechoDia = (x) => habits.reduce((s, h) => s + (h.done[x.k] ? 1 : 0), 0)
  const completados = act.reduce((s, x) => s + hechoDia(x), 0)
  const pasados = act.filter((x) => x.iso <= today)
  const posiblesHoy = H * pasados.length
  const hechosHoy = pasados.reduce((s, x) => s + hechoDia(x), 0)
  const hoy = act.find((x) => x.iso === today)
  const [yy, mm] = (ym || today).split('-').map(Number)
  const mesTxt = `${MESES[mm - 1]} ${yy}`

  root.querySelector('#h-body').hidden = false
  const link = root.querySelector('#h-open')
  link.href = `https://docs.google.com/spreadsheets/d/${settings.sheetId}/edit`
  link.hidden = !settings.sheetId
  root.querySelector('#h-tab').textContent = `Pestaña «${tab}»`
  root.querySelector('#h-title').textContent = `${cap(mesTxt)} · ${who}`
  root.querySelector('#h-take').textContent = !H
    ? 'La pestaña no tiene hábitos todavía: escríbelos encima de «INGRESA UN HÁBITO» en la hoja.'
    : `${who} lleva ${completados} de ${posibles} hábitos completados en ${mesTxt} (${pct(completados, posibles)} %).` +
      (pasados.length && pasados.length < act.length ? ` Hasta hoy, ${pct(hechosHoy, posiblesHoy)} % de lo posible.` : '')

  const tiles = [
    ['Completados', completados, `de ${posibles} posibles este mes`],
    ['Pendientes', posibles - completados, `${act.length} días × ${H} hábitos`],
    ['Progreso del mes', `${pct(completados, posibles)}<small> %</small>`, 'del total del mes'],
    ['Al día de hoy', `${pct(hechosHoy, posiblesHoy)}<small> %</small>`, posiblesHoy ? `${hechosHoy} de ${posiblesHoy} hasta hoy` : 'El mes aún no empieza'],
  ]
  if (hoy) tiles.push(['Hoy', `${hechoDia(hoy)}<small> / ${H}</small>`, hechoDia(hoy) === H && H ? '¡Todo hecho hoy!' : 'hábitos marcados hoy'])
  root.querySelector('#h-tiles').innerHTML = tiles.map(([l, b, s]) => `<div class="tile"><span class="label">${l}</span><span class="big">${b}</span><span class="sub">${s}</span></div>`).join('')

  drawGrid(act, habits, today)
  drawChart(act, hechoDia, H, today)
  drawProgress(completados, posibles, act, habits)
}

function drawGrid(act, habits, today) {
  const weeks = d3.groups(act, (x) => x.week)
  const head1 = weeks.map(([, ds], i) => `<th class="h-wk" colspan="${ds.length}">${ds.length < 3 ? 'Sem' : 'Semana'} ${i + 1}</th>`).join('')
  const cls = (x, extra = '') => [x.iso === today ? 'h-today' : '', x.iso > today ? 'h-fut' : '', ds0.has(x.k) ? 'h-ws' : '', extra].filter(Boolean).join(' ')
  const ds0 = new Set(weeks.map(([, ds]) => ds[0].k))
  const head2 = act.map((x) => `<th class="${cls(x)}">${DIAS[new Date(x.iso + 'T12:00').getDay()]}</th>`).join('')
  const head3 = act.map((x) => `<th class="${cls(x, 'h-num')}">${Number(x.iso.slice(8))}</th>`).join('')
  const body = habits.map((h) => {
    const n = act.filter((x) => h.done[x.k]).length
    const p = pct(n, act.length)
    return `<tr><th scope="row" class="h-name">${esc(h.name)}</th>${act.map((x) => {
      const on = h.done[x.k]
      return `<td class="${cls(x)}"><span class="h-ck${on ? ' on' : ''}" role="img" aria-label="${on ? 'Hecho' : 'Sin hacer'}">${on ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>' : ''}</span></td>`
    }).join('')}<td class="h-tot">${n} / ${act.length}</td><td class="h-pc"><div><span class="h-bar"><i style="width:${p}%"></i></span><b>${p}%</b></div></td></tr>`
  }).join('')
  root.querySelector('#h-grid').innerHTML = `
    <thead>
      <tr><th class="h-name" rowspan="3">Hábitos</th>${head1}<th class="h-tot" rowspan="3">Hechos</th><th class="h-pc" rowspan="3">Total</th></tr>
      <tr>${head2}</tr>
      <tr>${head3}</tr>
    </thead>
    <tbody>${body || `<tr><td colspan="${act.length + 3}" class="note">Sin hábitos en esta pestaña.</td></tr>`}</tbody>`
  // En móvil se centra el día de hoy en la tabla.
  const t = root.querySelector('#h-grid th.h-today')
  const box = root.querySelector('.h-box')
  if (t && t.offsetLeft + t.offsetWidth > box.clientWidth) box.scrollLeft = Math.max(0, t.offsetLeft - box.clientWidth / 2)
}

function drawChart(act, hechoDia, H, today) {
  const hasta = act.filter((x) => x.iso <= today)
  const ds = hasta.length ? hasta : act
  let acc = 0
  const pts = ds.map((x) => ({ d: new Date(x.iso + 'T00:00:00Z'), n: hechoDia(x) }))
  const accum = pts.map((p) => ({ d: p.d, v: (acc += p.n) }))
  const daily = pts.map((p) => ({ d: p.d, v: p.n }))
  root.querySelector('#h-chart-note').textContent = H
    ? `Hábitos completados sumados día a día y cuántos se hicieron cada día (de ${H} posibles).`
    : ''
  const box = root.querySelector('#h-chart')
  const fx = d3.utcFormat('%-d')
  const render = () => lineChart(box, [
    { name: 'Acumulado', color: 'var(--s3)', points: accum, area: true },
    { name: 'Del día', color: 'var(--s1)', points: daily },
  ], { height: 260, yZero: true, xFmt: (d) => fx(d), yDomain: [0, Math.max(4, acc)] })
  render()
  window.removeEventListener('resize', chartResize)
  chartResize = () => { if (!root.closest('[hidden]') && !root.hidden) render() }
  window.addEventListener('resize', chartResize)
}
let chartResize = () => {}

function drawProgress(completados, posibles, act, habits) {
  const p = pct(completados, posibles)
  const donut = root.querySelector('#h-donut')
  donut.style.setProperty('--p', p)
  donut.setAttribute('role', 'img')
  donut.setAttribute('aria-label', `${p} % completado`)
  root.querySelector('#h-donut-v').innerHTML = `${p}<small>%</small>`
  root.querySelector('#h-legend').innerHTML = `
    <div class="h-lg done"><span class="label">Completado</span><b>${p} %</b><span class="note">${completados} hábitos</span></div>
    <div class="h-lg todo"><span class="label">Pendiente</span><b>${100 - p} %</b><span class="note">${posibles - completados} hábitos</span></div>`
  const rows = habits.map((h) => ({ name: h.name, n: act.filter((x) => h.done[x.k]).length })).sort((a, b) => b.n - a.n)
  root.querySelector('#h-bars').innerHTML = rows.map((r) => {
    const q = pct(r.n, act.length)
    return `<div class="h-brow"><span class="h-bn" title="${esc(r.name)}">${esc(r.name)}</span><span class="h-bar"><i style="width:${q}%"></i></span><b>${q}%</b></div>`
  }).join('')
}
