// Página Base de datos: importar PGN (FIDE, TWIC, torneos) y buscar partidas.
import { streamPgnFile, importFilter, addGames, countGames, clearGames, findGames } from './db.js'
import { emit, onSettingsChange } from './store.js'
import * as bigbase from './bigbase.js'

const HTML = `
<div class="page-head"><div><h1>Base de datos</h1>
<p class="lead">Guarda en este navegador partidas oficiales y de torneos en formato PGN para estudiar rivales que no juegan en Lichess.</p></div></div>
<section class="card">
  <h3>Base grande</h3>
  <p class="note" id="g-status">Buscando la base grande…</p>
  <div class="row gap flexwrap end">
    <label class="field grow"><span>Jugador (apellido, mínimo 3 letras)</span><input id="g-player" placeholder="Carlsen" list="g-names"></label>
    <button class="btn primary" id="g-go" type="button">Buscar</button>
  </div>
  <datalist id="g-names"></datalist>
  <p class="note" id="g-msg"></p>
  <div class="tablebox tall" id="g-box" hidden><table class="table clickable" id="g-res"><thead><tr>
    <th>Fecha</th><th>Blancas</th><th>Negras</th><th>Resultado</th><th class="hide-narrow">ECO</th><th class="hide-narrow">Torneo</th>
  </tr></thead><tbody></tbody></table></div>
  <div class="row gap"><button class="btn small" id="g-more" type="button" hidden>Ver más partidas</button></div>
</section>
<section class="card">
  <h3>Importar PGN a este navegador</h3>
  <p class="note">Descarga partidas oficiales en PGN, por ejemplo de The Week in Chess (theweekinchess.com/twic) o de la web de tu federación o torneo, o exporta tu base de ChessBase a PGN, y arrástralas aquí.</p>
  <details class="b-filter">
    <summary>Filtro para bases grandes (opcional)</summary>
    <p class="note">Con una base de millones de partidas, guarda solo lo que vas a estudiar. El archivo se lee por trozos, así que puede pesar varios GB; se guardan solo las partidas que cumplan todo lo que escribas.</p>
    <div class="row gap flexwrap end">
      <label class="field grow"><span>Jugadores (separados por comas)</span><input id="f-player" placeholder="Carlsen, Caruana"></label>
      <label class="field grow"><span>Aperturas ECO</span><input id="f-eco" placeholder="B90-B99, C42, E6"></label>
    </div>
    <div class="row gap flexwrap end">
      <label class="field"><span>Elo mínimo</span><input id="f-elo" type="number" min="0" max="3000" step="50" placeholder="2400"></label>
      <label class="field"><span>Que lo cumpla</span><select id="f-both"><option value="1">Los dos jugadores</option><option value="0">Al menos uno</option></select></label>
      <label class="field"><span>Desde el año</span><input id="f-from" type="number" min="1800" max="2100" placeholder="2015"></label>
      <label class="field"><span>Hasta el año</span><input id="f-to" type="number" min="1800" max="2100" placeholder="hoy"></label>
      <label class="field"><span>Máximo a guardar</span><input id="f-max" type="number" min="1000" step="1000" value="300000"></label>
    </div>
  </details>
  <label class="drop" id="b-drop">
    <input type="file" id="b-file" accept=".pgn,.txt" multiple>
    <span>Arrastra archivos .pgn o pulsa para elegirlos</span>
  </label>
  <div class="row gap"><p class="note grow" id="b-status"></p><button class="btn small" id="b-cancel" type="button" hidden>Cancelar</button></div>
  <div class="progress" id="b-prog" hidden><div></div></div>
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
  initBig()
}

// ---- Base grande ----
let big = { ids: [], shown: 0, games: [] }
const fmtN = (n) => n.toLocaleString('es')

async function bigStatus() {
  const m = await bigbase.manifest()
  root.querySelector('#g-status').textContent = m
    ? `${m.nombre}: ${fmtN(m.partidas)} partidas y ${fmtN(m.posiciones)} posiciones (creada el ${m.creada}). Se consulta por partes: también la tienes en el explorador de Análisis y Studio, pestaña "Mi base".`
    : `No hay base grande en ${bigbase.baseUrl()}. Créala con tools/construir-base.mjs (instrucciones en el README) y pon su dirección en Ajustes.`
}

function initBig() {
  bigStatus()
  onSettingsChange(bigStatus)
  const inp = root.querySelector('#g-player')
  root.querySelector('#g-go').addEventListener('click', bigSearch)
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') bigSearch() })
  root.querySelector('#g-more').addEventListener('click', bigMore)
  root.querySelector('#g-res').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-i]')
    if (!tr) return
    const msg = root.querySelector('#g-msg')
    try { emit('open-game', await bigbase.fullGame(big.games[Number(tr.dataset.i)].id)); emit('go', 'analysis') } catch (err) { msg.textContent = err.message }
  })
}

async function bigSearch() {
  const msg = root.querySelector('#g-msg')
  const text = root.querySelector('#g-player').value.trim()
  big = { ids: [], shown: 0, games: [] }
  root.querySelector('#g-res tbody').replaceChildren()
  root.querySelector('#g-box').hidden = true
  root.querySelector('#g-more').hidden = true
  if (text.length < 3) { msg.textContent = 'Escribe al menos 3 letras del apellido.'; return }
  msg.textContent = 'Buscando…'
  try {
    const found = await bigbase.findPlayers(text)
    root.querySelector('#g-names').innerHTML = found.slice(0, 30).map((p) => `<option value="${p.name.replace(/"/g, '&quot;')}">`).join('')
    if (!found.length) { msg.textContent = 'Ningún jugador de la base empieza así.'; return }
    // Si el texto coincide con un nombre exacto, solo ese; si no, todos los que empiezan así (máximo 30).
    const exact = found.filter((p) => p.name.toLowerCase() === text.toLowerCase())
    const use = exact.length ? exact : found.slice(0, 30)
    big.ids = use.flatMap((p) => p.ids)
    msg.textContent = use.length === 1
      ? `${use[0].name}: ${fmtN(big.ids.length)} partidas.`
      : `${fmtN(found.length)} jugadores empiezan así (${use.slice(0, 5).map((p) => `${p.name} ${fmtN(p.ids.length)}`).join(', ')}${found.length > 5 ? '…' : ''}). Elige uno de la lista para ver solo sus partidas.`
    await bigMore()
  } catch (e) { msg.textContent = e.message }
}

async function bigMore() {
  const next = big.ids.slice(big.shown, big.shown + 100)
  big.shown += next.length
  const games = (await bigbase.headers(next)).sort((a, b) => (a.date < b.date ? 1 : -1))
  const tb = root.querySelector('#g-res tbody')
  for (const g of games) {
    const tr = document.createElement('tr'); tr.dataset.i = big.games.length
    big.games.push(g)
    ;[[g.date, ''], [`${g.white}${g.whiteElo ? ` (${g.whiteElo})` : ''}`, ''], [`${g.black}${g.blackElo ? ` (${g.blackElo})` : ''}`, ''], [g.result, ''],
      [g.eco, 'hide-narrow'], [g.event, 'hide-narrow']].forEach(([t, cls]) => {
      const td = document.createElement('td'); td.textContent = t; td.className = cls; tr.appendChild(td)
    })
    tb.appendChild(tr)
  }
  root.querySelector('#g-box').hidden = !big.games.length
  root.querySelector('#g-more').hidden = big.shown >= big.ids.length
}

async function refreshCount() {
  const n = await countGames()
  root.querySelector('#b-count').textContent = `${n.toLocaleString('es')} partidas guardadas en este navegador.`
}

let importing = null
async function importFiles(files) {
  if (importing || !files.length) return
  const st = root.querySelector('#b-status')
  const prog = root.querySelector('#b-prog')
  const cancel = root.querySelector('#b-cancel')
  const v = (id) => root.querySelector(id).value.trim()
  const keep = importFilter({ player: v('#f-player'), eco: v('#f-eco'), minElo: Number(v('#f-elo')) || 0, eloBoth: v('#f-both') === '1',
    fromYear: Number(v('#f-from')) || 0, toYear: Number(v('#f-to')) || 0 })
  const max = Number(v('#f-max')) || 300000
  const ctrl = new AbortController()
  importing = ctrl
  cancel.hidden = false; prog.hidden = false
  cancel.onclick = () => ctrl.abort()
  const fmt = (n) => n.toLocaleString('es')
  let saved = 0, scannedAll = 0, stopped = false
  try {
    for (const f of files) {
      let scanned = 0
      const ok = await streamPgnFile(f, {
        keep, signal: ctrl.signal,
        onBatch: async (games) => {
          const room = max - saved
          if (room <= 0) { ctrl.abort(); stopped = true; return }
          const part = games.slice(0, room)
          await addGames(part)
          saved += part.length
          if (saved >= max) { ctrl.abort(); stopped = true }
        },
        onProgress: ({ bytes, total, scanned: s }) => {
          scanned = s
          prog.firstElementChild.style.width = `${(bytes / total) * 100}%`
          st.textContent = `${f.name}: ${Math.round((bytes / total) * 100)} % leído · ${fmt(scannedAll + s)} partidas revisadas · ${fmt(saved)} guardadas`
        },
      })
      scannedAll += scanned
      if (!ok) break
    }
    st.textContent = stopped
      ? `Se llegó al máximo: ${fmt(saved)} partidas guardadas. Ajusta el filtro o sube el máximo si quieres más.`
      : ctrl.signal.aborted ? `Importación cancelada. Se guardaron ${fmt(saved)} partidas.`
        : `Listo: ${fmt(saved)} partidas guardadas${keep ? ` de ${fmt(scannedAll)} revisadas` : ''}.`
  } catch (e) {
    st.textContent = `No se pudo terminar la importación (${e.message}). Se guardaron ${fmt(saved)} partidas.`
  } finally {
    importing = null
    cancel.hidden = true; prog.hidden = true
    root.querySelector('#b-file').value = ''
    refreshCount()
  }
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
