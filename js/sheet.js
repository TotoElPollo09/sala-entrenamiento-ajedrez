// Lee las pestañas AUTO-* de la hoja de Google de entrenamiento.
// La hoja tiene que estar compartida como "Cualquier persona con el enlace: lector".
import { settings } from './store.js'

export const TABS = {
  ratings: 'AUTO - Ratings',
  partidas: 'AUTO - Partidas',
  puzzles: 'AUTO - Puzzles',
  storm: 'AUTO - Puzzle Storm',
}

const NUMERIC = new Set(['Rating', 'Rating rival', 'Mi rating', 'Variación', 'Rating después', 'Movimientos', 'Rating puzzle',
  'Mejor puntuación del día', 'Sesiones del día', 'Errores', 'Jugadas', 'Combo', 'Duración (s)', 'Rating más alto', 'Récord histórico'])
const DATES = new Set(['Fecha', 'Fecha y hora', 'Sincronizado'])

// dd/mm/yyyy [hh:mm] -> yyyy-mm-dd[Thh:mm]
export function isoDate(s) {
  const t = String(s ?? '').trim()
  if (!t) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(t)
  if (m) {
    const p = (n) => String(n).padStart(2, '0')
    return `${m[3]}-${p(m[2])}-${p(m[1])}` + (m[4] ? `T${p(m[4])}:${m[5]}` : '')
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.replace(' ', 'T').slice(0, 16)
  return t
}

export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export function tableToRows(values) {
  const [head, ...body] = values
  return body
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => {
      const v = r[i] ?? ''
      if (NUMERIC.has(h)) return [h, v === '' ? null : Number(String(v).replace(',', '.'))]
      if (DATES.has(h)) return [h, isoDate(v)]
      return [h, v]
    })))
}

export async function loadTab(tab) {
  if (!settings.sheetId) throw new Error('Pega el enlace de tu hoja de Google en Ajustes para ver el dashboard.')
  const url = `https://docs.google.com/spreadsheets/d/${settings.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`
  let res
  try {
    res = await fetch(url)
  } catch {
    throw new Error('No se pudo leer la hoja de Google. Compártela como "Cualquier persona con el enlace: lector".')
  }
  const text = await res.text()
  if (!res.ok || text.trimStart().startsWith('<')) {
    throw new Error('La hoja de Google no es pública. Compártela como "Cualquier persona con el enlace: lector" o revisa su ID en Ajustes.')
  }
  return tableToRows(parseCsv(text))
}

export async function loadAll() {
  const entries = await Promise.all(Object.entries(TABS).map(async ([k, tab]) => [k, await loadTab(tab)]))
  return Object.fromEntries(entries)
}
