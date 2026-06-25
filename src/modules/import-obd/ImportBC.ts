import { parseXlsxBC } from '../../lib/importBC'
import type { ImportVysledekBC, BRadekParsed, CRadekParsed } from '../../lib/importBC'

export function renderImportBC(container: HTMLElement): void {
  container.innerHTML = `
    <div class="import-wrap">
      <h2>Import výsledků B / C</h2>
      <p class="import-hint">Exportuj knihy a kapitoly z OBD jako jeden XLSX soubor a přetáhni ho sem.</p>
      <div class="drop-zone" id="drop-zone-bc">
        <span>Přetáhni XLSX soubor nebo <label for="file-input-bc" class="file-label">vyber soubor</label></span>
        <input type="file" id="file-input-bc" accept=".xlsx,.xls" style="display:none">
      </div>
      <div id="bc-stats" class="import-stats hidden"></div>
      <div id="bc-nespárovane" class="import-chyby hidden"></div>
      <div id="bc-tabs" class="bc-tabs hidden">
        <button class="tab-btn tab-btn--aktivni" data-tab="knihy">📚 Knihy</button>
        <button class="tab-btn" data-tab="kapitoly">📄 Kapitoly</button>
      </div>
      <div id="bc-tabulka" class="import-tabulka hidden"></div>
      <div id="bc-actions" class="import-actions hidden">
        <button id="btn-ulozit-bc" class="btn-primary">Uložit do databáze</button>
        <button id="btn-reset-bc" class="btn-secondary">Načíst jiný soubor</button>
      </div>
    </div>
  `

  const dropZone = container.querySelector('#drop-zone-bc') as HTMLElement
  const fileInput = container.querySelector('#file-input-bc') as HTMLInputElement
  let aktualniData: ImportVysledekBC | null = null

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files[0]
    if (file) zpracujSoubor(file, container, data => { aktualniData = data })
  })
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) zpracujSoubor(file, container, data => { aktualniData = data })
  })

  // Přepínání záložek
  container.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement
    if (btn && aktualniData) {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-btn--aktivni'))
      btn.classList.add('tab-btn--aktivni')
      const tab = btn.dataset.tab as 'knihy' | 'kapitoly'
      renderTabulka(aktualniData, tab, container)
    }
    if ((e.target as HTMLElement).id === 'btn-reset-bc') renderImportBC(container)
  })
}

function zpracujSoubor(
  file: File,
  container: HTMLElement,
  onData: (data: ImportVysledekBC) => void
): void {
  const reader = new FileReader()
  reader.onload = e => {
    const buffer = e.target?.result as ArrayBuffer
    const vysledek = parseXlsxBC(buffer)
    onData(vysledek)
    zobrazVysledky(vysledek, container)
  }
  reader.readAsArrayBuffer(file)
}

function zobrazVysledky(v: ImportVysledekBC, container: HTMLElement): void {
  const stats = container.querySelector('#bc-stats') as HTMLElement
  stats.classList.remove('hidden')
  stats.innerHTML = `
    <div class="stat-skupina">
      <div class="stat-label">📚 Knihy</div>
      <div class="stat ok"><span>${v.knihy_ok}</span>v pořádku</div>
      <div class="stat ${v.knihy_chyby > 0 ? 'warn' : ''}"><span>${v.knihy_chyby}</span>s chybou</div>
    </div>
    <div class="stat-skupina">
      <div class="stat-label">📄 Kapitoly</div>
      <div class="stat ok"><span>${v.kapitoly_ok}</span>v pořádku</div>
      <div class="stat ${v.kapitoly_chyby > 0 ? 'warn' : ''}"><span>${v.kapitoly_chyby}</span>s chybou</div>
    </div>
    <div class="stat"><span>${v.preskocene}</span>přeskočeno</div>
  `

  if (v.nespárovane_kapitoly.length > 0) {
    const el = container.querySelector('#bc-nespárovane') as HTMLElement
    el.classList.remove('hidden')
    el.innerHTML = `
      <strong>⚠️ Nespárované kapitoly (${v.nespárovane_kapitoly.length}) — kniha není v importu:</strong>
      <ul>${v.nespárovane_kapitoly.slice(0, 10).map(c => `<li>${c}</li>`).join('')}</ul>
      ${v.nespárovane_kapitoly.length > 10 ? `<p>… a dalších ${v.nespárovane_kapitoly.length - 10}</p>` : ''}
    `
  }

  container.querySelector('#bc-tabs')!.classList.remove('hidden')
  container.querySelector('#bc-actions')!.classList.remove('hidden')
  renderTabulka(v, 'knihy', container)
}

function renderTabulka(
  v: ImportVysledekBC,
  tab: 'knihy' | 'kapitoly',
  container: HTMLElement
): void {
  const tabulka = container.querySelector('#bc-tabulka') as HTMLElement
  tabulka.classList.remove('hidden')

  if (tab === 'knihy') {
    tabulka.innerHTML = `
      <table>
        <thead><tr>
          <th>OBD ID</th><th>Rok</th><th>Název</th>
          <th>Vydavatel</th><th>ISBN</th><th>Stran</th><th>Autoři</th><th>Stav</th>
        </tr></thead>
        <tbody>${v.knihy.map(r => renderRadekB(r)).join('')}</tbody>
      </table>`
  } else {
    tabulka.innerHTML = `
      <table>
        <thead><tr>
          <th>OBD ID</th><th>Rok</th><th>Název kapitoly</th>
          <th>ISBN knihy</th><th>Strany (kap.)</th><th>Podíl</th><th>Autoři</th><th>Stav</th>
        </tr></thead>
        <tbody>${v.kapitoly.map((r, i) => renderRadekC(r, i)).join('')}</tbody>
      </table>`

    // Listener pro ruční doplnění počtu stran knihy
    tabulka.addEventListener('input', e => {
      const input = e.target as HTMLInputElement
      if (!input.classList.contains('input-stran-knihy')) return

      const index = parseInt(input.dataset.index!)
      const kapitola = v.kapitoly[index]
      const pocetStranKnihy = parseInt(input.value, 10)

      if (!isNaN(pocetStranKnihy) && pocetStranKnihy > 0 && kapitola.pocet_stran_kapitoly) {
        const podil = kapitola.pocet_stran_kapitoly / pocetStranKnihy
        kapitola.podil_stran = podil

        const podilEl = tabulka.querySelector(`#podil-${index}`)
        if (podilEl) {
          podilEl.classList.add('podil-ok')
          const podilVysledek = podilEl.querySelector(`#podil-vysledek-${index}`)
          if (podilVysledek) {
            podilVysledek.innerHTML = `<strong>${(podil * 100).toFixed(1)}%</strong>`
          } else {
            podilEl.innerHTML = `<strong>${(podil * 100).toFixed(1)}%</strong>`
          }
        }
      }
    })
  }
}

function renderRadekB(r: BRadekParsed): string {
  const interni = r.autori.filter(a => !a.externi)
  const stavIcon = r.chyby.length > 0 ? '❌' : r.varovani.length > 0 ? '⚠️' : '✅'
  return `
    <tr class="${r.chyby.length > 0 ? 'row-error' : r.varovani.length > 0 ? 'row-warn' : ''}">
      <td>${r.obd_id}</td>
      <td>${r.rok}</td>
      <td class="td-nazev" title="${r.nazev}">${r.nazev.substring(0, 45)}${r.nazev.length > 45 ? '…' : ''}</td>
      <td title="${r.vydavatel_raw}">${r.vydavatel_raw.substring(0, 25)}${r.vydavatel_raw.length > 25 ? '…' : ''}</td>
      <td>${r.isbn ?? '—'}</td>
      <td>${r.pocet_stran ?? '—'}</td>
      <td>${interni.map(a => `${a.jmeno_raw} (${a.pracoviste_kod_raw})`).join(', ') || '—'}</td>
      <td title="${[...r.chyby, ...r.varovani].join(' | ')}">${stavIcon}</td>
    </tr>`
}

function renderRadekC(r: CRadekParsed, index: number): string {
  const interni = r.autori.filter(a => !a.externi)
  const stavIcon = r.chyby.length > 0 ? '❌' : r.varovani.length > 0 ? '⚠️' : '✅'
  const pocetStranKap = r.pocet_stran_kapitoly ?? '—'
  const podil = r.podil_stran !== null
    ? `${(r.podil_stran * 100).toFixed(1)}%`
    : `<span class="doplnit-wrap">
        <input
          type="number"
          class="input-stran-knihy"
          data-index="${index}"
          placeholder="stran knihy"
          min="1"
          title="Zadej celkový počet stran knihy"
        >
        <span class="input-hint">→ ${pocetStranKap} stran kap.</span>
        <span class="podil-vysledek" id="podil-vysledek-${index}"></span>
       </span>`

  return `
    <tr class="${r.chyby.length > 0 ? 'row-error' : r.varovani.length > 0 ? 'row-warn' : ''}"
        data-obd="${r.obd_id}">
      <td>${r.obd_id}</td>
      <td>${r.rok}</td>
      <td class="td-nazev" title="${r.nazev}">${r.nazev.substring(0, 40)}${r.nazev.length > 40 ? '…' : ''}</td>
      <td title="${r.kniha_nazev_raw}">${r.kniha_isbn ?? '—'}</td>
      <td>${r.strany_raw ?? '—'} <small>(${pocetStranKap} str.)</small></td>
      <td class="td-podil" id="podil-${index}">${podil}</td>
      <td>${interni.map(a => `${a.jmeno_raw} (${a.pracoviste_kod_raw})`).join(', ') || '—'}</td>
      <td title="${[...r.chyby, ...r.varovani].join(' | ')}">${stavIcon}</td>
    </tr>`
}
