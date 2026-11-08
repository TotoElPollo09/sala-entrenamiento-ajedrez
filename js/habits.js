// Página Hábitos: el habit tracker mensual de la hoja de Google (una pestaña por jugador y mes: «JOHAN - NOVIEMBRE»…).
// Con el script de la hoja (Ajustes → Hábitos) se marcan las casillas desde aquí y se crea la pestaña de cada mes nuevo;
// sin él, la página solo lee la hoja pública.
/* global d3 */
import { loadRange } from './sheet.js'
import { settings, onSettingsChange } from './store.js'
import { lineChart } from './charts.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
const PREF_KEY = 'ajedrez-web:habitos'
const COLS = 36 // D..AM: 6 semanas × 6 días (lunes a sábado)
const FILA0 = 20

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()
const pad = (n) => String(n).padStart(2, '0')
const localIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const mesDe = (s) => MESES.map(norm).indexOf(norm(s)) + 1 // 1..12, 0 si no es un mes
const tabFor = (who, mes) => `${norm(who)} - ${MESES[mes - 1].toUpperCase()}`

// Las 36 columnas del tracker: empieza el lunes de la semana del día 1 (o el siguiente si el 1 cae en domingo).
export function gridDays(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const wd = (first.getUTCDay() + 6) % 7 // lunes = 0
  const start = first.getTime() - wd * 864e5 + (wd === 6 ? 7 * 864e5 : 0)
  return Array.from({ length: COLS }, (_, col) => {
    const w = Math.floor(col / 6), k = col % 6
    const d = new Date(start + (w * 7 + k) * 864e5)
    return { col, week: w, dow: k, iso: d.toISOString().slice(0, 10), on: d.getUTCMonth() === month - 1 }
  })
}

const HTML = `
<div class="page-head">
  <div>
    <h1>Hábitos</h1>
    <p class="lead" id="h-take">Cargando tu habit tracker…</p>
  </div>
  <div class="row gap flexwrap">
    <div class="seg" role="group" aria-label="Jugador" id="h-who"></div>
    <label class="field h-sel"><select id="h-month" aria-label="Mes"></select></label>
    <button class="btn" id="h-new" type="button" hidden>＋ Nuevo mes</button>
    <button class="btn" id="h-reload" type="button">Recargar</button>
    <a class="btn" id="h-open" target="_blank" rel="noopener" hidden>Abrir la hoja ↗</a>
  </div>
</div>
<div class="alert" id="h-error" hidden></div>
<div id="h-body" hidden>
  <div class="tiles" id="h-tiles"></div>
  <section class="card">
    <div class="row between flexwrap gap"><h3 id="h-title">Seguimiento</h3><span class="note" id="h-tab"></span></div>
    <div class="tablebox h-box"><table class="h-grid" id="h-grid"></table></div>
    <p class="note" id="h-help"></p>
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

let root, who, sel = null, cache = new Map(), meses = null, cur = null, token = 0, loaded = false

const canWrite = () => Boolean(settings.habitsUrl)
const players = () => settings.players.map((p) => p.name).filter(Boolean)
function prefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } catch { return {} } }
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify({ who, sel })) } catch { /* sin almacenamiento */ } }

// ---------- Script de la hoja ----------

async function api(params, post = false) {
  let res
  try {
    res = post
      ? await fetch(settings.habitsUrl, { method: 'POST', body: JSON.stringify(params) }) // text/plain: sin preflight CORS
      : await fetch(`${settings.habitsUrl}?${new URLSearchParams(params)}`)
  } catch {
    throw new Error('No se pudo conectar con el script de hábitos. Revisa su dirección en Ajustes → Hábitos.')
  }
  let j
  try { j = await res.json() } catch { throw new Error('El script de hábitos no respondió bien. ¿Está implementado como aplicación web con acceso para «Cualquier usuario»?') }
  if (!j.ok) throw new Error(j.error || 'El script de hábitos devolvió un error.')
  return j
}

const fromScript = (j) => ({ tab: j.pestana, year: j.anio, month: j.mes, habits: j.habitos.map((h) => ({ name: h.nombre, row: h.fila, done: h.hechos })) })

// ---------- Hoja pública (solo lectura) ----------

async function readPublic(tab, monthHint) {
  const [names, ym, checks] = await Promise.all([loadRange(tab, 'C15:C39'), loadRange(tab, 'O4:W4'), loadRange(tab, 'D20:AM39')])
  // gviz devuelve la primera pestaña si no encuentra el nombre: se comprueba que sea un tracker.
  if (!names || norm(names[0]?.[0]) !== 'HABITOS') return null
  const habits = []
  for (let i = 0; i < 20; i++) {
    const name = String(names[5 + i]?.[0] ?? '').trim()
    if (!name || /^INGRESA UN HABITO/.test(norm(name))) continue
    const r = checks?.[i] || []
    habits.push({ name, row: FILA0 + i, done: Array.from({ length: COLS }, (_, c) => String(r[c] ?? '').trim().toUpperCase() === 'TRUE') })
  }
  const row = ym?.[0] || []
  return { tab, year: Number(row[0]) || new Date().getFullYear(), month: mesDe(row[row.length - 1]) || monthHint, habits }
}

// ---------- Página ----------

export function init(el) {
  root = el
  root.innerHTML = HTML
  const p = prefs()
  who = p.who
  sel = p.sel ?? null
  root.querySelector('#h-month').addEventListener('change', (e) => { sel = e.target.value; savePrefs(); load() })
  root.querySelector('#h-who').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-who]')
    if (!b || b.dataset.who === who) return
    who = b.dataset.who; sel = null; savePrefs(); drawWho(); drawMonths(); load()
  })
  root.querySelector('#h-reload').addEventListener('click', () => { cache.clear(); meses = null; load() })
  root.querySelector('#h-new').addEventListener('click', newMonth)
  root.querySelector('#h-grid').addEventListener('click', toggle)
  onSettingsChange(() => { cache.clear(); meses = null; drawWho(); if (loaded) load() })
  drawWho()
}

export function shown() { if (!loaded) load() }

function drawWho() {
  const names = players()
  if (!names.includes(who)) who = names[0]
  root.querySelector('#h-who').innerHTML = names.map((n) => `<button type="button" data-who="${esc(n)}" aria-pressed="${n === who}">${esc(n)}</button>`).join('')
}

// Meses del jugador: con script, las pestañas que existen; sin script, los 12 meses del año.
function monthOptions() {
  if (canWrite() && meses) {
    return meses.filter((m) => norm(m.jugador) === norm(who) && m.mes)
      .sort((a, b) => (b.anio * 12 + b.mes) - (a.anio * 12 + a.mes))
      .map((m) => ({ value: m.pestana, label: `${cap(MESES[m.mes - 1])} ${m.anio}`, ym: m.anio * 12 + m.mes }))
  }
  return MESES.map((m, i) => ({ value: String(i + 1), label: cap(m) }))
}

function drawMonths() {
  const opts = monthOptions()
  const now = new Date()
  const nowYm = now.getFullYear() * 12 + now.getMonth() + 1
  if (!opts.some((o) => o.value === sel)) {
    sel = canWrite()
      ? (opts.find((o) => o.ym === nowYm) || opts.find((o) => o.ym < nowYm) || opts[0])?.value ?? null
      : String(now.getMonth() + 1)
  }
  const s = root.querySelector('#h-month')
  s.innerHTML = opts.length ? opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('') : '<option value="">Sin meses</option>'
  s.value = sel ?? ''
  root.querySelector('#h-new').hidden = !canWrite()
}

async function load() {
  loaded = true
  const my = ++token
  const err = root.querySelector('#h-error')
  err.hidden = true
  try {
    if (canWrite() && !meses) {
      root.querySelector('#h-take').textContent = 'Buscando tus meses guardados…'
      meses = (await api({ accion: 'lista' })).meses
      if (my !== token) return
    }
    drawMonths()
    const tab = canWrite() ? sel : tabFor(who, Number(sel))
    if (!tab) return showMissing(`${who} todavía no tiene ningún mes guardado. Pulsa «＋ Nuevo mes» para crear el de este mes.`)
    root.querySelector('#h-take').textContent = `Cargando «${tab}»…`
    let data = cache.get(tab)
    if (data === undefined) {
      if (!settings.sheetId && !canWrite()) throw new Error('Pega el enlace de tu hoja de Google en Ajustes para ver tus hábitos.')
      data = canWrite() ? fromScript(await api({ accion: 'leer', pestana: tab })) : await readPublic(tab, Number(sel))
      cache.set(tab, data)
    }
    if (my !== token) return
    if (!data) return showMissing(`No hay pestaña «${tab}» en tu hoja. Crea una con ese nombre (duplicando la del mes anterior), o conecta el script de hábitos en Ajustes para que la web cree cada mes sola.`)
    cur = data
    draw(true)
  } catch (e) {
    if (my !== token) return
    loaded = false
    root.querySelector('#h-body').hidden = true
    err.textContent = e.message
    err.hidden = false
    root.querySelector('#h-take').textContent = 'No se pudo cargar el habit tracker.'
  }
}

function showMissing(msg) {
  root.querySelector('#h-body').hidden = true
  root.querySelector('#h-take').textContent = 'No hay datos para este mes.'
  const err = root.querySelector('#h-error')
  err.textContent = msg
  err.hidden = false
}

// Crea la pestaña del mes actual o, si ya existe, la del mes siguiente al último guardado.
async function newMonth() {
  const now = new Date()
  const nowYm = now.getFullYear() * 12 + now.getMonth()
  const mine = (meses || []).filter((m) => norm(m.jugador) === norm(who) && m.mes).map((m) => m.anio * 12 + m.mes - 1)
  const ym = mine.includes(nowYm) ? Math.max(...mine) + 1 : nowYm
  const anio = Math.floor(ym / 12), mes = (ym % 12) + 1
  if (!confirm(`¿Crear ${MESES[mes - 1]} ${anio} para ${who}? Se copian los hábitos del último mes con las casillas vacías; los meses anteriores quedan guardados.`)) return
  const btn = root.querySelector('#h-new')
  btn.disabled = true
  try {
    const j = await api({ accion: 'nuevoMes', jugador: who, anio, mes }, true)
    const d = fromScript(j)
    cache.set(d.tab, d)
    meses = null
    sel = d.tab
    savePrefs()
    await load()
  } catch (e) {
    alert(e.message)
  } finally {
    btn.disabled = false
  }
}

async function toggle(e) {
  const b = e.target.closest('button.h-ck')
  if (!b || !cur || !canWrite() || b.disabled) return
  const h = cur.habits[Number(b.dataset.h)]
  const col = Number(b.dataset.c)
  const data = cur
  const valor = !h.done[col]
  h.done[col] = valor
  draw()
  try {
    await api({ accion: 'marcar', pestana: data.tab, fila: h.row, col, valor }, true)
  } catch (err) {
    h.done[col] = !valor
    if (cur === data) draw()
    alert(`No se guardó la casilla: ${err.message}`)
  }
}

function draw(first = false) {
  const { tab, year, month, habits } = cur
  const today = localIso()
  const act = gridDays(year, month).filter((x) => x.on)
  const H = habits.length
  const posibles = H * act.length
  const hechoDia = (x) => habits.reduce((s, h) => s + (h.done[x.col] ? 1 : 0), 0)
  const completados = act.reduce((s, x) => s + hechoDia(x), 0)
  const pasados = act.filter((x) => x.iso <= today)
  const posiblesHoy = H * pasados.length
  const hechosHoy = pasados.reduce((s, x) => s + hechoDia(x), 0)
  const hoy = act.find((x) => x.iso === today)
  const mesTxt = `${MESES[month - 1]} ${year}`

  root.querySelector('#h-body').hidden = false
  const link = root.querySelector('#h-open')
  link.href = `https://docs.google.com/spreadsheets/d/${settings.sheetId}/edit`
  link.hidden = !settings.sheetId
  root.querySelector('#h-tab').textContent = `Pestaña «${tab}»`
  root.querySelector('#h-title').textContent = `${cap(mesTxt)} · ${who}`
  root.querySelector('#h-help').innerHTML = canWrite()
    ? 'Semanas de lunes a sábado. Pulsa una casilla para marcarla o desmarcarla: se guarda al momento en la hoja.'
    : 'Semanas de lunes a sábado. Los hábitos se marcan en la hoja; luego pulsa <b>Recargar</b>. Para marcarlos desde aquí, conecta el script de hábitos en <a href="#settings">Ajustes</a>.'
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

  drawGrid(act, habits, today, first)
  drawChart(act, hechoDia, H, today)
  drawProgress(completados, posibles, act, habits)
}

function drawGrid(act, habits, today, first) {
  const box = root.querySelector('.h-box')
  const keep = box.scrollLeft
  const weeks = d3.groups(act, (x) => x.week)
  const ds0 = new Set(weeks.map(([, ds]) => ds[0].col))
  const cls = (x, extra = '') => [x.iso === today ? 'h-today' : '', x.iso > today ? 'h-fut' : '', ds0.has(x.col) ? 'h-ws' : '', extra].filter(Boolean).join(' ')
  const head1 = weeks.map(([, ds], i) => `<th class="h-wk" colspan="${ds.length}">${ds.length < 3 ? 'Sem' : 'Semana'} ${i + 1}</th>`).join('')
  const head2 = act.map((x) => `<th class="${cls(x)}">${DIAS[x.dow]}</th>`).join('')
  const head3 = act.map((x) => `<th class="${cls(x, 'h-num')}">${Number(x.iso.slice(8))}</th>`).join('')
  const write = canWrite()
  const body = habits.map((h, i) => {
    const n = act.filter((x) => h.done[x.col]).length
    const p = pct(n, act.length)
    return `<tr><th scope="row" class="h-name" title="${esc(h.name)}">${esc(h.name)}</th>${act.map((x) => {
      const on = h.done[x.col]
      const tick = on ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>' : ''
      const label = `${esc(h.name)}, ${Number(x.iso.slice(8))} de ${MESES[Number(x.iso.slice(5, 7)) - 1]}`
      return `<td class="${cls(x)}">${write
        ? `<button type="button" class="h-ck${on ? ' on' : ''}" data-h="${i}" data-c="${x.col}" aria-pressed="${on}" aria-label="${label}">${tick}</button>`
        : `<span class="h-ck${on ? ' on' : ''}" role="img" aria-label="${label}: ${on ? 'hecho' : 'sin hacer'}">${tick}</span>`}</td>`
    }).join('')}<td class="h-tot">${n} / ${act.length}</td><td class="h-pc"><div><span class="h-bar"><i style="width:${p}%"></i></span><b>${p}%</b></div></td></tr>`
  }).join('')
  root.querySelector('#h-grid').innerHTML = `
    <thead>
      <tr><th class="h-name" rowspan="3">Hábitos</th>${head1}<th class="h-tot" rowspan="3">Hechos</th><th class="h-pc" rowspan="3">Total</th></tr>
      <tr>${head2}</tr>
      <tr>${head3}</tr>
    </thead>
    <tbody>${body || `<tr><td colspan="${act.length + 3}" class="note">Sin hábitos en esta pestaña.</td></tr>`}</tbody>`
  if (!first) { box.scrollLeft = keep; return }
  // Al abrir un mes en pantalla estrecha, se lleva el día de hoy a la vista.
  const t = root.querySelector('#h-grid th.h-today')
  box.scrollLeft = t && t.offsetLeft + t.offsetWidth > box.clientWidth ? Math.max(0, t.offsetLeft - box.clientWidth / 2) : 0
}

let chartResize = () => {}
function drawChart(act, hechoDia, H, today) {
  const hasta = act.filter((x) => x.iso <= today)
  const ds = hasta.length ? hasta : act
  let acc = 0
  const pts = ds.map((x) => ({ d: new Date(x.iso + 'T00:00:00Z'), n: hechoDia(x) }))
  const accum = pts.map((p) => ({ d: p.d, v: (acc += p.n) }))
  const daily = pts.map((p) => ({ d: p.d, v: p.n }))
  root.querySelector('#h-chart-note').textContent = H ? `Hábitos completados sumados día a día y cuántos se hicieron cada día (de ${H} posibles).` : ''
  const box = root.querySelector('#h-chart')
  const fx = d3.utcFormat('%-d')
  const render = () => lineChart(box, [
    { name: 'Acumulado', color: 'var(--s3)', points: accum, area: true },
    { name: 'Del día', color: 'var(--s1)', points: daily },
  ], { height: 260, yZero: true, xFmt: (d) => fx(d), yDomain: [0, Math.max(4, acc)] })
  render()
  window.removeEventListener('resize', chartResize)
  chartResize = () => { if (!root.hidden) render() }
  window.addEventListener('resize', chartResize)
}

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
  const rows = habits.map((h) => ({ name: h.name, n: act.filter((x) => h.done[x.col]).length })).sort((a, b) => b.n - a.n)
  root.querySelector('#h-bars').innerHTML = rows.map((r) => {
    const q = pct(r.n, act.length)
    return `<div class="h-brow"><span class="h-bn" title="${esc(r.name)}">${esc(r.name)}</span><span class="h-bar"><i style="width:${q}%"></i></span><b>${q}%</b></div>`
  }).join('')
}
