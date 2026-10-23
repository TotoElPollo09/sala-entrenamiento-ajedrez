// Paneles acoplables, como en ChessMonitor Studio: cada panel es una pestaña que se arrastra a otro grupo
// (se añade como pestaña) o al borde de un grupo (lo divide). Los divisores entre grupos cambian el tamaño.
// El diseño es un árbol: {t:'row'|'col', s:[tamaños], c:[hijos]} o un grupo {t:'stack', p:[ids], a:idActivo}.

const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d }
const sum = (a) => a.reduce((x, y) => x + y, 0)
const clone = (x) => JSON.parse(JSON.stringify(x))

export class Dock {
  // panels: {id: {title, icon (svg), el, closable}}
  constructor(el, { panels, layout, defaultLayout, onChange }) {
    this.el = el
    this.panels = panels
    this.defaultLayout = defaultLayout
    this.onChange = onChange
    this.holder = div('dk-holder')
    this.holder.hidden = true
    this.area = div('dk-root')
    el.append(this.area, this.holder)
    this.layout = this.#valid(layout) ? clone(layout) : clone(defaultLayout)
    this.ghost = null
    this.drop = div('dk-drop')
    this.drop.hidden = true
    document.body.appendChild(this.drop)
    this.render()
  }

  // ---- consultas ----

  ids(node = this.layout, out = []) {
    if (!node) return out
    if (node.t === 'stack') out.push(...node.p)
    else node.c.forEach((c) => this.ids(c, out))
    return out
  }
  isOpen(id) { return this.ids().includes(id) }
  isShown(id) { const s = this.#stackOf(id); return Boolean(s && s.a === id) }
  closed() { return Object.keys(this.panels).filter((id) => !this.isOpen(id)) }

  #valid(l) {
    try {
      const ids = this.ids(l)
      return ids.length > 0 && ids.every((id) => this.panels[id]) && new Set(ids).size === ids.length && ids.includes('board')
    } catch { return false }
  }

  #stackOf(id, node = this.layout) {
    if (!node) return null
    if (node.t === 'stack') return node.p.includes(id) ? node : null
    for (const c of node.c) { const r = this.#stackOf(id, c); if (r) return r }
    return null
  }

  #parentOf(target, node = this.layout) {
    if (!node || node.t === 'stack') return null
    const i = node.c.indexOf(target)
    if (i >= 0) return { parent: node, index: i }
    for (const c of node.c) { const r = this.#parentOf(target, c); if (r) return r }
    return null
  }

  // ---- cambios ----

  activate(id) {
    const s = this.#stackOf(id)
    if (!s || s.a === id) return
    s.a = id
    this.render()
    this.#changed()
  }

  close(id) {
    const s = this.#stackOf(id)
    if (!s || this.panels[id].closable === false) return
    s.p.splice(s.p.indexOf(id), 1)
    if (s.a === id) s.a = s.p[0]
    this.#commit()
  }

  // Vuelve a abrir un panel cerrado: como pestaña del grupo más grande que no tenga el tablero.
  open(id) {
    if (this.isOpen(id) || !this.panels[id]) return
    const stacks = []
    const walk = (n, w) => { if (n.t === 'stack') stacks.push({ n, w }); else n.c.forEach((c, i) => walk(c, w * n.s[i] / sum(n.s))) }
    walk(this.layout, 1)
    const t = stacks.filter((x) => !x.n.p.includes('board')).sort((a, b) => b.w - a.w)[0]
    if (t) { t.n.p.push(id); t.n.a = id } else this.#insertBeside(this.#stackOf('board'), { t: 'stack', p: [id], a: id }, 'right')
    this.#commit()
  }

  reset() { this.layout = clone(this.defaultLayout); this.render(); this.#changed() }

  move(id, target, zone) {
    const src = this.#stackOf(id)
    if (!src || !target) return
    if (src === target && (zone === 'center' || src.p.length === 1)) { this.activate(id); return }
    src.p.splice(src.p.indexOf(id), 1)
    if (src.a === id) src.a = src.p[0]
    if (zone === 'center') { target.p.push(id); target.a = id } else this.#insertBeside(target, { t: 'stack', p: [id], a: id }, zone)
    this.#commit()
  }

  #insertBeside(target, node, zone) {
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
    const before = zone === 'left' || zone === 'top'
    const pi = this.#parentOf(target)
    if (pi && pi.parent.t === dir) {
      const half = pi.parent.s[pi.index] / 2
      pi.parent.s[pi.index] = half
      pi.parent.c.splice(pi.index + (before ? 0 : 1), 0, node)
      pi.parent.s.splice(pi.index + (before ? 0 : 1), 0, half)
      return
    }
    const wrap = { t: dir, s: [50, 50], c: before ? [node, target] : [target, node] }
    if (pi) pi.parent.c[pi.index] = wrap
    else this.layout = wrap
  }

  // Quita grupos vacíos, divisiones de un solo hijo y une divisiones seguidas en la misma dirección.
  #norm(n) {
    if (n.t === 'stack') { if (!n.p.includes(n.a)) n.a = n.p[0]; return n.p.length ? n : null }
    const c = [], s = []
    n.c.forEach((ch, i) => {
      const x = this.#norm(ch)
      if (!x) return
      if (x.t === n.t) { const tot = sum(x.s); x.c.forEach((cc, j) => { c.push(cc); s.push((n.s[i] * x.s[j]) / tot) }) } else { c.push(x); s.push(n.s[i]) }
    })
    if (!c.length) return null
    if (c.length === 1) return c[0]
    n.c = c; n.s = s
    return n
  }

  #commit() {
    this.layout = this.#norm(this.layout) || clone(this.defaultLayout)
    this.render()
    this.#changed()
  }

  #changed() { this.onChange?.(this.toJSON()) }
  toJSON() { return clone(this.layout) }

  // ---- dibujo ----

  render() {
    for (const p of Object.values(this.panels)) this.holder.appendChild(p.el)
    this.area.replaceChildren(this.#build(this.layout))
  }

  #build(node) {
    if (node.t === 'stack') {
      const st = div('dk-stack')
      st.dkNode = node
      const head = div('dk-head')
      head.setAttribute('role', 'tablist')
      for (const id of node.p) {
        const p = this.panels[id]
        const tab = div('dk-tab')
        tab.setAttribute('role', 'tab')
        tab.setAttribute('aria-selected', String(id === node.a))
        tab.dataset.id = id
        tab.title = `${p.title} · arrastra para moverla`
        tab.innerHTML = `${p.icon || ''}<span></span>`
        tab.querySelector('span').textContent = p.title
        if (p.closable !== false) {
          const x = document.createElement('button')
          x.type = 'button'; x.className = 'dk-x'; x.textContent = '×'; x.setAttribute('aria-label', `Cerrar ${p.title}`)
          x.addEventListener('click', (e) => { e.stopPropagation(); this.close(id) })
          tab.appendChild(x)
        }
        tab.addEventListener('pointerdown', (e) => this.#tabDown(e, id))
        head.appendChild(tab)
      }
      const body = div('dk-body')
      body.dataset.panel = node.a
      body.appendChild(this.panels[node.a].el)
      st.append(head, body)
      return st
    }
    const sp = div(`dk-split dk-${node.t}`)
    node.c.forEach((ch, i) => {
      if (i) sp.appendChild(this.#splitter(node, i, sp))
      const e = this.#build(ch)
      e.style.flex = `${node.s[i]} 1 0`
      sp.appendChild(e)
    })
    return sp
  }

  #splitter(node, i, sp) {
    const g = div('dk-gutter')
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      g.setPointerCapture(e.pointerId)
      const kids = [...sp.children].filter((x) => !x.classList.contains('dk-gutter'))
      const a = kids[i - 1], b = kids[i]
      const horiz = node.t === 'row'
      const pa = horiz ? a.offsetWidth : a.offsetHeight
      const pb = horiz ? b.offsetWidth : b.offsetHeight
      const tot = node.s[i - 1] + node.s[i]
      const start = horiz ? e.clientX : e.clientY
      g.classList.add('on')
      const mv = (ev) => {
        const d = (horiz ? ev.clientX : ev.clientY) - start
        const na = Math.max(80, Math.min(pa + pb - 80, pa + d))
        node.s[i - 1] = (tot * na) / (pa + pb)
        node.s[i] = tot - node.s[i - 1]
        a.style.flex = `${node.s[i - 1]} 1 0`
        b.style.flex = `${node.s[i]} 1 0`
      }
      const up = () => { g.classList.remove('on'); g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); this.#changed() }
      g.addEventListener('pointermove', mv)
      g.addEventListener('pointerup', up)
      g.addEventListener('pointercancel', up)
    })
    return g
  }

  // ---- arrastrar pestañas ----

  #tabDown(e, id) {
    if (e.button !== 0 || e.target.closest('.dk-x')) return
    const x0 = e.clientX, y0 = e.clientY
    let dragging = false
    let target = null
    const mv = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
        dragging = true
        this.ghost = div('dk-ghost')
        this.ghost.textContent = this.panels[id].title
        document.body.appendChild(this.ghost)
        document.documentElement.classList.add('dk-dragging')
      }
      ev.preventDefault()
      this.ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`
      target = this.#zoneAt(ev.clientX, ev.clientY)
      this.#showDrop(target)
    }
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      if (!dragging) { this.activate(id); return }
      this.#endDrag()
      if (target) this.move(id, target.stack, target.zone)
    }
    const cancel = () => { target = null; up() }
    window.addEventListener('pointermove', mv, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  #endDrag() {
    this.ghost?.remove()
    this.ghost = null
    this.drop.hidden = true
    document.documentElement.classList.remove('dk-dragging')
  }

  #zoneAt(x, y) {
    const el = document.elementFromPoint(x, y)
    const st = el?.closest('.dk-stack')
    if (!st || !this.area.contains(st)) return null
    const r = st.getBoundingClientRect()
    if (el.closest('.dk-head')) return { stack: st.dkNode, zone: 'center', rect: r }
    const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy)
    let zone = 'center'
    if (edge < 0.25) zone = edge === fx ? 'left' : edge === 1 - fx ? 'right' : edge === fy ? 'top' : 'bottom'
    return { stack: st.dkNode, zone, rect: r }
  }

  #showDrop(t) {
    const d = this.drop
    if (!t) { d.hidden = true; return }
    const r = t.rect
    let { left, top, width, height } = r
    if (t.zone === 'left') width /= 2
    if (t.zone === 'right') { left += width / 2; width /= 2 }
    if (t.zone === 'top') height /= 2
    if (t.zone === 'bottom') { top += height / 2; height /= 2 }
    Object.assign(d.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
    d.hidden = false
  }
}
