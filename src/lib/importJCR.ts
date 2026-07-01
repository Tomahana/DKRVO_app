import * as XLSX from 'xlsx'
import { supabase } from './supabase'

export interface JCRRadek {
  nazev: string
  issn: string | null
  eissn: string | null
  kategorie: string[]
  ais_hodnota: number | null
  ais_kvartal: string | null
  jif_hodnota: number | null
  jif_kvartal: string | null
  jif_percentil: number | null
}

export interface JCRRadekRozsireny extends JCRRadek {
  ais_poradi?: number
  ais_celkem?: number
  ais_hodnoceni?: string
  ais_kvartal_vypocteny?: string
  ais_decil_vypocteny?: string
  ais_percentil_vypocteny?: number

  jif_poradi?: number
  jif_celkem?: number
  jif_hodnoceni?: string
  jif_kvartal_vypocteny?: string
  jif_decil_vypocteny?: string
  jif_percentil_vypocteny?: number
}

export interface CasopisAgregace {
  nazev: string
  issn: string | null
  eissn: string | null
  kategorie: string[]

  nejlepsi_ais: number | null
  nejlepsi_ais_hodnoceni: string | null
  nejlepsi_ais_kvartal: string | null
  nejlepsi_ais_decil: string | null
  nejlepsi_ais_percentil: number | null
  nejlepsi_ais_poradi: number | null
  nejlepsi_ais_celkem: number | null
  ais_kvartal_zdroj: 'jcr' | 'vypocet' | null

  nejlepsi_jif: number | null
  nejlepsi_jif_hodnoceni: string | null
  nejlepsi_jif_kvartal: string | null
  nejlepsi_jif_decil: string | null
  nejlepsi_jif_percentil: number | null
  nejlepsi_jif_poradi: number | null
  nejlepsi_jif_celkem: number | null
  jif_kvartal_zdroj: 'jcr' | 'vypocet' | null
}

export interface ImportVysledekJCR {
  rok_metrik: number
  celkem_radku: number
  unikatnich_casopisu: number
  radky: JCRRadekRozsireny[]
  kriticke_chyby: string[]
  varovani: string[]

  celkem: number
  ok: number
  s_chybami: number
  preskocene: number
}

export interface CasopisRokDetail {
  id?: string | number | null
  rok_metrik: number
  nazev: string
  issn: string | null
  eissn: string | null
  ais_hodnota: number | null
  ais_hodnoceni: string | null
  ais_kvartal: string | null
  ais_decil: string | null
  ais_percentil: number | null
  jif_hodnota: number | null
  jif_hodnoceni: string | null
  jif_kvartal: string | null
  jif_decil: string | null
  jif_percentil: number | null
}

interface SloupceMap {
  nazev: number
  issn: number
  eissn: number
  kategorie: number
  ais: number | null
  ais_q: number | null
  jif: number
  jif_q: number | null
  jif_p: number | null
  ais_year: number | null
  jif_year: number | null
}

export interface PozicniMetriky {
  poradi: number
  celkem: number
  percentil_pozice: number
  hodnoceni: string
  kvartal: string
  decil: string
}

const HODNOCENI_PORADI: Record<string, number> = {
  P1: 100, P2: 99, P3: 98, P4: 97, P5: 96,
  P6: 95, P7: 94, P8: 93, P9: 92, P10: 91,
  D1: 90,
  Q1: 40, Q2: 30, Q3: 20, Q4: 10,
}

function parseCislo(raw: string): number | null {
  if (!raw) return null
  const cislo = Number.parseFloat(raw.replace(',', '.').trim())
  return Number.isFinite(cislo) ? cislo : null
}

function normalizeIssn(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, '')
  if (!cleaned) return null
  if (!/^\d{4}-[\dXx]{4}$/.test(cleaned)) return null
  return cleaned.toUpperCase()
}

function normalizeQuartile(raw: string): string | null {
  const q = raw.trim().toUpperCase()
  return /^Q[1-4]$/.test(q) ? q : null
}

function parseKategorie(raw: string): string[] {
  return raw
    .split(/[;|]/)
    .map((k) => k.trim())
    .filter(Boolean)
}

function parseRokText(text: string): number | null {
  const match = text.match(/\b(20\d{2})\b/)
  if (!match) return null
  const rok = Number.parseInt(match[1], 10)
  return Number.isFinite(rok) ? rok : null
}

function mapujSloupce(hlavicka: string[]): SloupceMap | null {
  const h = hlavicka.map((s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/;/g, '')
      .trim()
  )

  const najdi = (...hledane: string[]): number => {
    for (const hledany of hledane) {
      const idx = h.findIndex((s) => s.includes(hledany.toLowerCase()))
      if (idx >= 0) return idx
    }
    return -1
  }

  const nazev = najdi('journal name')
  const issn = najdi('issn')
  const eissn = najdi('eissn')
  const kategorie = najdi('category')

  if (nazev < 0 || issn < 0 || kategorie < 0) return null

  return {
    nazev,
    issn,
    eissn: eissn >= 0 ? eissn : -1,
    kategorie,
    ais: najdi('article influence score') >= 0 ? najdi('article influence score') : null,
    ais_q: najdi('ais quartile') >= 0 ? najdi('ais quartile') : null,
    jif: najdi('jif', '2020 jif', '2021 jif', '2022 jif', '2023 jif', '2024 jif', '2025 jif'),
    jif_q: najdi('jif quartile') >= 0 ? najdi('jif quartile') : null,
    jif_p: najdi('jif percentile') >= 0 ? najdi('jif percentile') : null,
    ais_year: najdi('ais year') >= 0 ? najdi('ais year') : null,
    jif_year: najdi('jif year') >= 0 ? najdi('jif year') : null,
  }
}

function detekujRokZahlavi(
  hlavicka: string[],
  mapa: SloupceMap,
  prvniData: string[] | null,
  prvniRadekText: string
): number {
  for (const sloupec of hlavicka) {
    const match = sloupec.match(/\b(20\d{2})\s*(?:jif|ais)\b/i)
      ?? sloupec.match(/\b(?:jif|ais)\s*(20\d{2})\b/i)
    if (match) {
      const rok = Number.parseInt(match[1], 10)
      if (Number.isFinite(rok)) return rok
    }
  }

  if (prvniData) {
    if (mapa.ais_year !== null) {
      const rok = parseRokText(prvniData[mapa.ais_year] ?? '')
      if (rok) return rok
    }
    if (mapa.jif_year !== null) {
      const rok = parseRokText(prvniData[mapa.jif_year] ?? '')
      if (rok) return rok
    }
  }

  return parseRokText(prvniRadekText) ?? 0
}

function parseRadek(bunky: string[], mapa: SloupceMap): JCRRadek | null {
  const nazev = (bunky[mapa.nazev] ?? '').trim()
  if (!nazev) return null

  return {
    nazev,
    issn: mapa.issn >= 0 ? normalizeIssn(bunky[mapa.issn] ?? '') : null,
    eissn: mapa.eissn >= 0 ? normalizeIssn(bunky[mapa.eissn] ?? '') : null,
    kategorie: mapa.kategorie >= 0 ? parseKategorie(bunky[mapa.kategorie] ?? '') : [],
    ais_hodnota: mapa.ais !== null ? parseCislo(bunky[mapa.ais] ?? '') : null,
    ais_kvartal: mapa.ais_q !== null ? normalizeQuartile(bunky[mapa.ais_q] ?? '') : null,
    jif_hodnota: mapa.jif >= 0 ? parseCislo(bunky[mapa.jif] ?? '') : null,
    jif_kvartal: mapa.jif_q !== null ? normalizeQuartile(bunky[mapa.jif_q] ?? '') : null,
    jif_percentil: mapa.jif_p !== null ? parseCislo(bunky[mapa.jif_p] ?? '') : null,
  }
}

function parseStaryRadek(radek: string): string[] {
  const ocisteny = radek
    .trim()
    .replace(/^"/, '')
    .replace(/[",;\s]+$/, '')

  const parts = ocisteny.split(',""')
  const bunky: string[] = []
  for (const part of parts) {
    const val = part
      .replace(/""$/g, '')
      .replace(/""/g, '"')
      .trim()
    bunky.push(val)
  }
  return bunky
}

function parseNovyRadek(radek: string): string[] {
  const bunky: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < radek.length; i++) {
    const ch = radek[i]
    if (ch === '"') {
      const escaped = inQuotes && radek[i + 1] === '"'
      if (escaped) {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      bunky.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  bunky.push(current.trim())
  return bunky
}

function pripravImportVysledek(
  rok_metrik: number,
  radky: JCRRadek[],
  kriticke_chyby: string[],
  varovani: string[]
): ImportVysledekJCR {
  const unikatni = new Set(radky.map((r) => r.issn ?? r.eissn ?? r.nazev))
  return {
    rok_metrik,
    celkem_radku: radky.length,
    unikatnich_casopisu: unikatni.size,
    radky,
    kriticke_chyby,
    varovani,
    celkem: radky.length,
    ok: radky.length,
    s_chybami: 0,
    preskocene: 0,
  }
}

export function parseJCRCsv(text: string, rokOverride?: number): ImportVysledekJCR {
  const kriticke_chyby: string[] = []
  const varovani: string[] = []
  const lines = text.split(/\r?\n/).filter((r) => r.trim())
  const prvniRadekText = lines[0] ?? ''

  let hlavickaIdx = -1
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].toLowerCase().includes('journal name')) {
      hlavickaIdx = i
      break
    }
  }

  if (hlavickaIdx < 0) {
    return pripravImportVysledek(rokOverride ?? 0, [], ['CSV: nenalezen hlavičkový řádek'], [])
  }

  const sample = lines[hlavickaIdx + 1] ?? ''
  const jeStaryFormat = sample.startsWith('"') && sample.includes('""')
  const hlavickaRaw = lines[hlavickaIdx]
  const hlavicka = jeStaryFormat
    ? hlavickaRaw.split(',').map((s) => s.replace(/"/g, '').trim())
    : parseNovyRadek(hlavickaRaw)
  const mapa = mapujSloupce(hlavicka)

  if (!mapa) {
    return pripravImportVysledek(
      rokOverride ?? 0,
      [],
      [`CSV: nelze namapovat sloupce. Hlavička: ${hlavicka.slice(0, 6).join(' | ')}`],
      []
    )
  }

  const dataRows = lines.slice(hlavickaIdx + 1)
  const prvniData = dataRows.length > 0
    ? (jeStaryFormat ? parseStaryRadek(dataRows[0]) : parseNovyRadek(dataRows[0]))
    : null
  const rok_metrik = rokOverride ?? detekujRokZahlavi(hlavicka, mapa, prvniData, prvniRadekText)

  const parsovane: JCRRadek[] = []
  for (const line of dataRows) {
    const bunky = jeStaryFormat ? parseStaryRadek(line) : parseNovyRadek(line)
    if (bunky.every((b) => !b)) continue
    const parsed = parseRadek(bunky, mapa)
    if (parsed) parsovane.push(parsed)
  }

  return pripravImportVysledek(rok_metrik, parsovane, kriticke_chyby, varovani)
}

export function parseJCRXlsx(buffer: ArrayBuffer, rokOverride?: number): ImportVysledekJCR {
  try {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    })
      .map((row) => row.map((v) => String(v ?? '').trim()))
      .filter((row) => row.some((v) => v !== ''))

    let hlavickaIdx = -1
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      if (rows[i].some((c) => c.toLowerCase().includes('journal name'))) {
        hlavickaIdx = i
        break
      }
    }

    if (hlavickaIdx < 0) {
      return pripravImportVysledek(rokOverride ?? 0, [], ['XLSX: nenalezen hlavičkový řádek'], [])
    }

    const hlavicka = rows[hlavickaIdx]
    const mapa = mapujSloupce(hlavicka)
    if (!mapa) {
      return pripravImportVysledek(rokOverride ?? 0, [], ['XLSX: nelze namapovat sloupce'], [])
    }

    const dataRows = rows.slice(hlavickaIdx + 1)
    const rok_metrik = rokOverride ?? detekujRokZahlavi(hlavicka, mapa, dataRows[0] ?? null, rows[0]?.join(' ') ?? '')
    const parsed = dataRows
      .map((row) => parseRadek(row, mapa))
      .filter((row): row is JCRRadek => row !== null)
    return pripravImportVysledek(rok_metrik, parsed, [], [])
  } catch (error) {
    return pripravImportVysledek(rokOverride ?? 0, [], [String(error)], [])
  }
}

function vypoctiPozici(poradi: number, celkem: number): PozicniMetriky {
  const percentil_pozice = (poradi / celkem) * 100
  const kvartal =
    percentil_pozice <= 25 ? 'Q1'
      : percentil_pozice <= 50 ? 'Q2'
        : percentil_pozice <= 75 ? 'Q3'
          : 'Q4'
  const decil = `D${Math.min(10, Math.ceil(percentil_pozice / 10))}`

  let hodnoceni: string
  if (percentil_pozice <= 10) {
    hodnoceni = `P${Math.max(1, Math.ceil(percentil_pozice))}`
  } else if (percentil_pozice <= 25) {
    hodnoceni = 'Q1'
  } else if (percentil_pozice <= 50) {
    hodnoceni = 'Q2'
  } else if (percentil_pozice <= 75) {
    hodnoceni = 'Q3'
  } else {
    hodnoceni = 'Q4'
  }

  return { poradi, celkem, percentil_pozice, hodnoceni, kvartal, decil }
}

function scoreHodnoceni(hodnoceni: string | null | undefined): number {
  return HODNOCENI_PORADI[hodnoceni ?? ''] ?? 0
}

type MetricPrefix = 'ais' | 'jif'

function aktualniHodnoceni(radek: JCRRadekRozsireny, prefix: MetricPrefix): string | null {
  if (prefix === 'ais') return radek.ais_hodnoceni ?? radek.ais_kvartal ?? radek.ais_kvartal_vypocteny ?? null
  return radek.jif_hodnoceni ?? radek.jif_kvartal ?? radek.jif_kvartal_vypocteny ?? null
}

function nastavPozici(radek: JCRRadekRozsireny, prefix: MetricPrefix, pozice: PozicniMetriky): void {
  if (prefix === 'ais') {
    radek.ais_poradi = pozice.poradi
    radek.ais_celkem = pozice.celkem
    radek.ais_hodnoceni = pozice.hodnoceni
    radek.ais_kvartal_vypocteny = pozice.kvartal
    radek.ais_decil_vypocteny = pozice.decil
    radek.ais_percentil_vypocteny = pozice.percentil_pozice
    return
  }
  radek.jif_poradi = pozice.poradi
  radek.jif_celkem = pozice.celkem
  radek.jif_hodnoceni = pozice.hodnoceni
  radek.jif_kvartal_vypocteny = pozice.kvartal
  radek.jif_decil_vypocteny = pozice.decil
  radek.jif_percentil_vypocteny = pozice.percentil_pozice
}

function valueForPrefix(radek: JCRRadekRozsireny, prefix: MetricPrefix): number | null {
  return prefix === 'ais' ? radek.ais_hodnota : radek.jif_hodnota
}

export function vypoctiPoradi(radky: JCRRadekRozsireny[]): JCRRadekRozsireny[] {
  const vystup = radky.map((r) => ({ ...r }))
  const podleKategorie = new Map<string, number[]>()

  for (let i = 0; i < vystup.length; i++) {
    const kategorie = vystup[i].kategorie.length > 0 ? vystup[i].kategorie : ['__all__']
    for (const kat of kategorie) {
      if (!podleKategorie.has(kat)) podleKategorie.set(kat, [])
      podleKategorie.get(kat)!.push(i)
    }
  }

  for (const indexy of podleKategorie.values()) {
    for (const prefix of ['ais', 'jif'] as const) {
      const hodnocene = indexy
        .filter((idx) => valueForPrefix(vystup[idx], prefix) !== null)
        .sort((a, b) => (valueForPrefix(vystup[b], prefix) ?? 0) - (valueForPrefix(vystup[a], prefix) ?? 0))
      const celkem = hodnocene.length
      for (let idx = 0; idx < hodnocene.length; idx++) {
        const i = hodnocene[idx]
        const pozice = vypoctiPozici(idx + 1, celkem)
        if (scoreHodnoceni(pozice.hodnoceni) >= scoreHodnoceni(aktualniHodnoceni(vystup[i], prefix))) {
          nastavPozici(vystup[i], prefix, pozice)
        }
      }
    }
  }

  return vystup
}

function vyberNejlepsiRadek(
  skupina: JCRRadekRozsireny[],
  prefix: MetricPrefix
): JCRRadekRozsireny | null {
  return skupina.reduce((best, r) => {
    if (!best) return r
    return scoreHodnoceni(aktualniHodnoceni(r, prefix)) > scoreHodnoceni(aktualniHodnoceni(best, prefix)) ? r : best
  }, null as JCRRadekRozsireny | null)
}

export function agregujMetriky(radky: JCRRadekRozsireny[]): CasopisAgregace[] {
  const skupiny = new Map<string, JCRRadekRozsireny[]>()
  for (const r of radky) {
    const key = `${r.issn ?? ''}|${r.eissn ?? ''}|${r.nazev.toLowerCase()}`
    if (!skupiny.has(key)) skupiny.set(key, [])
    skupiny.get(key)!.push(r)
  }

  return Array.from(skupiny.values()).map((skupina) => {
    const prvni = skupina[0]
    const nejlepsiAisValue = skupina.reduce((best, r) => (r.ais_hodnota ?? -Infinity) > (best.ais_hodnota ?? -Infinity) ? r : best)
    const nejlepsiJifValue = skupina.reduce((best, r) => (r.jif_hodnota ?? -Infinity) > (best.jif_hodnota ?? -Infinity) ? r : best)
    const nejlepsiAisRank = vyberNejlepsiRadek(skupina, 'ais')
    const nejlepsiJifRank = vyberNejlepsiRadek(skupina, 'jif')

    return {
      nazev: prvni.nazev,
      issn: prvni.issn,
      eissn: prvni.eissn,
      kategorie: Array.from(new Set(skupina.flatMap((r) => r.kategorie))),
      nejlepsi_ais: nejlepsiAisValue.ais_hodnota,
      nejlepsi_ais_hodnoceni: nejlepsiAisRank?.ais_hodnoceni ?? nejlepsiAisRank?.ais_kvartal ?? null,
      nejlepsi_ais_kvartal: nejlepsiAisRank?.ais_kvartal ?? nejlepsiAisRank?.ais_kvartal_vypocteny ?? null,
      nejlepsi_ais_decil: nejlepsiAisRank?.ais_decil_vypocteny ?? null,
      nejlepsi_ais_percentil: nejlepsiAisRank?.ais_percentil_vypocteny ?? null,
      nejlepsi_ais_poradi: nejlepsiAisRank?.ais_poradi ?? null,
      nejlepsi_ais_celkem: nejlepsiAisRank?.ais_celkem ?? null,
      ais_kvartal_zdroj: nejlepsiAisRank?.ais_kvartal ? 'jcr' : nejlepsiAisRank?.ais_kvartal_vypocteny ? 'vypocet' : null,
      nejlepsi_jif: nejlepsiJifValue.jif_hodnota,
      nejlepsi_jif_hodnoceni: nejlepsiJifRank?.jif_hodnoceni ?? nejlepsiJifRank?.jif_kvartal ?? null,
      nejlepsi_jif_kvartal: nejlepsiJifRank?.jif_kvartal ?? nejlepsiJifRank?.jif_kvartal_vypocteny ?? null,
      nejlepsi_jif_decil: nejlepsiJifRank?.jif_decil_vypocteny ?? null,
      nejlepsi_jif_percentil: nejlepsiJifRank?.jif_percentil_vypocteny ?? nejlepsiJifValue.jif_percentil,
      nejlepsi_jif_poradi: nejlepsiJifRank?.jif_poradi ?? null,
      nejlepsi_jif_celkem: nejlepsiJifRank?.jif_celkem ?? null,
      jif_kvartal_zdroj: nejlepsiJifRank?.jif_kvartal ? 'jcr' : nejlepsiJifRank?.jif_kvartal_vypocteny ? 'vypocet' : null,
    }
  })
}

export function formatujHodnoceni(hodnoceni: string | null): {
  label: string
  cssTrida: string
  tooltip: string
} {
  if (!hodnoceni) return { label: '—', cssTrida: '', tooltip: '' }
  if (hodnoceni.startsWith('P')) {
    const cislo = Number.parseInt(hodnoceni.slice(1), 10)
    return {
      label: hodnoceni,
      cssTrida: cislo <= 3 ? 'h-p1' : cislo <= 5 ? 'h-p5' : 'h-p10',
      tooltip: `Top ${cislo}% v oboru`,
    }
  }
  if (hodnoceni === 'D1') return { label: 'D1', cssTrida: 'h-d1', tooltip: 'Top 10% v oboru' }
  if (hodnoceni.startsWith('Q')) {
    const cislo = Number.parseInt(hodnoceni.slice(1), 10)
    return {
      label: hodnoceni,
      cssTrida: `h-q${cislo}`,
      tooltip: cislo === 1 ? 'Top 25% v oboru'
        : cislo === 2 ? '25–50% v oboru'
          : cislo === 3 ? '50–75% v oboru'
            : 'Dolních 25% v oboru',
    }
  }
  return { label: hodnoceni, cssTrida: '', tooltip: '' }
}

function extractMissingColumn(message: string): string | null {
  const byRelation = message.match(/column ([a-zA-Z0-9_]+) of relation .* does not exist/)
  if (byRelation) return byRelation[1]
  const bySchemaCache = message.match(/Could not find the '([a-zA-Z0-9_]+)' column/)
  if (bySchemaCache) return bySchemaCache[1]
  return null
}

function sanitizeConflict(finalPayload: Record<string, unknown>): string {
  const cols = ['rok_metrik', 'issn', 'eissn', 'nazev'].filter((c) => c in finalPayload)
  return cols.length > 0 ? cols.join(',') : 'nazev'
}

async function adaptivniUpsert(
  tabulka: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; varovani: string[]; chyba?: string }> {
  if (!supabase) {
    return { ok: false, varovani: [], chyba: 'Supabase není nakonfigurovaný.' }
  }

  let finalPayload: Record<string, unknown> = { ...payload }
  const varovani: string[] = []

  for (let pokus = 0; pokus < 20; pokus++) {
    const upsertRes = await supabase
      .from(tabulka)
      .upsert(finalPayload, { onConflict: sanitizeConflict(finalPayload) })
    if (!upsertRes.error) return { ok: true, varovani }

    const missingCol = extractMissingColumn(upsertRes.error.message)
    if (missingCol && missingCol in finalPayload) {
      delete finalPayload[missingCol]
      varovani.push(`Tabulka ${tabulka} neobsahuje sloupec "${missingCol}" — hodnota přeskočena.`)
      continue
    }

    const insertRes = await supabase.from(tabulka).insert(finalPayload)
    if (!insertRes.error) return { ok: true, varovani }

    const insertMissing = extractMissingColumn(insertRes.error.message)
    if (insertMissing && insertMissing in finalPayload) {
      delete finalPayload[insertMissing]
      varovani.push(`Tabulka ${tabulka} neobsahuje sloupec "${insertMissing}" — hodnota přeskočena.`)
      continue
    }

    return { ok: false, varovani, chyba: insertRes.error.message }
  }

  return { ok: false, varovani, chyba: 'Nepodařilo se uložit po více pokusech.' }
}

function payloadFromAgregace(r: CasopisAgregace, rokMetrik: number): Record<string, unknown> {
  return {
    rok_metrik: rokMetrik,
    nazev: r.nazev,
    issn: r.issn,
    eissn: r.eissn,
    kategorie_text: r.kategorie.join(' | '),
    ais_hodnota: r.nejlepsi_ais,
    ais_hodnoceni: r.nejlepsi_ais_hodnoceni,
    ais_kvartal: r.nejlepsi_ais_kvartal,
    ais_decil: r.nejlepsi_ais_decil,
    ais_percentil: r.nejlepsi_ais_percentil,
    ais_poradi: r.nejlepsi_ais_poradi,
    ais_celkem: r.nejlepsi_ais_celkem,
    ais_kvartal_zdroj: r.ais_kvartal_zdroj,
    jif_hodnota: r.nejlepsi_jif,
    jif_hodnoceni: r.nejlepsi_jif_hodnoceni,
    jif_kvartal: r.nejlepsi_jif_kvartal,
    jif_decil: r.nejlepsi_jif_decil,
    jif_percentil: r.nejlepsi_jif_percentil,
    jif_poradi: r.nejlepsi_jif_poradi,
    jif_celkem: r.nejlepsi_jif_celkem,
    jif_kvartal_zdroj: r.jif_kvartal_zdroj,
  }
}

const CASOPISY_TABULKA = import.meta.env.VITE_SUPABASE_CASOPISY_TABLE ?? 'casopisy'

export async function ulozitJCRDoSupabase(
  agregace: CasopisAgregace[],
  rokMetrik: number
): Promise<{ ulozeno: number; chyby: string[]; varovani: string[]; tabulka: string }> {
  const chyby: string[] = []
  const varovani: string[] = []
  let ulozeno = 0

  if (!supabase) {
    return {
      ulozeno: 0,
      chyby: ['Supabase není nakonfigurovaný (chybí nebo je neplatné VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).'],
      varovani,
      tabulka: CASOPISY_TABULKA,
    }
  }

  for (const r of agregace) {
    const uloz = await adaptivniUpsert(CASOPISY_TABULKA, payloadFromAgregace(r, rokMetrik))
    varovani.push(...uloz.varovani)
    if (uloz.ok) {
      ulozeno++
    } else {
      chyby.push(`${r.nazev}: ${uloz.chyba ?? 'neznámá chyba'}`)
    }
  }

  return { ulozeno, chyby, varovani, tabulka: CASOPISY_TABULKA }
}

function detailFromAnyRow(radek: Record<string, unknown>): CasopisRokDetail {
  const readNum = (...keys: string[]): number | null => {
    for (const k of keys) {
      const raw = radek[k]
      if (raw === null || raw === undefined || raw === '') continue
      const num = Number.parseFloat(String(raw).replace(',', '.'))
      if (Number.isFinite(num)) return num
    }
    return null
  }
  const readStr = (...keys: string[]): string | null => {
    for (const k of keys) {
      const raw = radek[k]
      if (raw === null || raw === undefined) continue
      const txt = String(raw).trim()
      if (txt) return txt
    }
    return null
  }

  return {
    id: (radek.id as string | number | null | undefined) ?? null,
    rok_metrik: Number.parseInt(String(radek.rok_metrik ?? radek.rok ?? 0), 10) || 0,
    nazev: readStr('nazev') ?? '',
    issn: readStr('issn'),
    eissn: readStr('eissn'),
    ais_hodnota: readNum('ais_hodnota'),
    ais_hodnoceni: readStr('ais_hodnoceni'),
    ais_kvartal: readStr('ais_kvartal'),
    ais_decil: readStr('ais_decil'),
    ais_percentil: readNum('ais_percentil'),
    jif_hodnota: readNum('jif_hodnota', 'jif'),
    jif_hodnoceni: readStr('jif_hodnoceni'),
    jif_kvartal: readStr('jif_kvartal'),
    jif_decil: readStr('jif_decil'),
    jif_percentil: readNum('jif_percentil'),
  }
}

export async function nactiHistoriiCasopisu(
  identifikace: Pick<CasopisAgregace, 'nazev' | 'issn' | 'eissn'>
): Promise<{ radky: CasopisRokDetail[]; chyba: string | null; tabulka: string }> {
  if (!supabase) {
    return {
      radky: [],
      chyba: 'Supabase není nakonfigurovaný.',
      tabulka: CASOPISY_TABULKA,
    }
  }

  let dotaz = supabase.from(CASOPISY_TABULKA).select('*')
  if (identifikace.issn) {
    dotaz = dotaz.eq('issn', identifikace.issn)
  } else if (identifikace.eissn) {
    dotaz = dotaz.eq('eissn', identifikace.eissn)
  } else {
    dotaz = dotaz.eq('nazev', identifikace.nazev)
  }

  const { data, error } = await dotaz
  if (error) {
    return { radky: [], chyba: error.message, tabulka: CASOPISY_TABULKA }
  }

  const radky = (data ?? [])
    .map((r) => detailFromAnyRow(r as Record<string, unknown>))
    .filter((r) => r.rok_metrik > 0)
    .sort((a, b) => b.rok_metrik - a.rok_metrik)

  return { radky, chyba: null, tabulka: CASOPISY_TABULKA }
}

export async function ulozitRokCasopisuDoSupabase(
  detail: CasopisRokDetail
): Promise<{ ok: boolean; chyba: string | null; varovani: string[]; tabulka: string }> {
  const payload: Record<string, unknown> = {
    rok_metrik: detail.rok_metrik,
    nazev: detail.nazev,
    issn: detail.issn,
    eissn: detail.eissn,
    ais_hodnota: detail.ais_hodnota,
    ais_hodnoceni: detail.ais_hodnoceni,
    ais_kvartal: detail.ais_kvartal,
    ais_decil: detail.ais_decil,
    ais_percentil: detail.ais_percentil,
    jif_hodnota: detail.jif_hodnota,
    jif_hodnoceni: detail.jif_hodnoceni,
    jif_kvartal: detail.jif_kvartal,
    jif_decil: detail.jif_decil,
    jif_percentil: detail.jif_percentil,
    manual_uprava: true,
  }

  const result = await adaptivniUpsert(CASOPISY_TABULKA, payload)
  return {
    ok: result.ok,
    chyba: result.ok ? null : (result.chyba ?? 'Nepodařilo se uložit úpravu.'),
    varovani: result.varovani,
    tabulka: CASOPISY_TABULKA,
  }
}
