// Página Rivales: repertorio y resultados de un jugador (Lichess o base local de PGN).
/* global d3 */
import { fetchUser, fetchUserGames } from './lichess.js'
import { gamesOfPlayer, addGames } from './db.js'
import { openingFamilies, colorOf, scoreFor } from './explorer.js'
import { emit, on } from './store.js'
import { state } from './state.js'

const pct = d3.format('.0%')
const SPEED = { ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápidas', classical: 'Clásicas', correspondence: 'Correspondencia', puzzle: 'Puzzles', storm: 'Puzzle Storm' }

const HTML = `
<div class="page-head"><div><h1>Rivales</h1>
<p class="lead">Prepara una partida: mira qué abre tu rival con cada color, cómo le va y repasa sus partidas con Stockfish.</p></div></div>
<section class="card">
  <div class="row gap flexwrap end">
    <label class="field"><span>Buscar en</span><select id="r-src"><option value="lichess">Lichess</option><option value="local">Base local (PGN de FIDE, torneos…)</option></select></label>
    <label class="field grow"><span id="r-name-l">Usuario de Lichess</span><input id="r-name" placeholder="p. ej. andreyMyk" autocomplete="off"></label>
    <label class="field" id="r-max-f"><span>Partidas</span><select id="r-max"><option>100</option><option selected>300</option><option>1000</option></select></label>
    <label class="field" id="r-speed-f"><span>Ritmo</span><select id="r-speed"><option value="">Todos</option><option value="bullet">Bullet</option><option value="blitz">Blitz</option><option value="rapid">Rápidas</option><option value="classical">Clásicas</option></select></label>
    <button class="btn primary" id="r-go" type="button">Analizar rival</button>
  </div>
  <p class="note" id="r-status"></p>
</section>
<div id="r-out" hidden>
  <div class="tiles" id="r-tiles"></div>
  <div class="row gap flexwrap">
    <button class="btn" id="r-study-w" type="button">Preparar sus aperturas con blancas</button>
    <button class="btn" id="r-study-b" type="button">Preparar sus aperturas con negras</button>
    <button class="btn" id="r-save" type="button">Guardar sus partidas en la base local</button>
  </div>
  <div class="grid2">
    <section class="card"><h3>Con blancas</h3><p class="note" id="r-first-w"></p>
      <div class="tablebox"><table class="table clickable" id="r-ape-w"><thead><tr><th>Apertura</th><th class="n">Partidas</th><th class="n">Sus puntos</th></tr></thead><tbody></tbody></table></div></section>
    <section class="card"><h3>Con negras</h3><p class="note" id="r-first-b"></p>
      <div class="tablebox"><table class="table clickable" id="r-ape-b"><thead><tr><th>Apertura</th><th class="n">Partidas</th><th class="n">Sus puntos</th></tr></thead><tbody></tbody></table></div></section>
  </div>
  <section class="card"><h3>Sus partidas</h3><p class="note">Pulsa una partida para analizarla con Stockfish.</p>
    <div class="row gap"><input id="r-filter" class="grow" placeholder="Filtrar por rival, apertura o resultado"></div>
    <div class="tablebox tall"><table class="table clickable" id="r-games"><thead><tr><th>Fecha</th><th>Color</th><th>Contra</th><th>Resultado</th><th class="hide-narrow">Apertura</th><th class="hide-narrow">Ritmo</th></tr></thead><tbody></tbody></table></div>
  </section>
</div>`

let root
let games = []
let name = ''

export function init(el) {
  root = el
  root.innerHTML = HTML
  root.querySelector('#r-go').addEventListener('click', run)
  root.querySelector('#r-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') run() })
  root.querySelector('#r-src').addEventListener('change', () => {
    const lichess = root.querySelector('#r-src').value === 'lichess'
    root.querySelector('#r-name-l').textContent = lichess ? 'Usuario de Lichess' : 'Nombre del jugador (como en el PGN)'
    root.querySelector('#r-name').placeholder = lichess ? 'p. ej. andreyMyk' : 'p. ej. Carlsen'
    root.querySelector('#r-max-f').hidden = !lichess
    root.querySelector('#r-speed-f').hidden = !lichess
  })
  root.querySelector('#r-study-w').addEventListener('click', () => emit('study-rival', { username: name, color: 'w' }))
  root.querySelector('#r-study-b').addEventListener('click', () => emit('study-rival', { username: name, color: 'b' }))
  root.querySelector('#r-save').addEventListener('click', async () => {
    const n = await addGames(games)
    root.querySelector('#r-status').textContent = `${n} partidas guardadas en tu base local.`
  })
  root.querySelector('#r-filter').addEventListener('input', renderGames)
  root.querySelector('#r-games').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]')
    if (!tr) return
    const g = games[Number(tr.dataset.i)]
    emit('open-game', g); emit('go', 'analysis')
  })
  for (const c of ['w', 'b']) {
    root.querySelector(`#r-ape-${c}`).addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-opening]')
      if (!tr) return
      root.querySelector('#r-filter').value = tr.dataset.opening
      renderGames()
      root.querySelector('#r-games').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }
  on('open-rival', ({ username }) => {
    emit('go', 'rivals')
    root.querySelector('#r-src').value = 'lichess'
    root.querySelector('#r-name').value = username
    run()
  })
}

async function run() {
  const q = root.querySelector('#r-name').value.trim()
  const status = root.querySelector('#r-status')
  if (!q) { status.textContent = 'Escribe un nombre.'; return }
  const src = root.querySelector('#r-src').value
  const btn = root.querySelector('#r-go')
  btn.disabled = true
  let profile = null
  try {
    if (src === 'lichess') {
      status.textContent = 'Buscando el perfil…'
      profile = await fetchUser(q)
      name = profile.username
      games = await fetchUserGames(name, {
        max: Number(root.querySelector('#r-max').value), perfType: root.querySelector('#r-speed').value,
        onProgress: (n) => { status.textContent = `Descargando partidas de ${name}: ${n}…` },
      })
    } else {
      status.textContent = 'Buscando en la base local…'
      const found = await gamesOfPlayer(q)
      const counts = new Map()
      for (const g of found) for (const n of [g.white, g.black]) if (n.toLowerCase().includes(q.toLowerCase())) counts.set(n, (counts.get(n) || 0) + 1)
      name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || q
      games = found.filter((g) => colorOf(g, name))
    }
    games.sort((a, b) => (a.date < b.date ? 1 : -1))
    state.rival = { name, games }
    status.textContent = games.length ? `${games.length} partidas de ${name}.` : `No hay partidas de ${q}.`
    render(profile)
  } catch (e) {
    status.textContent = e.message
  } finally {
    btn.disabled = false
  }
}

function render(profile) {
  root.querySelector('#r-out').hidden = !games.length
  if (!games.length) return
  const tiles = []
  const tile = (label, value, sub = '') => `<div class="tile"><span class="label">${esc(label)}</span><span class="big">${esc(value)}</span><span class="sub">${esc(sub)}</span></div>`
  if (profile?.perfs) {
    for (const k of ['bullet', 'blitz', 'rapid', 'classical']) {
      const p = profile.perfs[k]
      if (p && p.games) tiles.push(tile(SPEED[k], p.rating + (p.prov ? '?' : ''), `${d3.format(',')(p.games)} partidas`))
    }
  }
  const sc = (c) => {
    const s = games.filter((g) => colorOf(g, name) === c).map((g) => scoreFor(g, name)).filter((x) => x != null)
    return s.length ? [s.reduce((a, b) => a + b, 0) / s.length, s.length] : [null, 0]
  }
  const [sw, nw] = sc('w'), [sb, nb] = sc('b')
  tiles.push(tile('Con blancas', sw == null ? '—' : pct(sw), `${nw} partidas`))
  tiles.push(tile('Con negras', sb == null ? '—' : pct(sb), `${nb} partidas`))
  root.querySelector('#r-tiles').innerHTML = tiles.join('')

  const fams = openingFamilies(games, name)
  for (const c of ['w', 'b']) {
    const tb = root.querySelector(`#r-ape-${c} tbody`)
    tb.replaceChildren(...fams.filter((f) => f.color === c).slice(0, 15).map((f) => {
      const tr = document.createElement('tr'); tr.dataset.opening = f.opening
      ;[[f.opening, ''], [f.n, 'n'], [pct(f.score), f.score >= 0.6 ? 'n good' : f.score <= 0.4 ? 'n bad' : 'n']].forEach(([t, cls]) => {
        const td = document.createElement('td'); td.textContent = t; td.className = cls; tr.appendChild(td)
      })
      return tr
    }))
    // Primera jugada (con blancas) o respuesta a 1.e4 / 1.d4 (con negras)
    const mine = games.filter((g) => colorOf(g, name) === c && g.moves.length)
    let text = ''
    if (c === 'w') {
      const f = d3.rollups(mine, (v) => v.length, (g) => g.moves[0]).sort((a, b) => b[1] - a[1]).slice(0, 4)
      text = f.length ? 'Primera jugada: ' + f.map(([m, n]) => `1.${m} ${pct(n / mine.length)}`).join(', ') + '.' : ''
    } else {
      const parts = []
      for (const first of ['e4', 'd4']) {
        const v = mine.filter((g) => g.moves[0] === first && g.moves[1])
        if (v.length < 3) continue
        const top = d3.rollups(v, (x) => x.length, (g) => g.moves[1]).sort((a, b) => b[1] - a[1]).slice(0, 3)
        parts.push(`contra 1.${first}: ` + top.map(([m, n]) => `1…${m} ${pct(n / v.length)}`).join(', '))
      }
      text = parts.length ? 'Responde ' + parts.join('; ') + '.' : ''
    }
    root.querySelector(`#r-first-${c}`).textContent = text
  }
  renderGames()
}

function renderGames() {
  const f = root.querySelector('#r-filter').value.trim().toLowerCase()
  const tb = root.querySelector('#r-games tbody')
  const rows = []
  games.forEach((g, i) => {
    const c = colorOf(g, name)
    const opp = c === 'w' ? g.black : g.white
    const s = scoreFor(g, name)
    const res = s === 1 ? 'Ganó' : s === 0 ? 'Perdió' : s === 0.5 ? 'Tablas' : g.result
    const hay = `${opp} ${g.opening} ${res} ${g.eco}`.toLowerCase()
    if (f && !hay.includes(f)) return
    if (rows.length >= 300) return
    const tr = document.createElement('tr'); tr.dataset.i = i
    ;[[g.date, ''], [c === 'w' ? 'Blancas' : 'Negras', ''], [`${opp}${(c === 'w' ? g.blackElo : g.whiteElo) ? ` (${c === 'w' ? g.blackElo : g.whiteElo})` : ''}`, ''],
      [res, s === 1 ? 'good' : s === 0 ? 'bad' : ''], [g.opening || g.eco, 'hide-narrow'], [SPEED[g.speed] || g.event || '', 'hide-narrow']].forEach(([t, cls]) => {
      const td = document.createElement('td'); td.textContent = t ?? ''; td.className = cls; tr.appendChild(td)
    })
    rows.push(tr)
  })
  tb.replaceChildren(...rows)
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
