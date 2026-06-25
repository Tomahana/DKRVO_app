import { parseTsvJimp, parseXlsxJimp, ulozitJimpDoSupabase } from '../../lib/importJimp'
import type { ImportVysledek, JimpRadekParsed } from '../../lib/importJimp'

export function renderImportJimp(container: HTMLElement): void {
  container.innerHTML = `
    <div class="import-wrap">
      <h2>Import výsledků JIMP</h2>
      <p class="import-hint">Exportuj výsledky z OBD jako TSV soubor a přetáhni ho sem.</p>

      <div class="drop-zone" id="drop-zone">
        <i class="icon-upload"></i>
        <span>Přetáhni XLSX nebo TXT soubor nebo <label for="file-input" class="file-label">vyber soubor</label></span>
        <input type="file" id="file-input" accept=".xlsx,.tsv,.txt,.csv" style="display:none">
      </div>

      <div id="import-stats" class="import-stats hidden"></div>
      <div id="import-chyby" class="import-chyby hidden"></div>
      <div id="import-tabulka" class="import-tabulka hidden"></div>
      <div id="import-actions" class="import-actions hidden">
        <button id="btn-ulozit" class="btn-primary">Uložit do databáze</button>
        <button id="btn-reset" class="btn-secondary">Načíst jiný soubor</button>
      </div>
    </div>
  `

  const dropZone = container.querySelector('#drop-zone') as HTMLElement
  const fileInput = container.querySelector('#file-input') as HTMLInputElement

  // Drag & drop
  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files[0]
    if (file) zpracujSoubor(file, container)
  })

  // Klik výběr souboru
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) zpracujSoubor(file, container)
  })

  // Reset
  container.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'btn-reset') resetUI(container)
  })
}

function zpracujSoubor(file: File, container: HTMLElement): void {
  const reader = new FileReader()

  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    reader.onload = e => {
      const buffer = e.target?.result as ArrayBuffer
      const vysledek = parseXlsxJimp(buffer)
      zobrazVysledky(vysledek, container)
    }
    reader.readAsArrayBuffer(file)
  } else {
    reader.onload = e => {
      const tsv = e.target?.result as string
      const vysledek = parseTsvJimp(tsv)
      zobrazVysledky(vysledek, container)
    }
    reader.readAsText(file, 'utf-8')
  }
}

function zobrazVysledky(v: ImportVysledek, container: HTMLElement): void {
  // Stats
  const stats = container.querySelector('#import-stats') as HTMLElement
  stats.classList.remove('hidden')
  stats.innerHTML = `
    <div class="stat ${v.ok > 0 ? 'ok' : ''}"><span>${v.celkem}</span>načteno</div>
    <div class="stat ok"><span>${v.ok}</span>v pořádku</div>
    <div class="stat ${v.s_chybami > 0 ? 'warn' : ''}"><span>${v.s_chybami}</span>s varováním</div>
    <div class="stat"><span>${v.preskocene}</span>přeskočeno</div>
  `

  // Kritické chyby
  if (v.kriticke_chyby.length > 0) {
    const chyby = container.querySelector('#import-chyby') as HTMLElement
    chyby.classList.remove('hidden')
    chyby.innerHTML = `<strong>Kritické chyby:</strong><ul>${v.kriticke_chyby.map(c => `<li>${c}</li>`).join('')}</ul>`
  }

  // Tabulka výsledků
  const tabulka = container.querySelector('#import-tabulka') as HTMLElement
  tabulka.classList.remove('hidden')
  tabulka.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>OBD ID</th>
          <th>Rok</th>
          <th>Název</th>
          <th>ISSN</th>
          <th>Interní autoři</th>
          <th>Stav</th>
        </tr>
      </thead>
      <tbody>
        ${v.radky.map(r => renderRadek(r)).join('')}
      </tbody>
    </table>
  `

  // Akce
  if (v.celkem > 0) {
    const actions = container.querySelector('#import-actions') as HTMLElement
    actions.classList.remove('hidden')
    const btnUlozit = container.querySelector('#btn-ulozit') as HTMLButtonElement
    btnUlozit.onclick = () => ulozitDoSupabase(v, container)
  }
}

function renderRadek(r: JimpRadekParsed): string {
  const interniAutori = r.autori.filter(a => !a.externi)
  const maChyby = r.chyby.length > 0
  const maVarovani = r.varovani.length > 0
  const stavIcon = maChyby ? '❌' : maVarovani ? '⚠️' : '✅'
  const tooltip = [...r.chyby, ...r.varovani].join(' | ')
  return `
    <tr class="${maChyby ? 'row-error' : maVarovani ? 'row-warn' : ''}">
      <td>${r.obd_id}</td>
      <td>${r.rok}</td>
      <td class="td-nazev" title="${r.nazev}">${r.nazev.substring(0, 60)}${r.nazev.length > 60 ? '…' : ''}</td>
      <td>${r.issn ?? r.eissn ?? '—'}</td>
      <td>${interniAutori.map(a => `${a.jmeno_raw} (${a.pracoviste_kod_raw})`).join(', ') || '—'}</td>
      <td title="${tooltip}">${stavIcon}</td>
    </tr>
  `
}

async function ulozitDoSupabase(v: ImportVysledek, container: HTMLElement): Promise<void> {
  const btn = container.querySelector('#btn-ulozit') as HTMLButtonElement
  btn.disabled = true
  btn.textContent = 'Ukládám…'

  const { ulozeno, chyby } = await ulozitJimpDoSupabase(v)

  if (chyby.length > 0) {
    const chybyEl = container.querySelector('#import-chyby') as HTMLElement
    chybyEl.classList.remove('hidden')
    chybyEl.innerHTML = `
      <strong>Chyby při ukládání (${chyby.length}):</strong>
      <ul>${chyby.slice(0, 20).map(c => `<li>${c}</li>`).join('')}</ul>
      ${chyby.length > 20 ? `<p>… a dalších ${chyby.length - 20} chyb</p>` : ''}
    `
  }

  btn.textContent = `✅ Uloženo ${ulozeno} záznamů`
  btn.style.background = '#2a9d5c'
}

function resetUI(container: HTMLElement): void {
  renderImportJimp(container)
}
