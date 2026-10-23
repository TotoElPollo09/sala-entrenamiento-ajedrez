// Árbol de una partida con variantes, comentarios y signos (!, ?, …), y su lectura/escritura en PGN.
import { Chess, DEFAULT_POSITION } from '../vendor/chess.js'

export const NAGS = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' }
const NAG_OF = Object.fromEntries(Object.entries(NAGS).map(([k, v]) => [v, Number(k)]))

export class GameTree {
  constructor(startFen = DEFAULT_POSITION, headers = {}) {
    this.headers = headers
    this.nextId = 1
    this.root = { id: 0, fen: startFen, parent: null, children: [], comment: '', nags: [] }
    this.byId = new Map([[0, this.root]])
  }

  get standardStart() { return this.root.fen.split(' ').slice(0, 4).join(' ') === DEFAULT_POSITION.split(' ').slice(0, 4).join(' ') }

  // Juega una jugada (SAN u {from,to,promotion}) desde un nodo. Si ya existe, devuelve esa rama.
  play(parent, move) {
    const chess = new Chess(parent.fen)
    let m
    try { m = chess.move(typeof move === 'string' ? move.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O') : move) } catch { return null }
    const same = parent.children.find((c) => c.san === m.san)
    if (same) return same
    const node = { id: this.nextId++, san: m.san, from: m.from, to: m.to, color: m.color, fen: chess.fen(), parent, children: [], comment: '', nags: [] }
    parent.children.push(node)
    this.byId.set(node.id, node)
    return node
  }

  // Inserta una lista de jugadas SAN seguidas y devuelve el último nodo.
  playLine(from, sans) {
    let n = from
    for (const s of sans) { const next = this.play(n, s); if (!next) break; n = next }
    return n
  }

  path(node) {
    const out = []
    for (let n = node; n.parent; n = n.parent) out.unshift(n)
    return out
  }

  // Índices de hijo desde la raíz hasta el nodo (para recordar dónde estaba el tablero).
  address(node) { return this.path(node).map((n) => n.parent.children.indexOf(n)) }
  fromAddress(addr = []) {
    let n = this.root
    for (const i of addr) { if (!n.children[i]) break; n = n.children[i] }
    return n
  }

  mainEnd(node = this.root) { let n = node; while (n.children.length) n = n.children[0]; return n }
  sanLine(node) { return this.path(node).map((n) => n.san) }

  // Borra el nodo y todo lo que cuelga de él. Devuelve el padre.
  remove(node) {
    const p = node.parent
    if (!p) return node
    p.children.splice(p.children.indexOf(node), 1)
    const drop = (n) => { this.byId.delete(n.id); n.children.forEach(drop) }
    drop(node)
    return p
  }

  // Sube la variante que contiene el nodo un nivel (hasta ser la principal en su bifurcación).
  promote(node) {
    let n = node
    while (n.parent && n.parent.children[0] === n) n = n.parent
    if (!n.parent) return false
    const sib = n.parent.children
    const i = sib.indexOf(n)
    sib.splice(i, 1)
    sib.splice(i - 1, 0, n)
    return true
  }

  toggleNag(node, glyph) {
    const nag = NAG_OF[glyph]
    if (!nag || !node.parent) return
    // !, ?, !!, ??, !?, ?! se excluyen entre sí
    node.nags = node.nags.includes(nag) ? node.nags.filter((x) => x !== nag) : [...node.nags.filter((x) => x > 6), nag]
  }

  toPgn() {
    const h = { Event: '?', Site: '?', Date: '????.??.??', Round: '-', White: '?', Black: '?', Result: '*', ...this.headers }
    if (!this.standardStart) { h.SetUp = '1'; h.FEN = this.root.fen }
    const head = Object.entries(h).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `[${k} "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n')
    const body = moveText(this.root)
    return `${head}\n\n${wrap(`${body}${body ? ' ' : ''}${h.Result}`)}\n`
  }
}

const moveNo = (n) => Number(n.parent.fen.split(' ')[5]) || 1
const tok = (n, force) => (n.color === 'w' ? `${moveNo(n)}. ` : force ? `${moveNo(n)}... ` : '') + n.san + n.nags.map((x) => NAGS[x] ? NAGS[x] : ` $${x}`).join('')
const cmt = (n) => (n.comment ? ` {${n.comment.replace(/[{}]/g, '')}}` : '')

export function moveText(root) {
  const out = []
  if (root.comment) out.push(`{${root.comment.replace(/[{}]/g, '')}}`)
  const line = (start, force) => {
    let cur = start
    let f = force
    while (cur.children.length) {
      const [main, ...alts] = cur.children
      out.push(tok(main, f) + cmt(main))
      for (const v of alts) {
        out.push('(' + tok(v, true) + cmt(v))
        line(v, Boolean(v.comment))
        out[out.length - 1] += ')'
      }
      f = alts.length > 0 || Boolean(main.comment)
      cur = main
    }
  }
  line(root, true)
  return out.join(' ')
}

function wrap(text, width = 80) {
  const lines = []
  let cur = ''
  for (const w of text.split(' ')) {
    if (cur && cur.length + w.length + 1 > width) { lines.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines.join('\n')
}

// ---- Lectura de PGN con variantes ----

// Separa un texto con una o varias partidas.
export function splitPgn(text) {
  return text.replace(/\r/g, '').split(/\n(?=\s*\[Event\s)/).map((t) => t.trim()).filter(Boolean)
}

const TOKENS = /\{[^}]*\}|;[^\n]*|\$\d+|\(|\)|\d+\.(?:\.\.)?|\.\.\.|1-0|0-1|1\/2-1\/2|\*|[^\s(){};$]+/g

// Convierte un PGN (con variantes, comentarios y signos) en un GameTree. Lanza un error si no tiene ni una jugada válida.
export function parsePgn(text) {
  const headers = {}
  for (const m of text.matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2].replace(/\\(.)/g, '$1')
  const body = text.replace(/^\s*\[.*\]\s*$/gm, ' ')
  let start = DEFAULT_POSITION
  if (headers.FEN) { new Chess(headers.FEN); start = headers.FEN } // valida
  const tree = new GameTree(start, headers)
  delete tree.headers.FEN
  delete tree.headers.SetUp
  let cur = tree.root
  let last = null
  let bad = 0
  const stack = []
  for (const [t] of body.matchAll(TOKENS)) {
    if (t[0] === '{') { (last || tree.root).comment = [(last || tree.root).comment, t.slice(1, -1).trim()].filter(Boolean).join(' '); continue }
    if (t[0] === ';' || /^\d+\.(\.\.)?$/.test(t) || t === '...' || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue
    if (t[0] === '$') { if (last) last.nags.push(Number(t.slice(1))); continue }
    if (t === '(') { stack.push({ cur, last }); cur = last ? last.parent : cur; last = null; continue }
    if (t === ')') { const s = stack.pop(); if (s) ({ cur, last } = s); continue }
    if (bad) continue
    const m = t.match(/^(.*?)([!?]{1,2})?$/)
    const node = tree.play(cur, m[1])
    if (!node) { if (!stack.length) bad = 1; continue }
    if (m[2] && NAG_OF[m[2]] && !node.nags.includes(NAG_OF[m[2]])) node.nags.push(NAG_OF[m[2]])
    cur = node
    last = node
  }
  if (!tree.root.children.length && !headers.FEN) throw new Error('No se encontró ninguna jugada válida.')
  return tree
}

// Árbol a partir de una partida guardada en la base local ({white, black, moves:[SAN], fen, …}).
export function treeFromGame(g) {
  const tree = new GameTree(g.fen || DEFAULT_POSITION, {
    Event: g.event || '?', Site: g.site || g.url || '?', Date: (g.date || '????.??.??').replace(/-/g, '.'), Round: g.round || '-',
    White: g.white || '?', Black: g.black || '?', Result: (g.result || '*').replace('½-½', '1/2-1/2'),
    ...(g.whiteElo ? { WhiteElo: String(g.whiteElo) } : {}), ...(g.blackElo ? { BlackElo: String(g.blackElo) } : {}),
    ...(g.eco ? { ECO: g.eco } : {}), ...(g.opening ? { Opening: g.opening } : {}),
  })
  tree.playLine(tree.root, g.moves || [])
  return tree
}
