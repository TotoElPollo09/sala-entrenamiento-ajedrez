// Explorador de aperturas como el de lichess.org: Maestros, base de Lichess (por ritmo, rating y fechas) y Jugador.
/* global d3 */
import { explorerQuery, fetchExplorerPgn } from './lichess.js'
import { settings } from './store.js'

const KEY = 'ajedrez-web:explorador'
const SPEEDS = [['ultraBullet', 'UltraBullet'], ['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rápidas'], ['classical', 'Clásicas'], ['correspondence', 'Correspondencia']]
const RATINGS = [400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]
const DEFAULTS = { db: 'masters', speeds: ['blitz', 'rapid', 'classical'], ratings: [2000, 2200], since: '', until: '', mSince: '', mUntil: '', player: '', color: 'white' }

function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* sin almacenamiento */ } }

const HTML = `
<div class="row between"><h3>Explorador de aperturas</h3><button class="btn small" type="button" data-x="toggle" aria-expanded="false">Filtros</button></div>
<div class="seg ex-tabs" role="group" aria-label="Base de partidas">
  <button type="button" data-db="masters">Maestros</button><button type="button" data-db="lichess">Lichess</button><button type="button" data-db="player">Jugador</button>
</div>
<div class="ex-filters" hidden>
  <div data-for="lichess player"><span class="ex-label">Ritmo</span><div class="chips" data-x="speeds"></div></div>
  <div data-for="lichess"><span class="ex-label">Rating medio</span><div class="chips" data-x="ratings"></div></div>
  <div data-for="player" class="row gap flexwrap">
    <label class="field grow"><span>Usuario de Lichess</span><input data-x="player" placeholder="usuario" list="ex-players"></label>
    <div class="seg" role="group" aria-label="Color" data-x="color"><button type="button" data-c="white">Blancas</button><button type="button" data-c="black">Negras</button></div>
  </div>
  <div data-for="lichess player" class="row gap flexwrap">
    <label class="field"><span>Desde</span><input type="month" data-x="since"></label>
    <label class="field"><span>Hasta</span><input type="month" data-x="until"></label>
  </div>
  <div data-for="masters" class="row gap flexwrap">
    <label class="field"><span>Desde el año</span><input type="number" min="1952" max="2100" data-x="mSince" placeholder="1952"></label>
    <label class="field"><span>Hasta el año</span><input type="number" min="1952" max="2100" data-x="mUntil" placeholder="hoy"></label>
  </div>
</div>
<datalist id="ex-players"></datalist>
<p class="note" data-x="status"></p>
<div class="tablebox"><table class="table clickable ex-moves"><thead><tr>
  <th>Jugada</th><th class="n">Partidas</th><th class="n hide-narrow" data-x="avg-h">Rating</th><th>Resultados</th>
</tr></thead><tbody></tbody></table></div>
<h4 class="ex-sub" data-x="games-h">Partidas</h4>
<ul class="games ex-games"></ul>`

const pct = d3.format('.0%')
const fmtN = d3.format(',')

export class ExplorerPanel {
  // onMove(san): jugar una jugada; onGame(pgn, info): abrir una partida.
  constructor(el, { onMove, onGame }) {
    this.el = el
    this.onMove = onMove
    this.onGame = onGame
    this.p = loadPrefs()
    if (!this.p.player) this.p.player = settings.players.find((x) => x.lichess)?.lichess || ''
    this.cache = new Map()
    this.fen = null
    this.req = 0
    this.timer = null
    el.innerHTML = HTML
    this.$ = (x) => el.querySelector(`[data-x="${x}"]`)
    this.build()
  }

  build() {
    const el = this.el
    el.querySelector('#ex-players').innerHTML = settings.players.filter((x) => x.lichess).map((x) => `<option value="${x.lichess}">`).join('')
    const chips = (box, items, key) => {
      box.replaceChildren(...items.map(([v, label]) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.v = v
        b.addEventListener('click', () => {
          const set = new Set(this.p[key].map(String))
          if (set.has(String(v))) { if (set.size > 1) set.delete(String(v)) } else set.add(String(v))
          this.p[key] = items.map(([x]) => x).filter((x) => set.has(String(x)))
          this.changed()
        })
        return b
      }))
    }
    chips(this.$('speeds'), SPEEDS, 'speeds')
    chips(this.$('ratings'), RATINGS.map((r) => [r, String(r)]), 'ratings')
    el.querySelectorAll('[data-db]').forEach((b) => b.addEventListener('click', () => { this.p.db = b.dataset.db; this.changed() }))
    this.$('color').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this.p.color = b.dataset.c; this.changed() }))
    for (const k of ['since', 'until', 'mSince', 'mUntil', 'player']) {
      const inp = this.$(k)
      inp.value = this.p[k]
      inp.addEventListener('change', () => { this.p[k] = inp.value.trim(); this.changed() })
    }
    const tog = this.$('toggle')
    tog.addEventListener('click', () => {
      const f = el.querySelector('.ex-filters'); f.hidden = !f.hidden; tog.setAttribute('aria-expanded', String(!f.hidden))
    })
    el.querySelector('.ex-moves tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-san]'); if (tr) this.onMove(tr.dataset.san)
    })
    el.querySelector('.ex-games').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]'); if (li) this.openGame(li)
    })
    this.paintControls()
  }

  paintControls() {
    const { db } = this.p
    this.el.querySelectorAll('[data-db]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.db === db)))
    this.el.querySelectorAll('[data-for]').forEach((d) => { d.hidden = !d.dataset.for.split(' ').includes(db) })
    this.$('speeds').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(this.p.speeds.includes(b.dataset.v))))
    this.$('ratings').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(this.p.ratings.map(String).includes(b.dataset.v))))
    this.$('color').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === this.p.color)))
    this.$('avg-h').textContent = db === 'player' ? 'Rival medio' : 'Rating medio'
    this.$('games-h').textContent = db === 'masters' ? 'Partidas destacadas' : 'Partidas recientes'
  }

  changed() {
    savePrefs(this.p)
    this.paintControls()
    if (this.fen) this.update(this.fen, { now: true })
  }

  // Resumen de los filtros activos, para que se vea sin abrir el panel.
  summary() {
    const { db, speeds, ratings, since, until, mSince, mUntil, player, color } = this.p
    const range = (a, b) => (a || b ? ` · ${a || 'inicio'} a ${b || 'hoy'}` : '')
    const sp = speeds.map((s) => SPEEDS.find(([v]) => v === s)?.[1]).join(', ')
    if (db === 'masters') return `Partidas de maestros (2200+ FIDE)${range(mSince, mUntil)}`
    if (db === 'lichess') return `Lichess · ${sp} · rating ${ratings.join(', ')}${range(since, until)}`
    return `${player || '?'} con ${color === 'white' ? 'blancas' : 'negras'} · ${sp}${range(since, until)}`
  }

  params(fen) {
    const { db, speeds, ratings, since, until, mSince, mUntil, player, color } = this.p
    const q = { fen }
    if (db === 'masters') {
      q.topGames = '8'
      if (mSince) q.since = mSince
      if (mUntil) q.until = mUntil
    } else {
      q.speeds = speeds.join(',')
      q.recentGames = '8'
      if (since) q.since = since
      if (until) q.until = until
      if (db === 'lichess') { q.ratings = ratings.join(','); q.topGames = '0' }
      else { q.player = player; q.color = color; q.modes = 'rated,casual' }
    }
    return q
  }

  update(fen, { now = false } = {}) {
    this.fen = fen
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.load(fen), now ? 0 : 250)
  }

  async load(fen) {
    const db = this.p.db
    const status = this.$('status')
    if (db === 'player' && !this.p.player) { status.textContent = 'Escribe un usuario de Lichess en Filtros.'; this.render(null); return }
    const q = this.params(fen)
    const key = db + '?' + new URLSearchParams(q)
    const id = ++this.req
    status.textContent = `${this.summary()} · cargando…`
    try {
      let r = this.cache.get(key)
      if (!r) { r = await explorerQuery(db, q); this.cache.set(key, r) }
      if (id !== this.req) return
      const total = (r.white || 0) + (r.draws || 0) + (r.black || 0)
      status.textContent = `${this.summary()} · ${fmtN(total)} partidas${r.opening ? ` · ${r.opening.eco} ${r.opening.name}` : ''}`
      this.render(r, total)
    } catch (e) {
      if (id !== this.req) return
      status.textContent = e.message
      this.render(null)
    }
  }

  render(r, total = 0) {
    const tb = this.el.querySelector('.ex-moves tbody')
    tb.replaceChildren()
    const moves = r?.moves || []
    for (const m of moves) {
      const n = m.white + m.draws + m.black
      const tr = document.createElement('tr'); tr.dataset.san = m.san
      const c1 = document.createElement('td'); c1.className = 'san'; c1.textContent = m.san
      const c2 = document.createElement('td'); c2.className = 'n'; c2.textContent = `${fmtN(n)} · ${pct(total ? n / total : 0)}`
      const c3 = document.createElement('td'); c3.className = 'n hide-narrow'; c3.textContent = (this.p.db === 'player' ? m.averageOpponentRating : m.averageRating) || '—'
      const c4 = document.createElement('td')
      const bar = document.createElement('div'); bar.className = 'wdl labeled'
      ;[[m.white, 'wh'], [m.draws, 'd'], [m.black, 'bl']].forEach(([k, c]) => {
        const s = document.createElement('div'); s.className = c; s.style.flex = k
        const share = n ? k / n : 0
        if (share >= 0.12) s.textContent = pct(share)
        bar.appendChild(s)
      })
      c4.appendChild(bar)
      tr.append(c1, c2, c3, c4); tb.appendChild(tr)
    }
    if (!moves.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 4; td.className = 'muted'
      td.textContent = r ? 'No hay partidas en esta posición con estos filtros.' : '—'
      tr.appendChild(td); tb.appendChild(tr)
    }
    const games = [...(r?.topGames || []), ...(r?.recentGames || [])]
    const gl = this.el.querySelector('.ex-games')
    gl.replaceChildren(...games.map((g) => {
      const li = document.createElement('li'); li.dataset.id = g.id
      const res = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½'
      li.dataset.info = JSON.stringify({ white: g.white?.name, black: g.black?.name, whiteElo: g.white?.rating, blackElo: g.black?.rating, result: res })
      li.textContent = `${g.white?.name} (${g.white?.rating}) – ${g.black?.name} (${g.black?.rating}) · ${res} · ${g.month || g.year || ''}`
      li.title = 'Abrir en el tablero'
      return li
    }))
    if (!games.length) gl.innerHTML = '<li class="muted">Sin partidas que mostrar.</li>'
  }

  async openGame(li) {
    const status = this.$('status')
    const prev = status.textContent
    status.textContent = 'Abriendo la partida…'
    try {
      const pgn = await fetchExplorerPgn(li.dataset.id, this.p.db)
      status.textContent = prev
      this.onGame(pgn, JSON.parse(li.dataset.info))
    } catch (e) {
      status.textContent = e.message
    }
  }
}
