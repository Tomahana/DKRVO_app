import {
  parseCasopisyCsv,
  parseCasopisyXlsx,
  ulozitCasopisyDoSupabase,
} from '../../lib/importCasopisy'
import type { CasopisRadek, ImportVysledekCasopisy } from '../../lib/importCasopisy'

interface ViewData {
  soubor: string
  import: ImportVysledekCasopisy
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderRows(radky: CasopisRadek[]): string {
  return radky.slice(0, 300).map((r) => `
    <tr>
      <td class="td-nazev" title="${esc(r.nazev)}">${esc(r.nazev)}</td>
      <td>${esc(r.issn ?? '—')}</td>
      <td>${esc(r.eissn ?? '—')}</td>
      <td>${r.ais_hodnota === null ? '—' : r.ais_hodnota.toFixed(3)}</td>
      <td>${esc(r.ais_kvartal ?? '—')}</td>
      <td>${r.jif_hodnota === null ? '—' : r.jif_hodnota.toFixed(3)}</td>
      <td>${esc(r.jif_kvartal ?? '—')}</td>
      <td>${r.jif_percentil === null ? '—' : r.jif_percentil.toFixed(1)}</td>
    </tr>
  `).join('')
}

export function renderImportJCR(container: HTMLElement): void {
  const aktualniRok = new Date().getFullYear()
  let posledniData: ViewData | null = null

  container.innerHTML = `
    <div class="import-wrap">
      <h2>Import časopisů</h2>
      <p class="import-hint">
        Nahraj CSV/XLSX a ulož časopisy do tabulky s rokem platnosti.
        Data vkládej po jednotlivých rocích.
      </p>

      <div class="import-actions" style="margin:0 0 1rem 0;">
        <label style="display:flex;align-items:center;gap:0.5rem;">
          <span>Rok platnosti:</span>
          <input id="casopisy-rok" type="number" class="login-input" min="1900" max="2100" value="${aktualniRok}" style="width:130px;">
        </label>
      </div>

      <div class="drop-zone" id="drop-zone-casopisy">
        <span>Přetáhni CSV/XLSX nebo <label for="file-input-casopisy" class="file-label">vyber soubor</label></span>
        <input type="file" id="file-input-casopisy" accept=".csv,.xlsx,.xls" style="display:none">
      </div>

      <div id="casopisy-status" class="import-chyby hidden"></div>
      <div id="casopisy-stats" class="import-stats hidden"></div>
      <div id="casopisy-varovani" class="import-chyby hidden"></div>
      <div id="casopisy-tabulka" class="import-tabulka hidden"></div>

      <div id="casopisy-actions" class="import-actions hidden">
        <button id="btn-ulozit-casopisy" class="btn-primary">Uložit do databáze</button>
        <button id="btn-reset-casopisy" class="btn-secondary">Načíst jiný soubor</button>
      </div>

      <p class="import-hint" style="margin-top:1rem;">
        Pokud tabulka ještě neexistuje, spusť v Supabase skript <code>sql/setup_casopisy.sql</code>.
      </p>
    </div>
  `

  const dropZone = container.querySelector('#drop-zone-casopisy') as HTMLElement
  const fileInput = container.querySelector('#file-input-casopisy') as HTMLInputElement
  const rokInput = container.querySelector('#casopisy-rok') as HTMLInputElement
  const status = container.querySelector('#casopisy-status') as HTMLElement
  const stats = container.querySelector('#casopisy-stats') as HTMLElement
  const varovani = container.querySelector('#casopisy-varovani') as HTMLElement
  const tabulka = container.querySelector('#casopisy-tabulka') as HTMLElement
  const actions = container.querySelector('#casopisy-actions') as HTMLElement
  const ulozitBtn = container.querySelector('#btn-ulozit-casopisy') as HTMLButtonElement

  const showStatus = (text: string, isError: boolean): void => {
    status.classList.remove('hidden')
    status.textContent = text
    status.style.color = isError ? '#f87171' : '#2a9d5c'
    status.style.borderColor = isError ? '#5a2020' : '#1a4a2a'
    status.style.background = isError ? '#2a1a1a' : '#0f2a1a'
  }

  const zpracujSoubor = async (file: File): Promise<void> => {
    const ext = file.name.toLowerCase().split('.').pop()
    const parsed = ext === 'csv'
      ? parseCasopisyCsv(await file.text())
      : parseCasopisyXlsx(await file.arrayBuffer())

    posledniData = { soubor: file.name, import: parsed }
    showStatus(`Načten soubor ${file.name}.`, false)

    stats.classList.remove('hidden')
    stats.innerHTML = `
      <div class="stat"><span>${parsed.celkem_radku}</span>řádků</div>
      <div class="stat ok"><span>${parsed.validnich_radku}</span>validních</div>
      <div class="stat"><span>${rokInput.value || '—'}</span>rok platnosti</div>
    `

    if (parsed.varovani.length > 0) {
      varovani.classList.remove('hidden')
      varovani.innerHTML = `<strong>Varování:</strong><ul>${parsed.varovani.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`
    } else {
      varovani.classList.add('hidden')
      varovani.innerHTML = ''
    }

    tabulka.classList.remove('hidden')
    tabulka.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Název</th>
            <th>ISSN</th>
            <th>eISSN</th>
            <th>AIS</th>
            <th>AIS Q</th>
            <th>JIF</th>
            <th>JIF Q</th>
            <th>JIF %</th>
          </tr>
        </thead>
        <tbody>${renderRows(parsed.radky)}</tbody>
      </table>
      ${parsed.radky.length > 300 ? `<div class="import-hint" style="margin-top:0.5rem;">Zobrazeno prvních 300 řádků z ${parsed.radky.length}.</div>` : ''}
    `

    actions.classList.remove('hidden')
  }

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (file) void zpracujSoubor(file)
  })

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) void zpracujSoubor(file)
  })

  ulozitBtn.addEventListener('click', async () => {
    if (!posledniData) {
      showStatus('Nejdřív načti soubor s daty časopisů.', true)
      return
    }
    const rok = Number.parseInt(rokInput.value, 10)
    if (!Number.isFinite(rok) || rok < 1900 || rok > 2100) {
      showStatus('Zadej platný rok platnosti (1900–2100).', true)
      return
    }

    ulozitBtn.disabled = true
    ulozitBtn.textContent = 'Ukládám…'
    const result = await ulozitCasopisyDoSupabase(posledniData.import.radky, rok, posledniData.soubor)
    if (result.ok) {
      showStatus(`Uloženo ${result.ulozeno} časopisů do tabulky ${result.tabulka} pro rok ${rok}.`, false)
    } else {
      showStatus(`Uložení selhalo: ${result.chyba ?? 'neznámá chyba'}`, true)
    }
    ulozitBtn.disabled = false
    ulozitBtn.textContent = 'Uložit do databáze'
  })

  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.id === 'btn-reset-casopisy') renderImportJCR(container)
  })
}
