import { prihlasit } from '../../lib/auth'

export function renderLogin(container: HTMLElement): void {
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-logo">
          <span class="logo-zkratka">UHK</span>
          <span class="logo-nazev">DKRVO Kalkulačka</span>
        </div>
        <p class="login-hint">Přihlaš se svým UHK emailem a heslem.</p>
        <div class="login-form">
          <input
            type="email"
            id="login-email"
            class="login-input"
            placeholder="jmeno.prijmeni@uhk.cz"
            autocomplete="email"
          >
          <input
            type="password"
            id="login-heslo"
            class="login-input"
            placeholder="Heslo"
            autocomplete="current-password"
          >
          <button id="login-btn" class="btn-primary login-btn">Přihlásit se</button>
        </div>
        <div id="login-status" class="login-status hidden"></div>
      </div>
    </div>
  `

  const emailInput = container.querySelector('#login-email') as HTMLInputElement
  const hesloInput = container.querySelector('#login-heslo') as HTMLInputElement
  const loginBtn = container.querySelector('#login-btn') as HTMLButtonElement
  const status = container.querySelector('#login-status') as HTMLElement

  // Enter → odeslat
  hesloInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click()
  })

  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    const heslo = hesloInput.value

    if (!email || !email.includes('@')) {
      zobrazStatus(status, 'Zadej platný email.', 'error')
      return
    }
    if (!heslo) {
      zobrazStatus(status, 'Zadej heslo.', 'error')
      return
    }

    loginBtn.disabled = true
    loginBtn.textContent = 'Přihlašuji…'

    const { chyba } = await prihlasit(email, heslo)

    if (chyba) {
      zobrazStatus(status, chyba, 'error')
      loginBtn.disabled = false
      loginBtn.textContent = 'Přihlásit se'
      hesloInput.value = ''
      hesloInput.focus()
    }
    // Po úspěchu onAuthStateChange v main.ts přepne na app.
  })
}

function zobrazStatus(el: HTMLElement, zprava: string, typ: 'ok' | 'error'): void {
  el.classList.remove('hidden', 'status-ok', 'status-error')
  el.classList.add(`status-${typ}`)
  el.textContent = zprava
}
