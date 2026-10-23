#!/usr/bin/env node
// Convierte un PGN enorme (millones de partidas) en una "base troceada" que la web consulta por partes,
// como el explorador de Lichess: la página solo descarga el trozo de la posición que estás mirando.
//
// Uso:
//   node tools/construir-base.mjs <archivo.pgn> [más archivos…] --salida base [opciones]
//
// Opciones:
//   --salida DIR        carpeta donde se escribe la base (por defecto: base)
//   --nombre TEXTO      nombre que se ve en la web (por defecto: el del primer archivo)
//   --max-jugadas N     medias jugadas que se indexan por partida (por defecto: 30)
//   --min-partidas N    una posición entra en el índice si la jugaron al menos N partidas (por defecto: 2)
//   --elo N             guarda solo partidas con los dos jugadores de al menos N de Elo
//   --desde AÑO / --hasta AÑO   guarda solo partidas de esos años
//   --hilos N           hilos de cálculo (por defecto: núcleos del ordenador menos 1)
//
// Resultado (todo .json.gz):
//   manifest.json             datos de la base (nombre, número de partidas, formato)
//   pos/XYZ.json.gz           4096 trozos del árbol de posiciones (con transposiciones)
//   cab/N.json.gz             cabeceras de 1000 partidas (jugadores, Elo, resultado, fecha, torneo, ECO)
//   mov/N.json.gz             jugadas de esas mismas 1000 partidas
//   jug/abc.json.gz           índice de jugadores por las tres primeras letras del nombre
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { Chess } from '../vendor/chess.js'
import { parsePgnFile, importFilter } from '../js/db.js'
import { positionHash, shardOf, playerPrefix, SHARD_BITS, CHUNK } from '../js/bigbase-format.js'

const BUCKETS = 256 // archivos temporales; cada uno se reparte luego en 16 trozos finales
const TOP_GAMES = 6

if (isMainThread) await main()
else worker()

// ---------- hilo de cálculo: reproduce las partidas y anota cada posición ----------
function worker() {
  const { tmp, maxPly } = workerData
  const MAX_CACHE = 600000
  let cached = 0
  const makeNode = (fen, san) => {
    const key = fen.split(' ').slice(0, 4).join(' ')
    const [h1, h2] = positionHash(key)
    const s = shardOf(h1)
    return { fen, san, bucket: s >>> (SHARD_BITS - 8), prefix: `${s}\t${h1.toString(36)}.${h2.toString(36)}`, next: new Map() }
  }
  const ROOT = makeNode(new Chess().fen(), '')
  const outs = Array.from({ length: BUCKETS }, () => [])
  let pending = 0
  const flush = (force) => {
    if (!force && pending < 200000) return
    outs.forEach((lines, b) => { if (lines.length) { fs.appendFileSync(path.join(tmp, `b${b}.txt`), lines.join('')); lines.length = 0 } })
    pending = 0
  }
  parentPort.on('message', (msg) => {
    if (msg === 'fin') { flush(true); parentPort.postMessage('fin'); return }
    for (const [id, result, elo, moves] of msg) {
      const r = result === '1-0' ? 'w' : result === '0-1' ? 'l' : result === '½-½' ? 'd' : 'x'
      const n = Math.min(maxPly, moves.length)
      let node = ROOT, chess = null
      const seen = new Set() // una posición repetida en la misma partida cuenta una sola vez
      for (let i = 0; i < n; i++) {
        // Las aperturas se repiten muchísimo: las jugadas ya vistas desde una posición se toman de la memoria.
        let next = node.next.get(moves[i])
        if (!next) {
          if (!chess) chess = new Chess(node.fen)
          let m
          try { m = chess.move(moves[i]) } catch { break }
          const fen = chess.fen()
          next = makeNode(fen, m.san)
          if (cached < MAX_CACHE) { node.next.set(moves[i], next); cached++ }
        } else chess = null
        if (!seen.has(node.prefix)) {
          seen.add(node.prefix)
          outs[node.bucket].push(`${node.prefix}\t${next.san}\t${r}\t${elo}\t${id}\n`)
          pending++
        }
        node = next
      }
    }
    flush(false)
    parentPort.postMessage('ok')
  })
}

// ---------- hilo principal ----------
async function main() {
  const args = process.argv.slice(2)
  const opt = { salida: 'base', 'max-jugadas': '30', 'min-partidas': '2', hilos: String(Math.max(1, os.cpus().length - 1)) }
  const files = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i]
    else files.push(args[i])
  }
  if (!files.length) {
    console.log('Uso: node tools/construir-base.mjs archivo.pgn [--salida base] [--max-jugadas 30] [--min-partidas 2] [--elo 2000] [--desde 1990] [--hasta 2026]')
    process.exit(1)
  }
  const out = path.resolve(opt.salida)
  const maxPly = Number(opt['max-jugadas'])
  const minGames = Number(opt['min-partidas'])
  const keep = importFilter({ minElo: Number(opt.elo) || 0, fromYear: Number(opt.desde) || 0, toYear: Number(opt.hasta) || 0 })
  for (const d of ['pos', 'cab', 'mov', 'jug']) { fs.rmSync(path.join(out, d), { recursive: true, force: true }); fs.mkdirSync(path.join(out, d), { recursive: true }) }
  const tmpRoot = fs.mkdtempSync(path.join(out, '.tmp-'))
  const t0 = Date.now()
  const secs = () => ((Date.now() - t0) / 1000).toFixed(0) + ' s'

  // Hilos de cálculo, cada uno con sus archivos temporales.
  const nw = Math.max(1, Number(opt.hilos))
  const workers = Array.from({ length: nw }, (_, k) => {
    const tmp = path.join(tmpRoot, `w${k}`); fs.mkdirSync(tmp)
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { tmp, maxPly } })
    return { w, busy: 0, waiters: [] }
  })
  workers.forEach((x) => x.w.on('message', () => { x.busy--; x.waiters.shift()?.() }))
  const send = async (batch) => {
    const x = workers.reduce((a, b) => (b.busy < a.busy ? b : a))
    if (x.busy >= 2) await new Promise((r) => x.waiters.push(r))
    x.busy++; x.w.postMessage(batch)
  }

  // Lectura del PGN por trozos.
  let nextId = 0, scanned = 0
  let heads = [], movs = []
  const players = fs.createWriteStream(path.join(tmpRoot, 'jugadores.txt'))
  let batch = []
  const writeChunk = () => {
    const n = Math.floor((nextId - 1) / CHUNK)
    fs.writeFileSync(path.join(out, 'cab', `${n}.json.gz`), zlib.gzipSync(JSON.stringify(heads)))
    fs.writeFileSync(path.join(out, 'mov', `${n}.json.gz`), zlib.gzipSync(JSON.stringify(movs)))
    heads = []; movs = []
  }
  const handle = async (text, name) => {
    scanned += (text.match(/^\[Event\s/gm) || []).length
    for (const g of parsePgnFile(text, name, keep)) {
      if (g.fen || !g.moves.length) continue // solo partidas desde la posición inicial
      const id = nextId++
      const elo = g.whiteElo && g.blackElo ? Math.round((g.whiteElo + g.blackElo) / 2) : 0
      heads.push([g.white, g.black, g.whiteElo || 0, g.blackElo || 0, g.result, g.date, g.event, g.eco, g.site, g.round])
      movs.push(g.moves.join(' '))
      if (heads.length === CHUNK) writeChunk()
      for (const p of [g.white, g.black]) if (p && p !== '?') players.write(`${playerPrefix(p)}\t${p}\t${id}\t${g.date}\n`)
      batch.push([id, g.result, elo, g.moves])
      if (batch.length >= 2000) { await send(batch); batch = [] }
    }
  }
  for (const f of files) {
    const fd = fs.openSync(f, 'r')
    const size = fs.fstatSync(fd).size
    const dec = new TextDecoder('utf-8')
    const piece = Buffer.alloc(8 << 20)
    let buf = '', pos = 0, lastLog = 0
    for (;;) {
      const n = fs.readSync(fd, piece, 0, piece.length, pos)
      if (!n) break
      pos += n
      buf += dec.decode(piece.subarray(0, n), { stream: pos < size })
      const cut = buf.lastIndexOf('\n[Event ')
      if (cut > 0) { await handle(buf.slice(0, cut), path.basename(f)); buf = buf.slice(cut + 1) }
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now()
        console.log(`${path.basename(f)}: ${Math.round((pos / size) * 100)} % · ${scanned.toLocaleString('es')} revisadas · ${nextId.toLocaleString('es')} guardadas · ${secs()}`)
      }
    }
    if (buf.trim()) await handle(buf, path.basename(f))
    fs.closeSync(fd)
  }
  if (batch.length) await send(batch)
  if (heads.length) writeChunk()
  await new Promise((r) => players.end(r))
  await Promise.all(workers.map((x) => new Promise((r) => { x.w.on('message', (m) => { if (m === 'fin') r() }); x.w.postMessage('fin') })))
  await Promise.all(workers.map((x) => x.w.terminate()))
  console.log(`Lectura terminada: ${nextId.toLocaleString('es')} partidas guardadas de ${scanned.toLocaleString('es')} · ${secs()}`)

  // Árbol de posiciones: cada archivo temporal se agrega en memoria y se reparte en sus trozos finales.
  let positions = 0
  for (let b = 0; b < BUCKETS; b++) {
    const shards = new Map()
    for (let k = 0; k < nw; k++) {
      const file = path.join(tmpRoot, `w${k}`, `b${b}.txt`)
      if (!fs.existsSync(file)) continue
      const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
      for await (const line of rl) {
        const [s, key, san, r, eloS, idS] = line.split('\t')
        let shard = shards.get(s); if (!shard) shards.set(s, (shard = new Map()))
        let p = shard.get(key); if (!p) shard.set(key, (p = { n: 0, moves: new Map(), top: [] }))
        p.n++
        let m = p.moves.get(san); if (!m) p.moves.set(san, (m = [san, 0, 0, 0, 0, 0, 0]))
        m[1]++
        if (r === 'w') m[2]++; else if (r === 'd') m[3]++; else if (r === 'l') m[4]++
        const elo = Number(eloS)
        if (elo) { m[5] += elo; m[6]++ }
        // Partidas destacadas: las de mayor Elo medio.
        const id = Number(idS)
        if (p.top.length < TOP_GAMES) p.top.push([elo, id])
        else {
          let lo = 0
          for (let i = 1; i < p.top.length; i++) if (p.top[i][0] < p.top[lo][0]) lo = i
          if (elo > p.top[lo][0]) p.top[lo] = [elo, id]
        }
      }
      fs.rmSync(file)
    }
    for (const [s, shard] of shards) {
      const obj = {}
      for (const [key, p] of shard) {
        if (p.n < minGames) continue
        // [san, partidas, blancas ganan, tablas, negras ganan, Elo medio]
        const moves = [...p.moves.values()].sort((a, c) => c[1] - a[1]).map((m) => [m[0], m[1], m[2], m[3], m[4], m[6] ? Math.round(m[5] / m[6]) : 0])
        obj[key] = [moves, p.top.sort((a, c) => c[0] - a[0]).map((t) => t[1])]
        positions++
      }
      fs.writeFileSync(path.join(out, 'pos', `${Number(s).toString(16).padStart(3, '0')}.json.gz`), zlib.gzipSync(JSON.stringify(obj)))
    }
    if (b % 32 === 31) console.log(`Árbol de posiciones: ${Math.round(((b + 1) / BUCKETS) * 100)} % · ${positions.toLocaleString('es')} posiciones · ${secs()}`)
  }

  // Índice de jugadores: nombre -> partidas, de la más reciente a la más antigua.
  const byPrefix = new Map()
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(tmpRoot, 'jugadores.txt')), crlfDelay: Infinity })
  let playerCount = 0
  const flushPlayers = () => {
    for (const [pre, names] of byPrefix) {
      const file = path.join(tmpRoot, `j-${pre}.txt`)
      fs.appendFileSync(file, [...names].map(([n, ids]) => ids.map(([id, d]) => `${n}\t${id}\t${d}\n`).join('')).join(''))
    }
    byPrefix.clear()
  }
  let lines = 0
  for await (const line of rl) {
    const [pre, name, id, date] = line.split('\t')
    let names = byPrefix.get(pre); if (!names) byPrefix.set(pre, (names = new Map()))
    let ids = names.get(name); if (!ids) names.set(name, (ids = []))
    ids.push([id, date])
    if (++lines % 2000000 === 0) flushPlayers()
  }
  flushPlayers()
  for (const f of fs.readdirSync(tmpRoot).filter((x) => x.startsWith('j-'))) {
    const names = new Map()
    for (const line of fs.readFileSync(path.join(tmpRoot, f), 'utf8').split('\n')) {
      if (!line) continue
      const [name, id, date] = line.split('\t')
      let ids = names.get(name); if (!ids) names.set(name, (ids = []))
      ids.push([Number(id), date])
    }
    const obj = {}
    for (const [name, ids] of names) {
      ids.sort((a, c) => (a[1] < c[1] ? 1 : a[1] > c[1] ? -1 : c[0] - a[0]))
      obj[name] = ids.map((x) => x[0])
      playerCount++
    }
    fs.writeFileSync(path.join(out, 'jug', `${f.slice(2, -4)}.json.gz`), zlib.gzipSync(JSON.stringify(obj)))
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })

  const manifest = {
    formato: 1,
    nombre: opt.nombre || path.basename(files[0]).replace(/\.pgn$/i, ''),
    partidas: nextId,
    posiciones: positions,
    jugadores: playerCount,
    maxJugadas: maxPly,
    minPartidas: minGames,
    trozo: CHUNK,
    creada: new Date().toISOString().slice(0, 10),
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0)
  const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0)
  console.log(`Listo en ${secs()}: ${positions.toLocaleString('es')} posiciones, ${playerCount.toLocaleString('es')} jugadores.`)
  console.log(`Tamaño: ${(size(out) / 1e6).toFixed(0)} MB en ${count(out).toLocaleString('es')} archivos (${out}).`)
}
