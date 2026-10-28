// Liga por puntos: suma puntos de entrenamiento por semana o por mes a partir de las filas de la hoja.
export const DESDE = '2026-01-01'

export const REGLAS = {
  victoria: 3, empate: 1, sorpresa: 1, partidasDia: 10, // partidas puntuables, máximo 10 al día
  puzzle: 1, puzzlesDia: 30, // puzzles acertados, máximo 30 al día
  stormDiv: 10, stormRecord: 5, // 1 punto por cada 10 del mejor Storm del día; récord personal +5
  ratingDiv: 10, // 1 punto por cada 10 de rating ganados en una modalidad
  dia: 2, // cada día con algo de entrenamiento
}

// Peso de cada modalidad en partidas y en subida de rating: rápidas pesa más, luego blitz y luego bullet.
export const PESO = { classical: 3, rapid: 3, blitz: 2, bullet: 1 }
const peso = (mod) => PESO[mod] ?? 1

export const CATS = [
  { id: 'partidas', name: 'Partidas' },
  { id: 'puzzles', name: 'Puzzles' },
  { id: 'storm', name: 'Storm' },
  { id: 'rating', name: 'Rating' },
  { id: 'constancia', name: 'Constancia' },
]

const day = (s) => (s ? String(s).slice(0, 10) : null)
const utc = (d) => new Date(d + 'T00:00:00Z')
const iso = (dt) => dt.toISOString().slice(0, 10)
const addDays = (d, n) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return iso(x) }

export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

// Periodo (semana de lunes a domingo, o mes natural) que contiene la fecha.
export function periodOf(d, kind) {
  if (kind === 'mes') {
    const start = d.slice(0, 8) + '01'
    const n = utc(start); n.setUTCMonth(n.getUTCMonth() + 1)
    return { kind, start, end: addDays(iso(n), -1) }
  }
  const wd = (utc(d).getUTCDay() + 6) % 7
  const start = addDays(d, -wd)
  return { kind, start, end: addDays(start, 6) }
}

export const prevPeriod = (p) => periodOf(addDays(p.start, -1), p.kind)

// Periodos desde el 1 de enero de 2026 hasta hoy, del más reciente al más antiguo.
export function periodsUntil(today, kind) {
  const out = []
  for (let p = periodOf(today, kind); p.end >= DESDE; p = prevPeriod(p)) out.push(p.start < DESDE ? { ...p, start: DESDE } : p)
  return out
}

// Puntos de cada jugador en un periodo. hoy limita fechas futuras (filas con fecha errónea).
export function scorePeriod(data, players, period, hoy) {
  const { start, end } = period
  const lim = end < hoy ? end : hoy
  const inP = (d) => d && d >= start && d <= lim
  // Los puzzles solo cuentan si la hoja tiene puzzles de todos; si no, sería injusto.
  const conPuzzles = new Set((data.puzzles || []).map((r) => r.Jugador))
  const puzzlesOn = players.length > 0 && players.every((p) => conPuzzles.has(p))

  const rows = players.map((jugador) => {
    const pts = { partidas: 0, puzzles: 0, storm: 0, rating: 0, constancia: 0 }
    const det = { victorias: 0, empates: 0, derrotas: 0, sorpresas: 0, puzzles: 0, stormDias: 0, stormMejor: null, records: 0, ratingGanado: {}, dias: 0 }
    const activos = new Set()

    // Partidas puntuables
    const porDia = new Map()
    const partidas = (data.partidas || []).filter((r) => r.Jugador === jugador && inP(day(r.Fecha)) && r.Puntuable !== 'No')
      .sort((a, b) => (a.Fecha < b.Fecha ? -1 : 1))
    for (const r of partidas) {
      const d = day(r.Fecha)
      activos.add(d)
      const n = (porDia.get(d) || 0) + 1
      porDia.set(d, n)
      if (n > REGLAS.partidasDia) continue
      const w = peso(r.Modalidad)
      if (r.Resultado === 'Victoria') {
        det.victorias++; pts.partidas += REGLAS.victoria * w
        if (r['Rating rival'] != null && r['Mi rating'] != null && r['Rating rival'] > r['Mi rating']) { det.sorpresas++; pts.partidas += REGLAS.sorpresa * w }
      } else if (r.Resultado === 'Empate') { det.empates++; pts.partidas += REGLAS.empate * w } else if (r.Resultado === 'Derrota') det.derrotas++
    }

    // Puzzles acertados
    const pzDia = new Map()
    for (const r of (data.puzzles || []).filter((x) => x.Jugador === jugador && inP(day(x['Fecha y hora'])))) {
      const d = day(r['Fecha y hora'])
      activos.add(d)
      if (r.Resultado !== 'Acertado') continue
      const n = (pzDia.get(d) || 0) + 1
      pzDia.set(d, n)
      if (n > REGLAS.puzzlesDia) continue
      det.puzzles++
      if (puzzlesOn) pts.puzzles += REGLAS.puzzle
    }

    // Puzzle Storm: mejor del día y récords personales (el récord se mide con todo el historial anterior)
    const storm = (data.storm || []).filter((r) => r.Jugador === jugador && day(r.Fecha) && day(r.Fecha) <= hoy && r['Mejor puntuación del día'] != null)
      .sort((a, b) => (a.Fecha < b.Fecha ? -1 : 1))
    let record = null
    for (const r of storm) {
      const d = day(r.Fecha), v = r['Mejor puntuación del día']
      if (inP(d)) {
        activos.add(d)
        det.stormDias++
        det.stormMejor = Math.max(det.stormMejor ?? 0, v)
        pts.storm += Math.floor(v / REGLAS.stormDiv)
        if (record != null && v > record) { det.records++; pts.storm += REGLAS.stormRecord }
      }
      record = Math.max(record ?? v, v)
    }

    // Rating: subida neta en cada modalidad frente al último rating antes del periodo
    const ratings = (data.ratings || []).filter((r) => r.Jugador === jugador && r.Rating != null && day(r.Fecha))
    for (const mod of new Set(ratings.map((r) => r.Modalidad))) {
      const s = ratings.filter((r) => r.Modalidad === mod).sort((a, b) => (a.Fecha < b.Fecha ? -1 : 1))
      const dentro = s.filter((r) => inP(day(r.Fecha)))
      if (!dentro.length) continue
      const antes = s.filter((r) => day(r.Fecha) < start).pop() || dentro[0]
      const g = dentro[dentro.length - 1].Rating - antes.Rating
      det.ratingGanado[mod] = g
      if (g > 0) pts.rating += Math.floor(g / REGLAS.ratingDiv) * peso(mod)
    }

    det.dias = activos.size
    pts.constancia = activos.size * REGLAS.dia
    const total = Object.values(pts).reduce((a, b) => a + b, 0)
    return { jugador, pts, det, total }
  })

  rows.sort((a, b) => b.total - a.total || a.jugador.localeCompare(b.jugador))
  rows.forEach((r, i) => { r.puesto = i && rows[i - 1].total === r.total ? rows[i - 1].puesto : i + 1 })
  return { period, rows, puzzlesOn }
}

// Clasificación de cada periodo cerrado o en curso y cuántos ganó cada jugador.
export function historial(data, players, kind, hoy) {
  const periods = periodsUntil(hoy, kind)
  const tablas = periods.map((p) => scorePeriod(data, players, p, hoy))
  const titulos = Object.fromEntries(players.map((p) => [p, 0]))
  for (const t of tablas) {
    if (t.period.end >= hoy) continue // el periodo en curso aún no se gana
    const top = t.rows.filter((r) => r.puesto === 1 && r.total > 0)
    if (top.length === 1) titulos[top[0].jugador]++
  }
  return { tablas, titulos }
}
