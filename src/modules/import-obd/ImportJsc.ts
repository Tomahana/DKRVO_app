import { parseXlsxJsc, ImportVysledekJsc, JscRadekParsed } from '../../lib/importJsc'

export function renderImportJsc(container: HTMLElement): void {
  container.innerHTML = `
    <div class="import-wrap">
      <h2>Import výsledků JSc</h2>
      <p class="import-hint">Exportuj výsledky z OBD jako XLSX soubor a přetáhni ho sem.</p>
      <div class="drop-zone" id="drop-zone-jsc">
        <span>Přetáhni XLSX soubor nebo <label for="file-input-jsc" class="file-label">vyber soubor</label></span>
        <input type="file" id="file-input-jsc" accept=".xlsx,.xls" style="display:none">
      </div>
      <div id="jsc-stats" class="import-stats hidden"></div>
      <div id="jsc-chyby" class="import-chyby hidden"></div>
      <div id="jsc-tabulka" class="import-tabulka hidden"></div>
      <div id="jsc-actions" class="import-actions hidden">
        <button id="btn-ulozit-jsc" class="btn-primary">Uložit do databáze</button>
        <button id="btn-reset-jsc" class="btn-secondary">Načíst jiný soubor</button>
      </div>
    </div>
  `

  const dropZone = container.querySelector('#drop-zone-jsc') as HTMLElement
  const fileInput = container.querySelector('#file-input-jsc') as HTMLInputElement

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files[0]
    if (file) zpracujSoubor(file, container)
  })
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) zpracujSoubor(file, container)
  })
  container.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'btn-reset-jsc') renderImportJsc(container)
  })
}

function zpracujSoubor(file: File, container: HTMLElement): void {
  const reader = new FileReader()
  reader.onload = e => {
    const buffer = e.target?.result as ArrayBuffer
    const vysledek = parseXlsxJsc(buffer)
    zobrazVysledky(vysledek, container)
  }
  reader.readAsArrayBuffer(file)
}

function zobrazVysledky(v: ImportVysledekJsc, container: HTMLElement): void {
  const stats = container.querySelector('#jsc-stats') as HTMLElement
  stats.classList.remove('hidden')
  stats.innerHTML = `
    <div class="stat"><span>${v.celkem}</span>načteno</div>
    <div class="stat ok"><span>${v.ok}</span>v pořádku</div>
    <div class="stat ${v.s_chybami > 0 ? 'warn' : ''}"><span>${v.s_chybami}</span>s varováním</div>
    <div class="stat"><span>${v.preskocene}</span>přeskočeno</div>
  `

  if (v.kriticke_chyby.length > 0) {
    const chyby = container.querySelector('#jsc-chyby') as HTMLElement
    chyby.classList.remove('hidden')
    chyby.innerHTML = `<strong>Kritické chyby:</strong><ul>${v.kriticke_chyby.map(c => `<li>${c}</li>`).join('')}</ul>`
  }

  const tabulka = container.querySelector('#jsc-tabulka') as HTMLElement
  tabulka.classList.remove('hidden')
  tabulka.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>OBD ID</th>
          <th>Rok</th>
          <th>Název</th>
          <th>Vydavatel</th>
          <th>Interní autoři</th>
          <th>Stav</th>
        </tr>
      </thead>
      <tbody>
        ${v.radky.map(r => renderRadek(r)).join('')}
      </tbody>
    </table>
  `

  if (v.celkem > 0) {
    container.querySelector('#jsc-actions')!.classList.remove('hidden')
  }
}

function renderRadek(r: JscRadekParsed): string {
  const interni = r.autori.filter(a => !a.externi)
  const maChyby = r.chyby.length > 0
  const maVarovani = r.varovani.length > 0
  const stavIcon = maChyby ? '❌' : maVarovani ? '⚠️' : '✅'
  const tooltip = [...r.chyby, ...r.varovani].join(' | ')
  return `
    <tr class="${maChyby ? 'row-error' : maVarovani ? 'row-warn' : ''}">
      <td>${r.obd_id}</td>
      <td>${r.rok}</td>
      <td class="td-nazev" title="${r.nazev}">${r.nazev.substring(0, 50)}${r.nazev.length > 50 ? '…' : ''}</td>
      <td title="${r.vydavatel_raw}">${r.vydavatel_raw.substring(0, 30)}${r.vydavatel_raw.length > 30 ? '…' : ''}</td>
      <td>${interni.map(a => `${a.jmeno_raw} (${a.pracoviste_kod_raw})`).join(', ') || '—'}</td>
      <td title="${tooltip}">${stavIcon}</td>
    </tr>
  `
}
