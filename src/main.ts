import './style.css'
import { renderImportJimp } from './modules/import-obd/ImportJimp'
import { renderImportJsc } from './modules/import-obd/ImportJsc'
import { renderImportBC } from './modules/import-obd/ImportBC'
import { renderImportJCR } from './modules/casopisy/ImportJCR'
import { renderLogin } from './modules/auth/Login'
import './modules/import-obd/importJimp.css'
import {
  nactiProfil,
  odhlasit,
  pocetCekajicichNavrhu
} from './lib/auth'
import type { Profil } from './lib/auth'
import { supabase, supabaseInitError } from './lib/supabase'

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

const AUTH_REQUIRED = import.meta.env.VITE_REQUIRE_AUTH === 'true'
const AUTH_BYPASS = !AUTH_REQUIRED
const LOCAL_PROFIL: Profil = {
  id: 'local-bypass-user',
  email: 'bez-prihlaseni@uhk.cz',
  jmeno: 'Lokální',
  prijmeni: 'režim',
  role: 'admin',
  fakulta_kod: 'UHK',
  aktivni: true,
}

let aktualniProfil: Profil | null = null
let aktualniModul = 'import-jimp'

function modulyProRoli(role: string) {
  return MODULY.filter(m => m.role.includes(role))
}

async function sTimeoutem<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
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
    case 'casopisy':    renderImportJCR(obsah);  break
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
            <span class="uzivatel-role">${AUTH_REQUIRED ? (aktualniProfil?.role ?? '') : 'bez přihlášení'}</span>
          </div>
          ${AUTH_REQUIRED ? '<button id="btn-odhlasit" class="btn-odhlasit" title="Odhlásit">⏻</button>' : ''}
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
  const odhlasitBtn = document.querySelector<HTMLButtonElement>('#btn-odhlasit')
  if (AUTH_REQUIRED && odhlasitBtn) {
    odhlasitBtn.addEventListener('click', async () => {
      await odhlasit()
      init()
    })
  }
}

async function init(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app')!

  try {
    if (AUTH_BYPASS) {
      aktualniProfil = LOCAL_PROFIL
      await renderApp()
      return
    }

    if (!supabase) throw (supabaseInitError ?? new Error('Supabase klient není dostupný.'))

    // Zjisti stav přihlášení
    const { data: { session } } = await sTimeoutem(
      supabase.auth.getSession(),
      7000,
      'Vypršel čas při ověřování přihlášení. Zkus stránku obnovit.'
    )

    if (!session) {
      renderLogin(app)
      return
    }

    aktualniProfil = await sTimeoutem(
      nactiProfil(),
      7000,
      'Vypršel čas při načítání profilu. Zkus stránku obnovit.'
    )

    if (!aktualniProfil) {
      // Uživatel je přihlášen v Auth ale nemá profil v tabulce profily
      app.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;color:#e8e8e8;background:#0f1117;">
          <div style="font-size:2rem;">⚠️</div>
          <div>Účet není nastaven. Kontaktuj administrátora.</div>
          <div style="font-size:0.8rem;color:#666;">${session.user.email}</div>
          <button id="btn-account-signout"
            style="margin-top:1rem;padding:0.5rem 1rem;background:#4f8ef7;border:none;border-radius:8px;color:white;cursor:pointer;">
            Odhlásit
          </button>
        </div>
      `
      document.querySelector('#btn-account-signout')?.addEventListener('click', async () => {
        await odhlasit()
        location.reload()
      })
      return
    }

    await renderApp()

  } catch (err) {
    app.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;color:#f87171;background:#0f1117;padding:2rem;text-align:center;">
        <div style="font-size:2rem;">❌</div>
        <div style="font-weight:500;">Chyba při spuštění aplikace</div>
        <div style="font-size:0.85rem;color:#888;max-width:500px;">${String(err)}</div>
        <button onclick="location.reload()"
          style="margin-top:1rem;padding:0.5rem 1rem;background:#4f8ef7;border:none;border-radius:8px;color:white;cursor:pointer;">
          Zkusit znovu
        </button>
      </div>
    `
  }
}

// Sleduj změny auth stavu
if (supabase && AUTH_REQUIRED) {
  supabase.auth.onAuthStateChange(async (event, _session) => {
    if (event === 'SIGNED_IN') {
      aktualniProfil = await nactiProfil()
      if (aktualniProfil) {
        await renderApp()
      } else {
        await init()
      }
    } else if (event === 'SIGNED_OUT') {
      aktualniProfil = null
      const app = document.querySelector<HTMLDivElement>('#app')!
      renderLogin(app)
    }
  })
}

init()
