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
let manifestError = ''

// Por qué no se pudo leer la base, en palabras para el usuario ('' si no hubo error).
export const lastError = () => manifestError

export function baseUrl() {
  const u = (settings.bigBaseUrl || '').trim() || 'base/'
  return u.endsWith('/') ? u : u + '/'
}

// Datos de la base ({nombre, partidas, posiciones, …}) o null si no hay ninguna publicada en la dirección.
export function manifest() {
  const url = baseUrl() + 'manifest.json'
  const id = url + '|' + (settings.bigBaseKeyId || '')
  if (manifestUrl !== id) {
    manifestUrl = id
    files.clear()
    manifestError = ''
    const fail = (msg) => { manifestError = msg; manifestUrl = ''; return null }
    const r2 = /\.r2\.cloudflarestorage\.com/.test(url)
    manifestP = (r2 && (!settings.bigBaseKeyId || !settings.bigBaseSecret))
      ? Promise.resolve(fail('Faltan el ID de clave y la clave secreta del token de solo lectura de R2 en Ajustes.'))
      : get(url).then(async (r) => {
        if (r.ok) return r.json().catch(() => fail('El archivo manifest.json de esa dirección no es válido.'))
        if (r.status === 403 || r.status === 401) return fail(`R2 rechazó la clave (${r.status}). Revisa el ID de clave y la clave secreta, y que el token tenga permiso de lectura sobre ese bucket.`)
        if (r.status === 404) return fail('No hay manifest.json en esa dirección (404). Revisa el nombre del bucket y que la carpeta sea la que contiene manifest.json.')
        return fail(`El servidor respondió con un error ${r.status}.`)
      }).catch(() => fail(r2
        ? 'El navegador bloqueó la petición. Casi siempre es la regla CORS del bucket (Settings ▸ CORS Policy con https://totoelpollo09.github.io) o la dirección mal escrita.'
        : 'No se pudo conectar con esa dirección.'))
  }
  return manifestP
}

// Base privada en Cloudflare R2 (u otro almacenamiento S3): con la clave de solo lectura de Ajustes
// cada archivo se pide con una URL firmada que caduca a la hora.
async function signedUrl(url) {
  const { bigBaseKeyId: keyId, bigBaseSecret: secret } = settings
  if (!keyId || !secret) return url
  const u = new URL(url, location.href)
  const enc = new TextEncoder()
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const hmac = async (key, text) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(text))
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const day = now.slice(0, 8)
  const scope = `${day}/auto/s3/aws4_request`
  const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${keyId}/${scope}`, 'X-Amz-Date': now, 'X-Amz-Expires': '3600', 'X-Amz-SignedHeaders': 'host' }
  const rfc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  const query = Object.keys(q).sort().map((k) => `${rfc(k)}=${rfc(q[k])}`).join('&')
  const path = u.pathname.split('/').map((s) => rfc(decodeURIComponent(s))).join('/')
  const canonical = `GET\n${path}\n${query}\nhost:${u.host}\n\nhost\nUNSIGNED-PAYLOAD`
  const toSign = `AWS4-HMAC-SHA256\n${now}\n${scope}\n${hex(await crypto.subtle.digest('SHA-256', enc.encode(canonical)))}`
  let k = await hmac(enc.encode('AWS4' + secret), day)
  for (const part of ['auto', 's3', 'aws4_request']) k = await hmac(k, part)
  return `${u.origin}${path}?${query}&X-Amz-Signature=${hex(await hmac(k, toSign))}`
}

async function get(url) {
  return fetch(await signedUrl(url))
}

// Descarga y descomprime un archivo de la base (sin guardarlo en memoria).
async function fetchJson(path) {
  const r = await get(baseUrl() + path)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`No se pudo leer la base (${r.status}).`)
  let bytes = new Uint8Array(await r.arrayBuffer())
  // Algunos servidores ya lo entregan descomprimido; otros entregan el .gz tal cual.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

// Igual, pero los archivos más usados se quedan en memoria.
function readJson(path) {
  const url = baseUrl() + path
  let p = files.get(url)
  if (p) { files.delete(url); files.set(url, p); return p }
  p = fetchJson(path)
  p.catch(() => files.delete(url))
  files.set(url, p)
  if (files.size > MAX_FILES) files.delete(files.keys().next().value)
  return p
}

// Jugadas desde una posición, con el mismo formato que el explorador de Lichess para reutilizar su panel.
export async function explore(fen) {
  const m = await manifest()
  if (!m) throw new Error(manifestError ? `No se pudo leer la base grande: ${manifestError}` : `No hay base grande en ${baseUrl()}. Mira la página Base de datos.`)
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

// Muchas partidas completas (por ejemplo, todas las de un jugador), descargando cada bloque de 1000 una sola vez.
// onBatch(partidas, bloquesHechos, bloquesTotales) recibe las de cada bloque en cuanto llegan; stop() corta la descarga.
export async function gamesOf(ids, { onBatch, stop, parallel = 6 } = {}) {
  const byChunk = new Map()
  for (const i of ids) {
    const c = Math.floor(i / CHUNK)
    if (!byChunk.has(c)) byChunk.set(c, [])
    byChunk.get(c).push(i)
  }
  const queue = [...byChunk.entries()]
  const total = queue.length
  let done = 0
  const out = []
  const work = async () => {
    for (let job = queue.shift(); job && !stop?.(); job = queue.shift()) {
      const [c, list] = job
      const [cab, mov] = await Promise.all([fetchJson(`cab/${c}.json.gz`), fetchJson(`mov/${c}.json.gz`)])
      const games = list.filter((i) => cab?.[i % CHUNK]).map((i) => ({ ...toGame(i, cab[i % CHUNK]), moves: (mov?.[i % CHUNK] || '').split(' ').filter(Boolean) }))
      out.push(...games)
      done++
      onBatch?.(games, done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, total) }, work))
  return out
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
