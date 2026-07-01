import {
  parseJCRXlsx,
  parseJCRCsv,
  vypoctiPoradi,
  agregujMetriky,
  formatujHodnoceni,
  ulozitJCRDoSupabase,
  nactiHistoriiCasopisu,
  ulozitRokCasopisuDoSupabase,
} from '../../lib/importJCR'
import type { ImportVysledekJCR, CasopisAgregace, CasopisRokDetail } from '../../lib/importJCR'

interface JcrViewData {
  importVysledek: ImportVysledekJCR
  agregace: CasopisAgregace[]
}

export function renderImportJCR(container: HTMLElement): void {
  let posledniData: JcrViewData | null = null
  const detailCache = new Map<string, CasopisRokDetail[]>()

  container.innerHTML = `
    <div class="import-wrap">
      <h2>Import JCR</h2>
      <p class="import-hint">Načti CSV/XLSX export JCR, spočítej metriky a ulož časopisy do Supabase. Detail časopisu umožní ruční úpravy napříč roky.</p>
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
    <div id="jcr-detail-modal" class="jcr-modal hidden">
      <div class="jcr-modal-card">
        <div class="jcr-modal-head">
          <h3 id="jcr-detail-title">Detail časopisu</h3>
          <button id="btn-close-detail" class="btn-secondary">Zavřít</button>
        </div>
        <div id="jcr-detail-status" class="import-chyby hidden"></div>
        <div id="jcr-detail-content" class="import-tabulka"></div>
      </div>
    </div>
  `

  const dropZone = container.querySelector('#drop-zone-jcr') as HTMLElement
  const fileInput = container.querySelector('#file-input-jcr') as HTMLInputElement
  const status = container.querySelector('#jcr-status') as HTMLElement
  const saveBtn = container.querySelector('#btn-ulozit-jcr') as HTMLButtonElement
  const detailModal = container.querySelector('#jcr-detail-modal') as HTMLElement
  const detailStatus = container.querySelector('#jcr-detail-status') as HTMLElement
  const detailContent = container.querySelector('#jcr-detail-content') as HTMLElement
  const detailTitle = container.querySelector('#jcr-detail-title') as HTMLElement

  const zobrazStatus = (text: string, isError: boolean): void => {
    status.classList.remove('hidden')
    status.textContent = text
    status.style.color = isError ? '#f87171' : '#2a9d5c'
    status.style.borderColor = isError ? '#5a2020' : '#1a4a2a'
    status.style.background = isError ? '#2a1a1a' : '#0f2a1a'
  }

  const zobrazDetailStatus = (text: string, isError: boolean): void => {
    detailStatus.classList.remove('hidden')
    detailStatus.textContent = text
    detailStatus.style.color = isError ? '#f87171' : '#2a9d5c'
    detailStatus.style.borderColor = isError ? '#5a2020' : '#1a4a2a'
    detailStatus.style.background = isError ? '#2a1a1a' : '#0f2a1a'
  }

  const skryjDetailStatus = (): void => {
    detailStatus.classList.add('hidden')
    detailStatus.textContent = ''
  }

  const esc = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')

  const formatNum = (n: number | null): string => (n === null ? '' : String(n))

  const keyCasopis = (r: Pick<CasopisAgregace, 'nazev' | 'issn' | 'eissn'>): string =>
    `${r.issn ?? ''}|${r.eissn ?? ''}|${r.nazev}`

  const mergeDetailRows = (
    lokalni: CasopisRokDetail[],
    dbRows: CasopisRokDetail[]
  ): CasopisRokDetail[] => {
    const map = new Map<number, CasopisRokDetail>()
    for (const r of lokalni) map.set(r.rok_metrik, r)
    for (const r of dbRows) {
      const base = map.get(r.rok_metrik)
      map.set(r.rok_metrik, base ? { ...base, ...r } : r)
    }
    return Array.from(map.values()).sort((a, b) => b.rok_metrik - a.rok_metrik)
  }

  const buildLocalDetailRows = (
    cil: CasopisAgregace,
    data: JcrViewData
  ): CasopisRokDetail[] => {
    const rok = data.importVysledek.rok_metrik
    if (!rok) return []
    return [{
      rok_metrik: rok,
      nazev: cil.nazev,
      issn: cil.issn,
      eissn: cil.eissn,
      ais_hodnota: cil.nejlepsi_ais,
      ais_hodnoceni: cil.nejlepsi_ais_hodnoceni,
      ais_kvartal: cil.nejlepsi_ais_kvartal,
      ais_decil: cil.nejlepsi_ais_decil,
      ais_percentil: cil.nejlepsi_ais_percentil,
      jif_hodnota: cil.nejlepsi_jif,
      jif_hodnoceni: cil.nejlepsi_jif_hodnoceni,
      jif_kvartal: cil.nejlepsi_jif_kvartal,
      jif_decil: cil.nejlepsi_jif_decil,
      jif_percentil: cil.nejlepsi_jif_percentil,
    }]
  }

  const renderDetailTable = (
    ident: Pick<CasopisAgregace, 'nazev' | 'issn' | 'eissn'>,
    rows: CasopisRokDetail[]
  ): void => {
    detailContent.innerHTML = `
      <table class="jcr-detail-table">
        <thead>
          <tr>
            <th>Rok</th>
            <th>AIS</th>
            <th>AIS hodnocení</th>
            <th>AIS kvartil</th>
            <th>AIS decil</th>
            <th>AIS %</th>
            <th>JIF</th>
            <th>JIF hodnocení</th>
            <th>JIF kvartil</th>
            <th>JIF decil</th>
            <th>JIF %</th>
            <th>Akce</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr data-detail-year="${row.rok_metrik}">
              <td>${row.rok_metrik}</td>
              <td><input class="jcr-input" data-field="ais_hodnota" value="${esc(formatNum(row.ais_hodnota))}"></td>
              <td><input class="jcr-input" data-field="ais_hodnoceni" value="${esc(row.ais_hodnoceni ?? '')}"></td>
              <td><input class="jcr-input" data-field="ais_kvartal" value="${esc(row.ais_kvartal ?? '')}"></td>
              <td><input class="jcr-input" data-field="ais_decil" value="${esc(row.ais_decil ?? '')}"></td>
              <td><input class="jcr-input" data-field="ais_percentil" value="${esc(formatNum(row.ais_percentil))}"></td>
              <td><input class="jcr-input" data-field="jif_hodnota" value="${esc(formatNum(row.jif_hodnota))}"></td>
              <td><input class="jcr-input" data-field="jif_hodnoceni" value="${esc(row.jif_hodnoceni ?? '')}"></td>
              <td><input class="jcr-input" data-field="jif_kvartal" value="${esc(row.jif_kvartal ?? '')}"></td>
              <td><input class="jcr-input" data-field="jif_decil" value="${esc(row.jif_decil ?? '')}"></td>
              <td><input class="jcr-input" data-field="jif_percentil" value="${esc(formatNum(row.jif_percentil))}"></td>
              <td><button class="btn-secondary btn-jcr-save-year" data-save-year="${row.rok_metrik}">Uložit úpravy</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="import-hint" style="margin-top:0.75rem;">
        Úpravy se ukládají do tabulky podle konfigurace (<code>${esc(import.meta.env.VITE_SUPABASE_CASOPISY_TABLE ?? 'casopisy')}</code>).
      </div>
    `

    detailContent.querySelectorAll<HTMLButtonElement>('.btn-jcr-save-year').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rok = Number.parseInt(btn.dataset.saveYear ?? '', 10)
        if (!Number.isFinite(rok)) return
        const tr = detailContent.querySelector(`tr[data-detail-year="${rok}"]`) as HTMLElement | null
        if (!tr) return
        const read = (field: string): string =>
          (tr.querySelector<HTMLInputElement>(`input[data-field="${field}"]`)?.value ?? '').trim()
        const toNum = (field: string): number | null => {
          const txt = read(field)
          if (!txt) return null
          const num = Number.parseFloat(txt.replace(',', '.'))
          return Number.isFinite(num) ? num : null
        }
        btn.disabled = true
        btn.textContent = 'Ukládám…'

        const uprava: CasopisRokDetail = {
          rok_metrik: rok,
          nazev: ident.nazev,
          issn: ident.issn,
          eissn: ident.eissn,
          ais_hodnota: toNum('ais_hodnota'),
          ais_hodnoceni: read('ais_hodnoceni') || null,
          ais_kvartal: read('ais_kvartal') || null,
          ais_decil: read('ais_decil') || null,
          ais_percentil: toNum('ais_percentil'),
          jif_hodnota: toNum('jif_hodnota'),
          jif_hodnoceni: read('jif_hodnoceni') || null,
          jif_kvartal: read('jif_kvartal') || null,
          jif_decil: read('jif_decil') || null,
          jif_percentil: toNum('jif_percentil'),
        }
        const vysledek = await ulozitRokCasopisuDoSupabase(uprava)
        if (vysledek.ok) {
          if (vysledek.varovani.length > 0) {
            zobrazDetailStatus(`Uloženo s upozorněním: ${vysledek.varovani.slice(0, 2).join(' | ')}`, false)
          } else {
            zobrazDetailStatus(`Uloženo pro rok ${rok} do tabulky ${vysledek.tabulka}.`, false)
          }
        } else {
          zobrazDetailStatus(`Chyba uložení: ${vysledek.chyba ?? 'neznámá chyba'}`, true)
        }
        btn.disabled = false
        btn.textContent = 'Uložit úpravy'
      })
    })
  }

  const otevriDetail = async (agregaceIndex: number): Promise<void> => {
    if (!posledniData) return
    const cil = posledniData.agregace[agregaceIndex]
    if (!cil) return

    detailModal.classList.remove('hidden')
    skryjDetailStatus()
    detailTitle.textContent = `Detail: ${cil.nazev}`
    detailContent.innerHTML = '<div class="import-hint">Načítám data…</div>'

    const key = keyCasopis(cil)
    const lokalni = buildLocalDetailRows(cil, posledniData)
    let rows = detailCache.get(key) ?? lokalni

    const historie = await nactiHistoriiCasopisu(cil)
    if (historie.chyba) {
      zobrazDetailStatus(`Historie z DB není dostupná: ${historie.chyba}`, true)
    } else {
      rows = mergeDetailRows(lokalni, historie.radky)
      detailCache.set(key, rows)
      if (historie.radky.length === 0) {
        zobrazDetailStatus('V DB zatím nejsou starší roky, upravuješ aktuálně importovaný rok.', false)
      } else {
        zobrazDetailStatus(`Načteno ${historie.radky.length} řádků z tabulky ${historie.tabulka}.`, false)
      }
    }

    renderDetailTable(cil, rows)
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
    const target = e.target as HTMLElement
    if (target.id === 'btn-reset-jcr') renderImportJCR(container)
    if (target.id === 'btn-close-detail') detailModal.classList.add('hidden')
    const detailBtn = target.closest('[data-detail-index]') as HTMLElement | null
    if (detailBtn) {
      const idx = Number.parseInt(detailBtn.dataset.detailIndex ?? '', 10)
      if (Number.isFinite(idx)) void otevriDetail(idx)
    }
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

function renderRadek(r: CasopisAgregace, idx: number): string {
  const h = formatujHodnoceni(r.nejlepsi_ais_hodnoceni)
  const jifQ = formatujHodnoceni(r.nejlepsi_jif_hodnoceni)
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
      <td>
        <span class="h-badge ${jifQ.cssTrida}" title="${jifQ.tooltip}">${jifQ.label}</span>
        ${r.jif_kvartal_zdroj === 'vypocet' ? '<span class="zdroj-badge">výp.</span>' : ''}
      </td>
      <td>${r.nejlepsi_jif_percentil?.toFixed(1) ?? '—'}</td>
      <td title="${r.kategorie.join(', ')}" style="font-size:0.8rem;color:#666">${r.kategorie.length} kat.</td>
      <td><button class="btn-secondary btn-jcr-detail" data-detail-index="${idx}">Detail</button></td>
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
        <th>Kat.</th><th>Úpravy</th>
      </tr></thead>
      <tbody>${data.agregace.map((r, idx) => renderRadek(r, idx)).join('')}</tbody>
    </table>
  `
  if (data.importVysledek.celkem_radku > 0) actions.classList.remove('hidden')
}
