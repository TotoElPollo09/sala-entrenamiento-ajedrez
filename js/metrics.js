// Cálculos del dashboard a partir de las filas de la hoja.
const byDate = (a, b) => (a.Fecha < b.Fecha ? -1 : a.Fecha > b.Fecha ? 1 : 0)
const daysBack = (iso, n) => { const d = new Date(iso.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const points = (r) => (r.Resultado === 'Victoria' ? 1 : r.Resultado === 'Empate' ? 0.5 : 0)

// Último rating por modalidad y su cambio frente al último rating de hace 30 días o más.
export function ratingActual(ratings, jugador) {
  const out = {}
  const mine = ratings.filter((r) => r.Jugador === jugador && r.Rating != null && r.Fecha)
  for (const mod of new Set(mine.map((r) => r.Modalidad))) {
    const s = mine.filter((r) => r.Modalidad === mod).sort(byDate)
    const last = s[s.length - 1]
    const prev = s.filter((r) => r.Fecha <= daysBack(last.Fecha, 30)).pop() || s[0]
    out[mod] = { actual: last.Rating, fecha: last.Fecha, previo: prev.Rating, fechaPrevia: prev.Fecha, cambio: last.Rating - prev.Rating }
  }
  return out
}

export function ratingSeries(ratings, jugador, mod) {
  return ratings.filter((r) => r.Jugador === jugador && r.Modalidad === mod && r.Rating != null && r.Fecha)
    .sort(byDate).map((r) => ({ d: new Date(r.Fecha.slice(0, 10) + 'T00:00:00Z'), v: r.Rating }))
}

// Puzzle Storm: mejor puntuación diaria y media de 10 días. Se descartan días posteriores a su sincronización.
export function stormDiario(storm, jugador) {
  const s = storm.filter((r) => r.Jugador === jugador && r.Fecha && r['Mejor puntuación del día'] != null
    && (!r.Sincronizado || r.Fecha.slice(0, 10) <= r.Sincronizado.slice(0, 10))).sort(byDate)
  return s.map((r, i) => {
    const w = s.slice(Math.max(0, i - 9), i + 1).map((x) => x['Mejor puntuación del día'])
    return { Fecha: r.Fecha.slice(0, 10), d: new Date(r.Fecha.slice(0, 10) + 'T00:00:00Z'), puntuacion: r['Mejor puntuación del día'], media10: avg(w) }
  })
}

export function stormResumen(diario) {
  if (!diario.length) return null
  const ultima = diario[diario.length - 1].Fecha
  const c30 = daysBack(ultima, 30), c60 = daysBack(ultima, 60)
  const l30 = diario.filter((r) => r.Fecha > c30).map((r) => r.puntuacion)
  const p30 = diario.filter((r) => r.Fecha > c60 && r.Fecha <= c30).map((r) => r.puntuacion)
  return { record: Math.max(...diario.map((r) => r.puntuacion)), media30: avg(l30), mediaPrev30: avg(p30), dias30: l30.length }
}

export function puzzlesResumen(puzzles, jugador) {
  const s = puzzles.filter((r) => r.Jugador === jugador)
  if (!s.length) return null
  const ok = s.filter((r) => r.Resultado === 'Acertado').length
  return { total: s.length, acertados: ok, precision: ok / s.length }
}

const SKIP_TEMAS = new Set(['short', 'long', 'veryLong', 'oneMove', 'master', 'masterVsMaster', 'superGM', 'playerGames'])
export function puzzlesTema(puzzles, jugador, minIntentos = 10) {
  const acc = new Map()
  for (const r of puzzles.filter((x) => x.Jugador === jugador)) {
    for (const t of String(r.Temas || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      if (SKIP_TEMAS.has(t)) continue
      const e = acc.get(t) || { tema: t, intentos: 0, acertados: 0 }
      e.intentos += 1
      if (r.Resultado === 'Acertado') e.acertados += 1
      acc.set(t, e)
    }
  }
  return [...acc.values()].filter((e) => e.intentos >= minIntentos)
    .map((e) => ({ ...e, precision: e.acertados / e.intentos })).sort((a, b) => a.precision - b.precision)
}

const ORDER = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence']
export function partidasResumen(partidas, jugador) {
  const mine = partidas.filter((r) => r.Jugador === jugador)
  const mods = [...new Set(mine.map((r) => r.Modalidad))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  return [...mods, 'total'].map((m) => {
    const s = m === 'total' ? mine : mine.filter((r) => r.Modalidad === m)
    const v = s.filter((r) => r.Resultado === 'Victoria').length
    const e = s.filter((r) => r.Resultado === 'Empate').length
    const d = s.filter((r) => r.Resultado === 'Derrota').length
    return { Modalidad: m, partidas: s.length, victorias: v, empates: e, derrotas: d, puntos: s.length ? (v + e / 2) / s.length : null }
  })
}

export function porColor(partidas, jugador) {
  const out = {}
  for (const c of ['Blancas', 'Negras']) {
    const s = partidas.filter((r) => r.Jugador === jugador && r.Color === c)
    out[c] = s.length ? s.reduce((a, r) => a + points(r), 0) / s.length : null
  }
  return out
}

export function aperturas(partidas, jugador, min = 5) {
  const acc = new Map()
  for (const r of partidas.filter((x) => x.Jugador === jugador)) {
    const fam = String(r.Apertura || '?').split(':')[0].trim()
    const k = r.Color + '|' + fam
    const e = acc.get(k) || { Color: r.Color, Apertura: fam, ECO: r.ECO, partidas: 0, pts: 0, rival: 0 }
    e.partidas += 1; e.pts += points(r); e.rival += r['Rating rival'] || 0
    acc.set(k, e)
  }
  return [...acc.values()].filter((e) => e.partidas >= min)
    .map((e) => ({ ...e, puntos: e.pts / e.partidas, ratingRival: Math.round(e.rival / e.partidas) }))
}

// Rivales más frecuentes en tus partidas sincronizadas.
export function rivalesFrecuentes(partidas, jugador, top = 12) {
  const acc = new Map()
  for (const r of partidas.filter((x) => x.Jugador === jugador && x.Rival)) {
    const e = acc.get(r.Rival) || { Rival: r.Rival, partidas: 0, pts: 0, rating: r['Rating rival'] }
    e.partidas += 1; e.pts += points(r)
    acc.set(r.Rival, e)
  }
  return [...acc.values()].sort((a, b) => b.partidas - a.partidas).slice(0, top).map((e) => ({ ...e, puntos: e.pts / e.partidas }))
}
