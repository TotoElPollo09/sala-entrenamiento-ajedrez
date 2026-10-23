// Ajustes del usuario, guardados en este navegador.
const KEY = 'ajedrez-web:ajustes'

const DEFAULTS = {
  sheetId: '', // se escribe en Ajustes; no se guarda en el código
  players: [
    { name: 'Johan', lichess: 'totoelpollo' },
    { name: 'Mari', lichess: 'genio3015' },
  ],
  lichessToken: '',
  bigBaseUrl: '', // dirección de la base grande; vacío = carpeta base/ de la propia web
  bigBaseKeyId: '', // clave de solo lectura si la base es privada (Cloudflare R2)
  bigBaseSecret: '',
  engineDepth: 18,
  engineLines: 3,
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    // Si el usuario de Lichess quedó vacío en unos ajustes viejos, se usa el de siempre.
    const players = (saved.players || DEFAULTS.players).map((p, i) => ({ ...p, lichess: p.lichess || DEFAULTS.players[i]?.lichess || '' }))
    return { ...DEFAULTS, ...saved, players }
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
