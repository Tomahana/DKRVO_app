import './style.css'
import { renderImportJimp } from './modules/import-obd/ImportJimp'
import { renderImportJsc } from './modules/import-obd/ImportJsc'
import { renderImportBC } from './modules/import-obd/ImportBC'
import './modules/import-obd/importJimp.css'

const MODULY = [
  { id: 'import-jimp',   label: 'Import JIMP',      ikona: '📥' },
  { id: 'import-jsc',    label: 'Import JSc',        ikona: '📥' },
  { id: 'import-bc',     label: 'Import B / C',      ikona: '📥' },
  { id: 'casopisy',      label: 'Časopisy',          ikona: '📰' },
  { id: 'vydavatele',    label: 'Vydavatelé',        ikona: '🏢' },
  { id: 'vypocet',       label: 'Výpočet DKRVO',    ikona: '🧮' },
  { id: 'reporty',       label: 'Reporty',           ikona: '📊' },
]

function renderNav(aktivni: string): void {
  const nav = document.querySelector('#nav-seznam') as HTMLElement
  nav.innerHTML = MODULY.map(m => `
    <button
      class="nav-btn ${m.id === aktivni ? 'nav-btn--aktivni' : ''}"
      data-modul="${m.id}"
    >
      <span class="nav-ikona">${m.ikona}</span>
      <span class="nav-label">${m.label}</span>
    </button>
  `).join('')
}

function renderModul(id: string): void {
  const obsah = document.querySelector('#obsah') as HTMLElement
  obsah.innerHTML = ''

  switch (id) {
    case 'import-jimp':
      renderImportJimp(obsah)
      break
    case 'import-jsc':
      renderImportJsc(obsah)
      break
    case 'import-bc':
      renderImportBC(obsah)
      break
    default:
      obsah.innerHTML = `
        <div class="placeholder">
          <span class="placeholder-ikona">${MODULY.find(m => m.id === id)?.ikona ?? '🔧'}</span>
          <h2>${MODULY.find(m => m.id === id)?.label ?? id}</h2>
          <p>Tento modul se připravuje.</p>
        </div>
      `
  }
}

function init(): void {
  // Vykresli layout
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <span class="logo-zkratka">UHK</span>
          <span class="logo-nazev">DKRVO<br>Kalkulačka</span>
        </div>
        <nav id="nav-seznam"></nav>
      </aside>
      <main id="obsah" class="obsah"></main>
    </div>
  `

  // Výchozí modul
  let aktivni = 'import-jimp'
  renderNav(aktivni)
  renderModul(aktivni)

  // Navigace — klik
  document.querySelector('#nav-seznam')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-modul]') as HTMLElement
    if (!btn) return
    aktivni = btn.dataset.modul!
    renderNav(aktivni)
    renderModul(aktivni)
  })
}

init()
