import {
  parseJCRXlsx,
  parseJCRCsv,
  vypoctiPoradi,
  agregujMetriky,
  formatujHodnoceni,
  ulozitJCRDoSupabase,
} from '../../lib/importJCR'
import type { ImportVysledekJCR, CasopisAgregace } from '../../lib/importJCR'

interface JcrViewData {
  importVysledek: ImportVysledekJCR
  agregace: CasopisAgregace[]
}

export function renderImportJCR(container: HTMLElement): void {
  let posledniData: JcrViewData | null = null

  container.innerHTML = `
    <div class="import-wrap">
      <h2>Import JCR</h2>
      <p class="import-hint">Načti CSV/XLSX export JCR, spočítej metriky a ulož časopisy do Supabase.</p>
      <div class="drop-zone" id="drop-zone-jcr">
        <span>Přetáhni CSV/XLSX nebo <label for="file-input-jcr" class="file-label">vyber soubor</label></span>
        <input type="file" id="file-input-jcr" accept=".csv,.xlsx,.xls" style="display:none">
      </div>
      <div id="jcr-stats" class="import-stats hidden"></div>
      <div id="jcr-chyby" class="import-chyby hidden"></div>
      <div id="jcr-status" class="import-chyby hidden"></div>
      <div id="jcr-tabulka" class="import-tabulka hidden"></div>
      <div id="jcr-actions" class="import-actions hidden">
        <button id="btn-ulozit-jcr" class="btn-primary">Uložit</button>
        <button id="btn-reset-jcr" class="btn-secondary">Načíst jiný soubor</button>
      </div>
    </div>
  `

  const dropZone = container.querySelector('#drop-zone-jcr') as HTMLElement
  const fileInput = container.querySelector('#file-input-jcr') as HTMLInputElement
  const status = container.querySelector('#jcr-status') as HTMLElement
  const saveBtn = container.querySelector('#btn-ulozit-jcr') as HTMLButtonElement

  const zobrazStatus = (text: string, isError: boolean): void => {
    status.classList.remove('hidden')
    status.textContent = text
    status.style.color = isError ? '#f87171' : '#2a9d5c'
    status.style.borderColor = isError ? '#5a2020' : '#1a4a2a'
    status.style.background = isError ? '#2a1a1a' : '#0f2a1a'
  }

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files[0]
    if (file) void zpracujSoubor(file, container).then((data) => {
      posledniData = data
      status.classList.add('hidden')
    })
  })
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) void zpracujSoubor(file, container).then((data) => {
      posledniData = data
      status.classList.add('hidden')
    })
  })

  saveBtn.addEventListener('click', async () => {
    if (!posledniData) {
      zobrazStatus('Nejdřív načti soubor.', true)
      return
    }
    const rok = posledniData.importVysledek.rok_metrik
    if (!rok || rok < 2000) {
      zobrazStatus('Rok metrik nebyl detekován z hlavičky (AIS Year / JIF year / 2020 JIF).', true)
      return
    }

    saveBtn.disabled = true
    saveBtn.textContent = 'Ukládám…'
    const vysledek = await ulozitJCRDoSupabase(posledniData.agregace, rok)
    if (vysledek.chyby.length > 0) {
      zobrazStatus(`Uloženo ${vysledek.ulozeno} z ${posledniData.agregace.length}. Chyby: ${vysledek.chyby.slice(0, 3).join(' | ')}`, true)
    } else if (vysledek.varovani.length > 0) {
      zobrazStatus(`Uloženo ${vysledek.ulozeno}. Pozn.: ${vysledek.varovani.slice(0, 2).join(' | ')}`, false)
    } else {
      zobrazStatus(`Uloženo ${vysledek.ulozeno} časopisů do tabulky ${vysledek.tabulka} pro rok ${rok}.`, false)
    }
    saveBtn.disabled = false
    saveBtn.textContent = 'Uložit'
  })

  container.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'btn-reset-jcr') renderImportJCR(container)
  })
}

async function zpracujSoubor(file: File, container: HTMLElement): Promise<JcrViewData> {
  const ext = file.name.toLowerCase().split('.').pop()
  let parsed: ImportVysledekJCR
  if (ext === 'csv') {
    parsed = parseJCRCsv(await file.text())
  } else {
    parsed = parseJCRXlsx(await file.arrayBuffer())
  }

  const radkySPoradim = vypoctiPoradi(parsed.radky)
  const importVysledek: ImportVysledekJCR = { ...parsed, radky: radkySPoradim }
  const agregace = agregujMetriky(radkySPoradim)
  const data: JcrViewData = { importVysledek, agregace }
  zobrazVysledky(data, container)
  return data
}

function renderRadek(r: CasopisAgregace): string {
  const h = formatujHodnoceni(r.nejlepsi_ais_hodnoceni)
  const jifQ = formatujHodnoceni(r.nejlepsi_jif_kvartal)
  return `
    <tr>
      <td class="td-nazev" title="${r.nazev}">
        ${r.nazev.substring(0, 40)}${r.nazev.length > 40 ? '…' : ''}
      </td>
      <td>${r.issn ?? '—'}</td>
      <td>${r.eissn ?? '—'}</td>
      <td>${r.nejlepsi_ais?.toFixed(3) ?? '—'}</td>
      <td>
        <span class="h-badge ${h.cssTrida}" title="${h.tooltip}">${h.label}</span>
        ${r.ais_kvartal_zdroj === 'vypocet' ? '<span class="zdroj-badge">výp.</span>' : ''}
      </td>
      <td style="font-size:0.8rem;color:#888">
        ${r.nejlepsi_ais_poradi !== null ? `${r.nejlepsi_ais_poradi}/${r.nejlepsi_ais_celkem}` : '—'}
      </td>
      <td>${r.nejlepsi_jif?.toFixed(3) ?? '—'}</td>
      <td><span class="h-badge ${jifQ.cssTrida}" title="${jifQ.tooltip}">${jifQ.label}</span></td>
      <td>${r.nejlepsi_jif_percentil?.toFixed(1) ?? '—'}</td>
      <td title="${r.kategorie.join(', ')}" style="font-size:0.8rem;color:#666">${r.kategorie.length} kat.</td>
    </tr>`
}

function zobrazVysledky(data: JcrViewData, container: HTMLElement): void {
  const stats = container.querySelector('#jcr-stats') as HTMLElement
  const chyby = container.querySelector('#jcr-chyby') as HTMLElement
  const tabulka = container.querySelector('#jcr-tabulka') as HTMLElement
  const actions = container.querySelector('#jcr-actions') as HTMLElement

  stats.classList.remove('hidden')
  stats.innerHTML = `
    <div class="stat"><span>${data.importVysledek.celkem_radku}</span>načteno</div>
    <div class="stat ok"><span>${data.importVysledek.unikatnich_casopisu}</span>časopisů</div>
    <div class="stat"><span>${data.importVysledek.rok_metrik || '—'}</span>rok metrik</div>
  `

  if (data.importVysledek.kriticke_chyby.length > 0) {
    chyby.classList.remove('hidden')
    chyby.innerHTML = `<strong>Kritické chyby:</strong><ul>${data.importVysledek.kriticke_chyby.map((c) => `<li>${c}</li>`).join('')}</ul>`
  } else {
    chyby.classList.add('hidden')
    chyby.innerHTML = ''
  }

  tabulka.classList.remove('hidden')
  tabulka.innerHTML = `
    <table>
      <thead><tr>
        <th>Název</th>
        <th>ISSN</th><th>eISSN</th>
        <th>AIS</th><th>AIS hodnocení</th><th>Pořadí</th>
        <th>JIF</th><th>JIF hodnocení</th><th>JIF %</th>
        <th>Kat.</th>
      </tr></thead>
      <tbody>${data.agregace.map((r) => renderRadek(r)).join('')}</tbody>
    </table>
  `
  if (data.importVysledek.celkem_radku > 0) actions.classList.remove('hidden')
}
