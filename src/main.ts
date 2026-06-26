import './style.css'
import { renderImportJimp } from './modules/import-obd/ImportJimp'
import { renderImportJsc } from './modules/import-obd/ImportJsc'
import { renderImportBC } from './modules/import-obd/ImportBC'
import { renderLogin } from './modules/auth/Login'
import './modules/import-obd/importJimp.css'
import {
  nactiProfil,
  odhlasit,
  pocetCekajicichNavrhu
} from './lib/auth'
import type { Profil } from './lib/auth'
import { supabase } from './lib/supabase'

const MODULY = [
  { id: 'import-jimp',  label: 'Import JIMP',    ikona: '📥', role: ['admin','prorektor','spravce_obd'] },
  { id: 'import-jsc',   label: 'Import JSc',     ikona: '📥', role: ['admin','prorektor','spravce_obd'] },
  { id: 'import-bc',    label: 'Import B / C',   ikona: '📥', role: ['admin','prorektor','spravce_obd'] },
  { id: 'casopisy',     label: 'Časopisy',       ikona: '📰', role: ['admin','prorektor','spravce_obd','prodekan'] },
  { id: 'vydavatele',   label: 'Vydavatelé',     ikona: '🏢', role: ['admin','prorektor','spravce_obd','prodekan'] },
  { id: 'vypocet',      label: 'Výpočet DKRVO',  ikona: '🧮', role: ['admin','prorektor'] },
  { id: 'navrhy',       label: 'Návrhy změn',    ikona: '📋', role: ['admin','prorektor'] },
  { id: 'reporty',      label: 'Reporty',        ikona: '📊', role: ['admin','prorektor','prodekan'] },
]

let aktualniProfil: Profil | null = null
let aktualniModul = 'import-jimp'

function modulyProRoli(role: string) {
  return MODULY.filter(m => m.role.includes(role))
}

async function renderNav(aktivni: string, pocetNavrhu: number): Promise<void> {
  const nav = document.querySelector('#nav-seznam') as HTMLElement
  const moduly = modulyProRoli(aktualniProfil?.role ?? 'prodekan')

  nav.innerHTML = moduly.map(m => `
    <button
      class="nav-btn ${m.id === aktivni ? 'nav-btn--aktivni' : ''}"
      data-modul="${m.id}"
    >
      <span class="nav-ikona">${m.ikona}</span>
      <span class="nav-label">${m.label}</span>
      ${m.id === 'navrhy' && pocetNavrhu > 0
        ? `<span class="nav-odznak">${pocetNavrhu}</span>`
        : ''}
    </button>
  `).join('')
}

function renderModul(id: string): void {
  const obsah = document.querySelector('#obsah') as HTMLElement
  obsah.innerHTML = ''

  switch (id) {
    case 'import-jimp': renderImportJimp(obsah); break
    case 'import-jsc':  renderImportJsc(obsah);  break
    case 'import-bc':   renderImportBC(obsah);   break
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

async function renderApp(): Promise<void> {
  const pocetNavrhu = await pocetCekajicichNavrhu()

  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <span class="logo-zkratka">UHK</span>
          <span class="logo-nazev">DKRVO<br>Kalkulačka</span>
        </div>
        <nav id="nav-seznam"></nav>
        <div class="sidebar-footer">
          <div class="uzivatel-info">
            <span class="uzivatel-jmeno">${aktualniProfil?.jmeno ?? aktualniProfil?.email ?? ''}</span>
            <span class="uzivatel-role">${aktualniProfil?.role ?? ''}</span>
          </div>
          <button id="btn-odhlasit" class="btn-odhlasit" title="Odhlásit">⏻</button>
        </div>
      </aside>
      <main id="obsah" class="obsah"></main>
    </div>
  `

  await renderNav(aktualniModul, pocetNavrhu)
  renderModul(aktualniModul)

  // Navigace
  document.querySelector('#nav-seznam')!.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-modul]') as HTMLElement
    if (!btn) return
    aktualniModul = btn.dataset.modul!
    renderNav(aktualniModul, pocetNavrhu)
    renderModul(aktualniModul)
  })

  // Odhlášení
  document.querySelector('#btn-odhlasit')!.addEventListener('click', async () => {
    await odhlasit()
    init()
  })
}

async function init(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app')!

  // Zjisti stav přihlášení
  aktualniProfil = await nactiProfil()

  if (!aktualniProfil) {
    // Zobraz login
    renderLogin(app, () => {
      // Po úspěšném přihlášení (magic link) se stránka sama refreshne
    })
    return
  }

  await renderApp()
}

// Sleduj změny auth stavu (magic link callback)
supabase?.auth.onAuthStateChange(async (event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
    aktualniProfil = await nactiProfil()
    if (aktualniProfil) {
      await renderApp()
    } else {
      const app = document.querySelector<HTMLDivElement>('#app')!
      renderLogin(app, () => {})
    }
  }
})

init()
