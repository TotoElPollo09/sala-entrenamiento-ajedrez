// Flechas y casillas marcadas con el botón derecho, como en chess.com.
// Clic derecho en una casilla la marca; arrastrar con el botón derecho dibuja una flecha.
// El color depende de la tecla pulsada: normal naranja, Ctrl rojo, Alt azul, Mayús verde.
// Repetir la misma flecha o casilla con el mismo color la borra; un clic izquierdo en el tablero borra todo.

const COLORS = ['orange', 'red', 'blue', 'green']
const ARROW = Object.fromEntries(COLORS.map((c) => [c, { class: `arrow-user arrow-user-${c}` }]))
const MARK = Object.fromEntries(COLORS.map((c) => [c, { class: `marker-user marker-user-${c}`, slice: 'markerSquare' }]))
const ARROW_TYPES = new Set(Object.values(ARROW))
const MARK_TYPES = new Set(Object.values(MARK))
const PREVIEW = { class: 'arrow-user arrow-user-preview' }

const colorFor = (e) => {
  if (e.ctrlKey || e.metaKey) return 'red'
  if (e.altKey) return 'blue'
  if (e.shiftKey) return 'green'
  return 'orange'
}

const squareAt = (e) => e.target?.closest?.('[data-square]')?.getAttribute('data-square')

// Evita que soltar Alt tras dibujar active la barra de menús del navegador (Windows/Firefox).
let altUsed = false
document.addEventListener('keyup', (e) => {
  if (e.key === 'Alt' && altUsed) { e.preventDefault(); altUsed = false }
})

export function enableAnnotations(chessboard) {
  const el = chessboard.context
  let start = null // casilla donde se pulsó el botón derecho
  let previewTo = null

  const clearPreview = () => {
    if (previewTo) chessboard.removeArrows(PREVIEW)
    previewTo = null
  }

  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !e.ctrlKey) { clear(chessboard); return }
    if (e.button !== 2) return
    start = squareAt(e) || null
  })
  el.addEventListener('mousemove', (e) => {
    if (!start) return
    const to = squareAt(e)
    if (!to || to === start) { clearPreview(); return }
    if (to === previewTo) return
    clearPreview()
    previewTo = to
    PREVIEW.class = `arrow-user arrow-user-preview ${ARROW[colorFor(e)].class}`
    chessboard.addArrow(PREVIEW, start, to)
  })
  el.addEventListener('mouseleave', () => { clearPreview(); start = null })
  el.addEventListener('mouseup', (e) => {
    if (e.button !== 2 || !start) return
    clearPreview()
    const from = start
    start = null
    const to = squareAt(e) || from
    const color = colorFor(e)
    if (e.altKey) altUsed = true
    if (to !== from) toggleArrow(chessboard, ARROW[color], from, to)
    else toggleMark(chessboard, MARK[color], from)
  })
}

function toggleArrow(chessboard, type, from, to) {
  const same = chessboard.getArrows(type, from, to).length > 0
  for (const t of ARROW_TYPES) chessboard.removeArrows(t, from, to)
  if (!same) chessboard.addArrow(type, from, to)
}

function toggleMark(chessboard, type, square) {
  const same = chessboard.getMarkers(type, square).length > 0
  for (const t of MARK_TYPES) chessboard.removeMarkers(t, square)
  if (!same) chessboard.addMarker(type, square)
}

// Borra solo lo dibujado a mano (no las flechas del motor ni la última jugada).
export function clear(chessboard) {
  const arrows = chessboard.getArrows().filter((a) => ARROW_TYPES.has(a.type))
  const marks = chessboard.getMarkers().filter((m) => MARK_TYPES.has(m.type))
  if (!arrows.length && !marks.length) return
  for (const t of ARROW_TYPES) chessboard.removeArrows(t)
  for (const t of MARK_TYPES) chessboard.removeMarkers(t)
}

// Sustituye las flechas del programa (motor, sugerencias) sin tocar las dibujadas a mano.
export function setProgramArrows(chessboard, list, fallbackType) {
  for (const a of chessboard.getArrows()) {
    if (!ARROW_TYPES.has(a.type) && a.type !== PREVIEW) chessboard.removeArrows(a.type, a.from, a.to)
  }
  for (const a of list) chessboard.addArrow(a.type || fallbackType, a.from, a.to)
}
