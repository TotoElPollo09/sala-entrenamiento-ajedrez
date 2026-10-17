// Stockfish 18 (versión lite, un hilo) en un Web Worker. Habla UCI.
const ENGINE_URL = new URL('../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url)

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.listeners = new Set()
    this.ready = new Promise((resolve) => {
      const onReady = (line) => {
        if (line === 'readyok') { this.listeners.delete(onReady); resolve() }
      }
      this.listeners.add(onReady)
    })
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data)
      this.listeners.forEach((fn) => fn(line))
    }
    this.send('uci')
    this.send('setoption name Hash value 32')
    this.send('isready')
    this.job = null
    this.ticket = 0
    this.queue = Promise.resolve()
  }

  send(cmd) { this.worker.postMessage(cmd) }

  // Detiene la búsqueda en curso (si la hay).
  stop() {
    if (this.job) this.send('stop')
    return this.queue
  }

  // Analiza una posición. onInfo recibe {depth, lines:[{multipv, score:{cp|mate}, pv:[uci...]}]} desde el punto de vista del bando que mueve.
  // Las peticiones se atienden de una en una; si llega otra antes de empezar, la anterior se descarta.
  analyze(fen, opts = {}) {
    const ticket = ++this.ticket
    if (this.job) this.send('stop')
    const run = async () => {
      await this.ready
      if (ticket !== this.ticket) return { superseded: true, bestmove: null, lines: [] }
      return this.#search(fen, opts)
    }
    const p = this.queue.then(run, run)
    this.queue = p.then(() => {}, () => {})
    return p
  }

  #search(fen, { depth = 18, multipv = 3, movetime = 0, onInfo } = {}) {
    const lines = new Map()
    return new Promise((resolve) => {
      const listener = (line) => {
        if (line.startsWith('info') && line.includes(' pv ')) {
          const info = parseInfo(line)
          if (!info) return
          lines.set(info.multipv, info)
          onInfo?.({ depth: info.depth, lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) })
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(listener)
          this.job = null
          resolve({ bestmove: line.split(' ')[1], lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) })
        }
      }
      this.listeners.add(listener)
      this.job = true
      this.send(`setoption name MultiPV value ${multipv}`)
      this.send(`position fen ${fen}`)
      this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`)
    })
  }
}

function parseInfo(line) {
  const t = line.split(' ')
  const get = (k) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : undefined }
  const depth = Number(get('depth'))
  const multipv = Number(get('multipv') || 1)
  const si = t.indexOf('score')
  if (si < 0) return null
  const score = t[si + 1] === 'mate' ? { mate: Number(t[si + 2]) } : { cp: Number(t[si + 2]) }
  if (t.includes('lowerbound') || t.includes('upperbound')) return null
  const pv = t.slice(t.indexOf('pv') + 1)
  return { depth, multipv, score, pv }
}

// Puntuación desde el punto de vista de las blancas, en peones (mate = ±100).
export function whitePov(score, fen) {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1
  if (score.mate != null) return sign * (score.mate > 0 ? 100 : -100)
  return (sign * score.cp) / 100
}

export function formatScore(score, fen) {
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1
  if (score.mate != null) {
    const m = sign * score.mate
    return (m > 0 ? '#' : '#-') + Math.abs(m)
  }
  const v = (sign * score.cp) / 100
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2)
}

let shared = null
export function sharedEngine() {
  if (!shared) shared = new Engine()
  return shared
}
