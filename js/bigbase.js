// Base grande (millones de partidas) publicada en internet como archivos troceados.
// La página no la descarga entera: pide solo el trozo de la posición, de las partidas o del jugador que hace falta.
// Los archivos se crean con tools/construir-base.mjs.
import { settings } from './store.js'
import { fenKey } from './board.js'
import { positionHash, shardOf, normName, playerPrefix, CHUNK } from './bigbase-format.js'

const MAX_FILES = 300
const files = new Map() // url -> Promise(JSON), los más usados se quedan en memoria
let manifestP = null
let manifestUrl = ''

export function baseUrl() {
  const u = (settings.bigBaseUrl || '').trim() || 'base/'
  return u.endsWith('/') ? u : u + '/'
}

// Datos de la base ({nombre, partidas, posiciones, …}) o null si no hay ninguna publicada en la dirección.
export function manifest() {
  const url = baseUrl() + 'manifest.json'
  if (manifestUrl !== url) {
    manifestUrl = url
    files.clear()
    manifestP = fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  }
  return manifestP
}

async function readJson(path) {
  const url = baseUrl() + path
  let p = files.get(url)
  if (p) { files.delete(url); files.set(url, p); return p }
  p = (async () => {
    const r = await fetch(url)
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`No se pudo leer la base (${r.status}).`)
    let bytes = new Uint8Array(await r.arrayBuffer())
    // Algunos servidores ya lo entregan descomprimido; otros entregan el .gz tal cual.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  })()
  p.catch(() => files.delete(url))
  files.set(url, p)
  if (files.size > MAX_FILES) files.delete(files.keys().next().value)
  return p
}

// Jugadas desde una posición, con el mismo formato que el explorador de Lichess para reutilizar su panel.
export async function explore(fen) {
  const m = await manifest()
  if (!m) throw new Error(`No hay base grande en ${baseUrl()}. Mira la página Base de datos.`)
  const [h1, h2] = positionHash(fenKey(fen))
  const shard = await readJson(`pos/${shardOf(h1).toString(16).padStart(3, '0')}.json.gz`)
  const rec = shard?.[`${h1.toString(36)}.${h2.toString(36)}`]
  const out = { white: 0, draws: 0, black: 0, moves: [], topGames: [], opening: null }
  if (!rec) return out
  const [moves, top] = rec
  for (const [san, , w, d, l, avg] of moves) {
    out.moves.push({ san, white: w, draws: d, black: l, averageRating: avg || null })
    out.white += w; out.draws += d; out.black += l
  }
  out.topGames = (await headers(top)).map((g) => ({
    id: g.id, white: { name: g.white, rating: g.whiteElo || '?' }, black: { name: g.black, rating: g.blackElo || '?' },
    winner: g.result === '1-0' ? 'white' : g.result === '0-1' ? 'black' : null, year: g.date.slice(0, 4),
  }))
  return out
}

const toGame = (id, h) => ({
  id: `base:${id}`, source: 'Base grande', white: h[0], black: h[1], whiteElo: h[2] || null, blackElo: h[3] || null,
  result: h[4], date: h[5] || '', event: h[6] || '', eco: h[7] || '', site: h[8] || '', round: h[9] || '', opening: '', fen: '',
})

// Cabeceras de varias partidas (sin jugadas), en el mismo orden que ids.
export async function headers(ids) {
  const chunks = await Promise.all([...new Set(ids.map((i) => Math.floor(i / CHUNK)))].map(async (c) => [c, await readJson(`cab/${c}.json.gz`)]))
  const byChunk = new Map(chunks)
  return ids.map((i) => {
    const h = byChunk.get(Math.floor(i / CHUNK))?.[i % CHUNK]
    return h ? toGame(i, h) : null
  }).filter(Boolean)
}

// Partida completa, lista para abrir en Análisis o Studio. Acepta el número o "base:número".
export async function fullGame(id) {
  const n = Number(String(id).replace('base:', ''))
  const c = Math.floor(n / CHUNK)
  const [cab, mov] = await Promise.all([readJson(`cab/${c}.json.gz`), readJson(`mov/${c}.json.gz`)])
  if (!cab?.[n % CHUNK]) throw new Error('No se encontró la partida en la base.')
  return { ...toGame(n, cab[n % CHUNK]), moves: mov[n % CHUNK].split(' ') }
}

// Jugadores cuyo nombre empieza por el texto (mínimo 3 letras, normalmente el apellido).
// Devuelve [{name, ids}] con las partidas de la más reciente a la más antigua.
export async function findPlayers(text) {
  const q = normName(text)
  if (q.length < 3) return []
  const idx = (await readJson(`jug/${playerPrefix(q)}.json.gz`)) || {}
  return Object.entries(idx)
    .filter(([name]) => normName(name).startsWith(q))
    .map(([name, ids]) => ({ name, ids }))
    .sort((a, b) => b.ids.length - a.ids.length)
}
