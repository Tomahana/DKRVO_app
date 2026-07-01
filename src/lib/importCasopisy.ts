import * as XLSX from 'xlsx'
import { supabase } from './supabase'

export interface CasopisRadek {
  nazev: string
  issn: string | null
  eissn: string | null
  kategorie: string | null
  ais_hodnota: number | null
  ais_kvartal: string | null
  jif_hodnota: number | null
  jif_kvartal: string | null
  jif_percentil: number | null
}

export interface ImportVysledekCasopisy {
  radky: CasopisRadek[]
  celkem_radku: number
  validnich_radku: number
  detekovany_rok: number | null
  varovani: string[]
}

const CASOPISY_TABULKA = import.meta.env.VITE_SUPABASE_CASOPISY_TABLE ?? 'casopisy'

function parseCislo(raw: string): number | null {
  const txt = String(raw ?? '').trim()
  if (!txt) return null
  if (txt.toUpperCase() === 'N/A') return null
  const cislo = Number.parseFloat(txt.replace(',', '.'))
  return Number.isFinite(cislo) ? cislo : null
}

function normalizeIssn(raw: string): string | null {
  const txt = String(raw ?? '').trim().replace(/\s+/g, '')
  if (!txt) return null
  if (txt.toUpperCase() === 'N/A') return null
  return txt.toUpperCase()
}

function normalizeQuartile(raw: string): string | null {
  const txt = String(raw ?? '').trim().toUpperCase()
  if (!txt || txt === 'N/A') return null
  return /^Q[1-4]$/.test(txt) ? txt : null
}

function parseCsvLine(line: string): string[] {
  const bunky: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      const escaped = inQuotes && line[i + 1] === '"'
      if (escaped) {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      bunky.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  bunky.push(current.trim())
  return bunky
}

function normalizeHeader(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/;/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

interface SloupceMap {
  nazev: number
  issn: number | null
  eissn: number | null
  kategorie: number | null
  ais: number | null
  ais_q: number | null
  jif: number | null
  jif_q: number | null
  jif_p: number | null
}

function mapujSloupce(hlavicka: string[]): SloupceMap | null {
  const normalized = hlavicka.map(normalizeHeader)
  const najdi = (...moznosti: string[]): number => {
    for (const m of moznosti) {
      const idx = normalized.findIndex((h) => h.includes(m))
      if (idx >= 0) return idx
    }
    return -1
  }

  const jifRokovyIdx = normalized.findIndex((h) => /\b20\d{2}\s*jif\b/.test(h))
  const nazev = najdi('journal name', 'název', 'nazev')
  if (nazev < 0) return null

  return {
    nazev,
    issn: (() => {
      const idx = najdi('issn')
      return idx >= 0 ? idx : null
    })(),
    eissn: (() => {
      const idx = najdi('eissn', 'e-issn')
      return idx >= 0 ? idx : null
    })(),
    kategorie: (() => {
      const idx = najdi('category', 'kategorie')
      return idx >= 0 ? idx : null
    })(),
    ais: (() => {
      const idx = najdi('article influence score', 'ais')
      return idx >= 0 ? idx : null
    })(),
    ais_q: (() => {
      const idx = najdi('ais quartile', 'ais kvartil', 'ais kvartal')
      return idx >= 0 ? idx : null
    })(),
    jif: jifRokovyIdx >= 0
      ? jifRokovyIdx
      : (() => {
          const idx = najdi('journal impact factor', ' jif', 'jif ')
          return idx >= 0 ? idx : null
        })(),
    jif_q: (() => {
      const idx = najdi('jif quartile', 'jif kvartil', 'jif kvartal')
      return idx >= 0 ? idx : null
    })(),
    jif_p: (() => {
      const idx = najdi('jif percentile', 'jif percentil')
      return idx >= 0 ? idx : null
    })(),
  }
}

function detekujRok(rows: string[][], hlavicka: string[]): number | null {
  for (const row of rows.slice(0, 5)) {
    const text = row.join(' ')
    const selectedYear = text.match(/selected jcr year:\s*(20\d{2})/i)
    if (selectedYear) {
      const rok = Number.parseInt(selectedYear[1], 10)
      if (Number.isFinite(rok)) return rok
    }
  }
  for (const h of hlavicka) {
    const match = h.match(/\b(20\d{2})\s*jif\b/i) ?? h.match(/\bjif\s*(20\d{2})\b/i)
    if (match) {
      const rok = Number.parseInt(match[1], 10)
      if (Number.isFinite(rok)) return rok
    }
  }
  return null
}

function parseLegacyCsvLine(line: string): string[] {
  const ocisteny = line
    .trim()
    .replace(/^"/, '')
    .replace(/[",;\s]+$/, '')

  return ocisteny
    .split(',""')
    .map((part) => part.replace(/""$/g, '').replace(/""/g, '"').trim())
}

function parseMatici(rawRows: string[][]): ImportVysledekCasopisy {
  const varovani: string[] = []
  const rows = rawRows.filter((row) => row.some((v) => String(v ?? '').trim() !== ''))
  if (rows.length === 0) {
    return { radky: [], celkem_radku: 0, validnich_radku: 0, detekovany_rok: null, varovani: ['Soubor je prázdný.'] }
  }

  const hlavickaIdx = rows.findIndex((row) => row.some((v) => normalizeHeader(v).includes('journal name') || normalizeHeader(v).includes('nazev')))
  if (hlavickaIdx < 0) {
    return {
      radky: [],
      celkem_radku: 0,
      validnich_radku: 0,
      detekovany_rok: null,
      varovani: ['Nepodařilo se najít hlavičku se sloupcem názvu časopisu (Journal Name/Název).'],
    }
  }

  const hlavicka = rows[hlavickaIdx].map((v) => String(v ?? '').trim())
  const mapa = mapujSloupce(hlavicka)
  if (!mapa) {
    return {
      radky: [],
      celkem_radku: 0,
      validnich_radku: 0,
      detekovany_rok: null,
      varovani: ['Nepodařilo se namapovat povinné sloupce.'],
    }
  }

  const dataRows = rows.slice(hlavickaIdx + 1)
  const detekovany_rok = detekujRok(rows, hlavicka)
  const parsed: CasopisRadek[] = []
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i]
    const nazev = String(r[mapa.nazev] ?? '').trim()
    if (!nazev) continue
    parsed.push({
      nazev,
      issn: mapa.issn === null ? null : normalizeIssn(String(r[mapa.issn] ?? '')),
      eissn: mapa.eissn === null ? null : normalizeIssn(String(r[mapa.eissn] ?? '')),
      kategorie: mapa.kategorie === null ? null : (String(r[mapa.kategorie] ?? '').trim() || null),
      ais_hodnota: mapa.ais === null ? null : parseCislo(String(r[mapa.ais] ?? '')),
      ais_kvartal: mapa.ais_q === null ? null : normalizeQuartile(String(r[mapa.ais_q] ?? '')),
      jif_hodnota: mapa.jif === null ? null : parseCislo(String(r[mapa.jif] ?? '')),
      jif_kvartal: mapa.jif_q === null ? null : normalizeQuartile(String(r[mapa.jif_q] ?? '')),
      jif_percentil: mapa.jif_p === null ? null : parseCislo(String(r[mapa.jif_p] ?? '')),
    })
  }

  if (parsed.length === 0) {
    varovani.push('Po načtení nebyl nalezen žádný validní řádek s názvem časopisu.')
  }

  return {
    radky: parsed,
    celkem_radku: dataRows.length,
    validnich_radku: parsed.length,
    detekovany_rok,
    varovani,
  }
}

export function parseCasopisyCsv(text: string): ImportVysledekCasopisy {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const sample = lines.find((line) => line.length > 0) ?? ''
  const legacy = sample.startsWith('"') && sample.includes(',""')
  const rows = lines.map((line) => legacy ? parseLegacyCsvLine(line) : parseCsvLine(line))
  return parseMatici(rows)
}

export function parseCasopisyXlsx(buffer: ArrayBuffer): ImportVysledekCasopisy {
  try {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    })
      .map((row) => row.map((v) => String(v ?? '').trim()))
    return parseMatici(rows)
  } catch (error) {
    return {
      radky: [],
      celkem_radku: 0,
      validnich_radku: 0,
      detekovany_rok: null,
      varovani: [`XLSX chyba: ${String(error)}`],
    }
  }
}

function normalizeDbError(message: string): string {
  if (message.includes('Could not find the table')) {
    return `Tabulka ${CASOPISY_TABULKA} neexistuje. Spusť SQL skript sql/setup_casopisy.sql v Supabase.`
  }
  if (message.includes('row-level security policy')) {
    return 'Uživatel nemá právo vkládat data (RLS). Zkontroluj policy pro roli authenticated.'
  }
  if (message.includes('no unique or exclusion constraint')) {
    return 'Chybí unique index pro upsert. Spusť SQL skript sql/setup_casopisy.sql.'
  }
  return message
}

export async function ulozitCasopisyDoSupabase(
  radky: CasopisRadek[],
  rokPlatnosti: number,
  zdrojSoubor: string
): Promise<{ ok: boolean; ulozeno: number; chyba: string | null; tabulka: string }> {
  if (!supabase) {
    return { ok: false, ulozeno: 0, chyba: 'Supabase není nakonfigurovaný.', tabulka: CASOPISY_TABULKA }
  }
  if (!Number.isFinite(rokPlatnosti) || rokPlatnosti < 1900 || rokPlatnosti > 2100) {
    return { ok: false, ulozeno: 0, chyba: 'Rok platnosti musí být mezi 1900 a 2100.', tabulka: CASOPISY_TABULKA }
  }

  const dedup = new Map<string, CasopisRadek>()
  for (const r of radky) {
    const key = `${rokPlatnosti}|${r.issn ?? ''}|${r.eissn ?? ''}|${r.nazev.toLowerCase()}`
    dedup.set(key, r)
  }

  const payload = Array.from(dedup.values()).map((r) => ({
    rok_platnosti: rokPlatnosti,
    nazev: r.nazev,
    issn: r.issn ?? '',
    eissn: r.eissn ?? '',
    kategorie: r.kategorie,
    ais_hodnota: r.ais_hodnota,
    ais_kvartal: r.ais_kvartal,
    jif_hodnota: r.jif_hodnota,
    jif_kvartal: r.jif_kvartal,
    jif_percentil: r.jif_percentil,
    zdroj_soubor: zdrojSoubor,
  }))

  if (payload.length === 0) {
    return { ok: false, ulozeno: 0, chyba: 'Není co uložit.', tabulka: CASOPISY_TABULKA }
  }

  const { error } = await supabase
    .from(CASOPISY_TABULKA)
    .upsert(payload, { onConflict: 'rok_platnosti,issn,eissn,nazev' })

  if (error) {
    return {
      ok: false,
      ulozeno: 0,
      chyba: normalizeDbError(error.message),
      tabulka: CASOPISY_TABULKA,
    }
  }

  return {
    ok: true,
    ulozeno: payload.length,
    chyba: null,
    tabulka: CASOPISY_TABULKA,
  }
}
