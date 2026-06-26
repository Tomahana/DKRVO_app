import { prihlasit } from '../../lib/auth'

export function renderLogin(container: HTMLElement, onSuccess: () => void): void {
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-logo">
          <span class="logo-zkratka">UHK</span>
          <span class="logo-nazev">DKRVO Kalkulačka</span>
        </div>
        <p class="login-hint">Zadej svůj UHK email — pošleme ti přihlašovací odkaz.</p>
        <div class="login-form">
          <input
            type="email"
            id="login-email"
            class="login-input"
            placeholder="jmeno.prijmeni@uhk.cz"
            autocomplete="email"
          >
          <button id="login-btn" class="btn-primary login-btn">Poslat odkaz</button>
        </div>
        <div id="login-status" class="login-status hidden"></div>
      </div>
    </div>
  `

  const emailInput = container.querySelector('#login-email') as HTMLInputElement
  const loginBtn = container.querySelector('#login-btn') as HTMLButtonElement
  const status = container.querySelector('#login-status') as HTMLElement

  // Enter → odeslat
  emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') loginBtn.click()
  })

  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    if (!email || !email.includes('@')) {
      zobrazStatus(status, 'Zadej platný email.', 'error')
      return
    }

    loginBtn.disabled = true
    loginBtn.textContent = 'Odesílám…'

    const { chyba } = await prihlasit(email)

    if (chyba) {
      zobrazStatus(status, `Chyba: ${chyba}`, 'error')
      loginBtn.disabled = false
      loginBtn.textContent = 'Poslat odkaz'
    } else {
      zobrazStatus(
        status,
        `✅ Odkaz odeslán na ${email}. Zkontroluj email a klikni na odkaz.`,
        'ok'
      )
      loginBtn.textContent = 'Odesláno'
      onSuccess()
    }
  })
}

function zobrazStatus(el: HTMLElement, zprava: string, typ: 'ok' | 'error'): void {
  el.classList.remove('hidden', 'status-ok', 'status-error')
  el.classList.add(`status-${typ}`)
  el.textContent = zprava
}
