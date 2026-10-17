// Ajustes del usuario, guardados en este navegador.
const KEY = 'ajedrez-web:ajustes'

const DEFAULTS = {
  players: [
    { name: 'Johan', lichess: 'totoelpollo', puzzleToken: '' },
    { name: 'Mari', lichess: 'genio3015', puzzleToken: '' },
  ],
  historyFrom: '2026-01-01', // partidas que se descargan para el dashboard
  lichessToken: '',
  engineDepth: 18,
  engineLines: 3,
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    // Ajustes guardados antes de leer de Lichess pueden tener el usuario vacío: se rellena con el de siempre.
    const players = (saved.players || DEFAULTS.players).map((p, i) => ({ ...DEFAULTS.players[i], ...p, lichess: p.lichess || DEFAULTS.players[i]?.lichess || '' }))
    delete saved.sheetId
    return { ...structuredClone(DEFAULTS), ...saved, players }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Sin almacenamiento (ventana privada): los ajustes duran hasta cerrar la pestaña.
  }
}

export const settings = loadSettings()

const listeners = new Set()
export function onSettingsChange(fn) { listeners.add(fn) }
export function updateSettings(patch) {
  Object.assign(settings, patch)
  saveSettings(settings)
  listeners.forEach((fn) => fn(settings))
}

// Pequeño bus de eventos entre páginas (por ejemplo, "abrir esta partida en Análisis").
const bus = new EventTarget()
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })) }
export function on(name, fn) { bus.addEventListener(name, (e) => fn(e.detail)) }
