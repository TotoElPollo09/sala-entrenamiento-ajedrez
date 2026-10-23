// Navegación entre páginas.
import * as dashboard from './dashboard.js'
import * as analysis from './analysis.js'
import * as openings from './openings.js'
import * as rivals from './rivals.js'
import * as database from './database.js'
import * as settingsPage from './settings-page.js'
import { on } from './store.js'
import { bindKeys } from './board.js'

const PAGES = { dashboard, analysis, openings, rivals, database, settings: settingsPage }
let current = null

for (const [id, mod] of Object.entries(PAGES)) mod.init(document.getElementById(`page-${id}`))

function go(id) {
  if (!PAGES[id]) id = 'dashboard'
  current = id
  for (const p of Object.keys(PAGES)) document.getElementById(`page-${p}`).hidden = p !== id
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.page === id ? 'page' : 'false'))
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`)
  PAGES[id].shown?.()
  window.scrollTo({ top: 0 })
}

document.querySelectorAll('.tabs a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.page) }))
window.addEventListener('hashchange', () => go(location.hash.slice(1)))
on('go', go)
bindKeys(() => (current === 'analysis' ? analysis.getBoard() : current === 'openings' ? openings.getBoard() : null))
go(location.hash.slice(1) || 'dashboard')

// Tema oscuro (por defecto) o claro, recordado en este navegador.
const THEME_KEY = 'ajedrez-web:tema'
function setTheme(t) {
  if (t === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  document.querySelector('meta[name="theme-color"]').content = t === 'light' ? '#ffffff' : '#0f1115'
  try { localStorage.setItem(THEME_KEY, t) } catch { /* sin almacenamiento */ }
}
document.getElementById('theme-btn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'))
if (document.documentElement.dataset.theme === 'light') setTheme('light')
