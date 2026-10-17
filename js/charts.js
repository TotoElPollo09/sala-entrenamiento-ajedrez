// Gráficos con d3 (global). Colores desde variables CSS para que sigan el tema.
/* global d3 */
export const es = d3.timeFormatLocale({
  dateTime: '%A, %e de %B de %Y, %X', date: '%d/%m/%Y', time: '%H:%M:%S', periods: ['AM', 'PM'],
  days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  shortDays: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  shortMonths: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
})
export const fMonth = es.utcFormat('%b %Y')
export const fDay = es.utcFormat('%-d %b %Y')

// series: [{name, color, points:[{d: Date|number, v}], dots?, endLabel?}]
export function lineChart(box, series, { height = 280, yFmt = d3.format('d'), yZero = false, xKind = 'date', xFmt, yDomain, onClick } = {}) {
  box.replaceChildren()
  const all = series.flatMap((s) => s.points)
  if (!all.length) { box.innerHTML = '<p class="muted small">Sin datos para este gráfico.</p>'; return }
  const W = Math.max(260, box.clientWidth)
  const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', height).attr('viewBox', `0 0 ${W} ${height}`)
  const ext = yDomain || d3.extent(all, (p) => p.v)
  const y = d3.scaleLinear(yZero ? [0, ext[1]] : ext, [height - 28, 12])
  if (!yDomain) y.nice(5)
  const yt = y.ticks(5)
  const meas = svg.append('text').attr('class', 'tick')
  let yw = 0
  yt.forEach((t) => { meas.text(yFmt(t)); yw = Math.max(yw, meas.node().getComputedTextLength()) })
  meas.attr('class', 'end-label')
  const labelled = series.filter((s) => s.endLabel !== false && s.points.length)
  const endText = (s) => `${s.name} ${yFmt(s.points[s.points.length - 1].v)}`
  let ew = 0
  labelled.forEach((s) => { meas.text(endText(s)); ew = Math.max(ew, meas.node().getComputedTextLength()) })
  meas.remove()
  const m = { l: yw + 10, r: ew ? ew + 14 : 12, t: 12, b: 28 }
  if (W - m.l - m.r < 160) m.r = 12
  const showEnd = m.r > 12
  const x = xKind === 'date' ? d3.scaleUtc(d3.extent(all, (p) => p.d), [m.l, W - m.r]) : d3.scaleLinear(d3.extent(all, (p) => p.d), [m.l, W - m.r])
  y.range([height - m.b, m.t])

  svg.append('g').selectAll('line').data(yt).join('line')
    .attr('x1', m.l).attr('x2', W - m.r).attr('y1', (t) => y(t)).attr('y2', (t) => y(t)).attr('class', 'grid')
  svg.append('g').selectAll('text').data(yt).join('text').attr('class', 'tick')
    .attr('x', m.l - 8).attr('y', (t) => y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').text((t) => yFmt(t))
  const axis = d3.axisBottom(x).ticks(Math.max(2, Math.floor((W - m.l - m.r) / 95))).tickSizeOuter(0)
  axis.tickFormat(xFmt || (xKind === 'date' ? fMonth : d3.format('d')))
  const xa = svg.append('g').attr('transform', `translate(0,${height - m.b})`).call(axis).attr('font-size', null).attr('font-family', null)
  xa.select('.domain').attr('class', 'domain axis')
  xa.selectAll('.tick line').attr('class', 'axis')
  xa.selectAll('.tick text').attr('class', 'tick')

  const line = d3.line().x((p) => x(p.d)).y((p) => y(p.v))
  for (const s of series) {
    if (s.dots) {
      svg.append('g').selectAll('circle').data(s.points).join('circle')
        .attr('cx', (p) => x(p.d)).attr('cy', (p) => y(p.v)).attr('r', 2.5).style('fill', s.color).attr('fill-opacity', 0.45)
    } else {
      if (s.area) {
        const area = d3.area().x((p) => x(p.d)).y0(y(0)).y1((p) => y(p.v))
        svg.append('path').datum(s.points).attr('d', area).style('fill', s.color).attr('fill-opacity', 0.15)
      }
      svg.append('path').datum(s.points).attr('d', line).attr('fill', 'none').style('stroke', s.color)
        .attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      if (s.points.length === 1) svg.append('circle').attr('cx', x(s.points[0].d)).attr('cy', y(s.points[0].v)).attr('r', 3.5).style('fill', s.color)
    }
  }
  if (showEnd) {
    const labs = labelled.map((s) => ({ s, y: y(s.points[s.points.length - 1].v) })).sort((a, b) => a.y - b.y)
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 15) labs[i].y = labs[i - 1].y + 15
    const over = labs.length ? labs[labs.length - 1].y - (height - m.b) : 0
    if (over > 0) labs.forEach((l) => { l.y -= over })
    svg.append('g').selectAll('text').data(labs).join('text').attr('class', 'end-label')
      .attr('x', W - m.r + 8).attr('y', (l) => l.y).attr('dy', '0.32em').style('fill', (l) => l.s.color).text((l) => endText(l.s))
  }

  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; box.appendChild(tip)
  const focus = svg.append('g').style('display', 'none')
  const rule = focus.append('line').attr('y1', m.t).attr('y2', height - m.b).attr('class', 'ref')
  const dots = focus.selectAll('circle').data(series).join('circle').attr('r', 4).style('fill', (s) => s.color).attr('class', 'focus-dot')
  const xs = [...new Set(all.map((p) => +p.d))].sort((a, b) => a - b)
  const bis = d3.bisector((p) => +p.d).right
  const nearest = (event) => {
    const [mx] = d3.pointer(event)
    const t = +x.invert(mx)
    return xs[d3.leastIndex(xs, (a, b) => Math.abs(a - t) - Math.abs(b - t))]
  }
  svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', Math.max(0, W - m.l - m.r)).attr('height', height - m.t - m.b)
    .attr('fill', 'transparent').style('cursor', onClick ? 'pointer' : 'default')
    .on('click', (event) => onClick?.(nearest(event)))
    .on('pointerleave', () => { focus.style('display', 'none'); tip.hidden = true })
    .on('pointermove', (event) => {
      const at = nearest(event)
      const vals = series.map((s) => { const i = bis(s.points, at) - 1; return i >= 0 ? s.points[i] : null })
      focus.style('display', null)
      rule.attr('x1', x(at)).attr('x2', x(at))
      dots.attr('cx', (s, i) => (vals[i] ? x(vals[i].d) : -99)).attr('cy', (s, i) => (vals[i] ? y(vals[i].v) : -99))
      tip.replaceChildren()
      const hd = document.createElement('div'); hd.className = 'tip-head'
      hd.textContent = xKind === 'date' ? fDay(new Date(at)) : (xFmt ? xFmt(at) : String(at))
      tip.appendChild(hd)
      series.forEach((s, i) => {
        if (!vals[i]) return
        const row = document.createElement('div')
        if (series.length > 1) { const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = s.color; row.appendChild(sw) }
        row.appendChild(document.createTextNode(`${s.name}: ${yFmt(vals[i].v)}`))
        tip.appendChild(row)
      })
      tip.hidden = false
      const bw = box.clientWidth, tw = tip.offsetWidth
      let left = (x(at) / W) * bw + 12
      if (left + tw > bw) left = (x(at) / W) * bw - tw - 12
      tip.style.left = Math.max(0, left) + 'px'
      tip.style.top = m.t + 'px'
    })
}

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)']
