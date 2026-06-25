/**
 * DKRVO Kalkulačka — Import mapper pro výsledky B (knihy) a C (kapitoly)
 * B: Rozšíření LiF = 'B_Odborná kniha'
 * C: Rozšíření LiF = 'C_kapitola v odborné knize'
 * Obě kategorie jsou v jednom XLSX souboru.
 * Kapitoly (C) se párují s knihami (B) přes ISBN.
 */

import * as XLSX from 'xlsx'
import { parseAutory } from './importJimp'
import type { AutorParsed } from './importJimp'

// ─── Typy ───────────────────────────────────────────────────

export interface BRadekParsed {
  obd_id: string
  rok: number
  stav: string
  nazev: string
  vydavatel_raw: string
  isbn: string | null
  misto_vydani: string | null
  vydani: string | null
  pocet_stran: number | null
  stav_oa: string | null
  dedikace_raw: string | null
  riv_id: string | null
  doi_urls: string[]
  autori: AutorParsed[]
  chyby: string[]
  varovani: string[]
}

export interface CRadekParsed {
  obd_id: string
  rok: number
  stav: string
  nazev: string
  kniha_isbn: string | null      // ISBN mateřské knihy → párování s B
  kniha_nazev_raw: string        // Název zdroje = název knihy
  vydavatel_raw: string
  misto_vydani: string | null
  strany_raw: string | null      // "1-21" nebo "138-176"
  strany_od: number | null
  strany_do: number | null
  pocet_stran_kapitoly: number | null
  podil_stran: number | null     // vypočteno pokud známe pocet_stran knihy
  dedikace_raw: string | null
  riv_id: string | null
  doi_urls: string[]
  autori: AutorParsed[]
  chyby: string[]
  varovani: string[]
}

export interface ImportVysledekBC {
  knihy: BRadekParsed[]
  kapitoly: CRadekParsed[]
  knihy_ok: number
  knihy_chyby: number
  kapitoly_ok: number
  kapitoly_chyby: number
  nespárovane_kapitoly: string[] // ISBN kapitol bez nalezené knihy
  preskocene: number
  kriticke_chyby: string[]
}

// ─── Pomocné funkce ─────────────────────────────────────────

function parseUrls(raw: string): string[] {
  if (!raw?.trim()) return []
  return raw.split(',').map(u => u.trim()).filter(u => u.startsWith('http'))
}

function normalizeISBN(raw: string): string | null {
  const cleaned = raw?.trim().replace(/[\s-]/g, '')
  if (!cleaned) return null
  if (cleaned.length !== 10 && cleaned.length !== 13) return null
  return cleaned
}

function parseStrany(raw: string): { od: number | null; do: number | null } {
  if (!raw?.trim()) return { od: null, do: null }
  // Formát "1-21" nebo "138-176" nebo "955-961"
  const match = raw.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/)
  if (!match) return { od: null, do: null }
  return { od: parseInt(match[1], 10), do: parseInt(match[2], 10) }
}

// ─── Parsování B (kniha) ────────────────────────────────────

export function parseRadekB(radek: Record<string, string>, cisloRadku: number): BRadekParsed {
  const chyby: string[] = []
  const varovani: string[] = []

  const obd_id = radek['ID']?.trim()
  if (!obd_id) chyby.push(`Řádek ${cisloRadku}: chybí OBD ID`)

  const rok = parseInt(radek['Rok publikace']?.trim(), 10)
  if (isNaN(rok) || rok < 2000 || rok > 2100) chyby.push(`OBD ${obd_id}: neplatný rok`)

  const isbn = normalizeISBN(radek['ISBN:'])
  if (!isbn) varovani.push(`OBD ${obd_id}: chybí nebo neplatné ISBN`)

  const vydavatel_raw = radek['Vydavatel']?.trim() || ''
  if (!vydavatel_raw) varovani.push(`OBD ${obd_id}: chybí vydavatel`)

  const pocet_stran_raw = radek['Počet stran']?.trim()
  const pocet_stran = pocet_stran_raw ? parseInt(pocet_stran_raw, 10) : null
  if (!pocet_stran) varovani.push(`OBD ${obd_id}: chybí počet stran — výpočet podílu pro kapitoly nebude možný`)

  const autori = parseAutory(radek['Autoři'])
  if (autori.length === 0) chyby.push(`OBD ${obd_id}: nelze parsovat pole Autoři`)
  if (autori.filter(a => !a.externi).length === 0) varovani.push(`OBD ${obd_id}: žádný interní autor`)

  const typFin = radek['Typ financování']?.trim()
  const cisloFin = radek['Číslo financování']?.trim()

  return {
    obd_id,
    rok,
    stav: radek['Stav']?.trim() || '',
    nazev: radek['Titul (v originále)']?.trim() || '',
    vydavatel_raw,
    isbn,
    misto_vydani: radek['Místo publikace']?.trim() || null,
    vydani: radek['Vydání']?.trim() || null,
    pocet_stran: isNaN(pocet_stran!) ? null : pocet_stran,
    stav_oa: radek['Dostupnost']?.trim() || null,
    dedikace_raw: [typFin, cisloFin].filter(Boolean).join(' | ') || null,
    riv_id: radek['RIV ID']?.trim() || null,
    doi_urls: parseUrls(radek['Odkazy']),
    autori,
    chyby,
    varovani,
  }
}

// ─── Parsování C (kapitola) ─────────────────────────────────

export function parseRadekC(
  radek: Record<string, string>,
  cisloRadku: number,
  knihyMap: Map<string, BRadekParsed>  // ISBN → kniha (pro výpočet podílu)
): CRadekParsed {
  const chyby: string[] = []
  const varovani: string[] = []

  const obd_id = radek['ID']?.trim()
  if (!obd_id) chyby.push(`Řádek ${cisloRadku}: chybí OBD ID`)

  const rok = parseInt(radek['Rok publikace']?.trim(), 10)
  if (isNaN(rok) || rok < 2000 || rok > 2100) chyby.push(`OBD ${obd_id}: neplatný rok`)

  const kniha_isbn = normalizeISBN(radek['ISBN:'])
  if (!kniha_isbn) varovani.push(`OBD ${obd_id}: chybí ISBN mateřské knihy — párování s B nebude možné`)

  const vydavatel_raw = radek['Vydavatel']?.trim() || ''
  if (!vydavatel_raw) varovani.push(`OBD ${obd_id}: chybí vydavatel`)

  // Strany kapitoly
  const strany_raw = radek['Strany']?.trim() || null
  const { od: strany_od, do: strany_do } = parseStrany(strany_raw ?? '')

  // Počet stran kapitoly (samostatné pole)
  const pocet_stran_raw = radek['Počet stran']?.trim()
  const pocet_stran_kapitoly = pocet_stran_raw ? parseInt(pocet_stran_raw, 10) : null

  // Výpočet podílu stran pokud víme počet stran knihy
  let podil_stran: number | null = null
  if (kniha_isbn && knihyMap.has(kniha_isbn)) {
    const kniha = knihyMap.get(kniha_isbn)!
    if (kniha.pocet_stran && pocet_stran_kapitoly) {
      podil_stran = pocet_stran_kapitoly / kniha.pocet_stran
    }
  } else if (kniha_isbn) {
    varovani.push(`OBD ${obd_id}: kniha s ISBN ${kniha_isbn} není v importu — podíl stran nelze vypočítat`)
  }

  const autori = parseAutory(radek['Autoři'])
  if (autori.length === 0) chyby.push(`OBD ${obd_id}: nelze parsovat pole Autoři`)
  if (autori.filter(a => !a.externi).length === 0) varovani.push(`OBD ${obd_id}: žádný interní autor`)

  const typFin = radek['Typ financování']?.trim()
  const cisloFin = radek['Číslo financování']?.trim()

  return {
    obd_id,
    rok,
    stav: radek['Stav']?.trim() || '',
    nazev: radek['Titul (v originále)']?.trim() || '',
    kniha_isbn,
    kniha_nazev_raw: radek['Název zdroje']?.trim() || '',
    vydavatel_raw,
    misto_vydani: radek['Místo publikace']?.trim() || null,
    strany_raw,
    strany_od,
    strany_do,
    pocet_stran_kapitoly: isNaN(pocet_stran_kapitoly!) ? null : pocet_stran_kapitoly,
    podil_stran,
    dedikace_raw: [typFin, cisloFin].filter(Boolean).join(' | ') || null,
    riv_id: radek['RIV ID']?.trim() || null,
    doi_urls: parseUrls(radek['Odkazy']),
    autori,
    chyby,
    varovani,
  }
}

// ─── Parsování celého XLSX ──────────────────────────────────

export function parseXlsxBC(buffer: ArrayBuffer): ImportVysledekBC {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const radky = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
  })

  const knihy: BRadekParsed[] = []
  const kapitoly_raw: { radek: Record<string, string>; cislo: number }[] = []
  let preskocene = 0
  const kriticke_chyby: string[] = []

  // První průchod — načti všechny knihy B
  for (let i = 0; i < radky.length; i++) {
    const obj = radky[i]
    const lif = obj['Rozšíření LiF']?.trim()

    if (lif?.startsWith('B_')) {
      try {
        knihy.push(parseRadekB(obj, i + 2))
      } catch (err) {
        kriticke_chyby.push(`Řádek ${i + 2} (B): ${err}`)
        preskocene++
      }
    } else if (lif?.startsWith('C_')) {
      kapitoly_raw.push({ radek: obj, cislo: i + 2 })
    } else {
      preskocene++
    }
  }

  // Sestav mapu ISBN → kniha pro párování kapitol
  const knihyMap = new Map<string, BRadekParsed>()
  for (const k of knihy) {
    if (k.isbn) knihyMap.set(k.isbn, k)
  }

  // Druhý průchod — parsuj kapitoly C s přístupem k mapě knih
  const kapitoly: CRadekParsed[] = []
  for (const { radek, cislo } of kapitoly_raw) {
    try {
      kapitoly.push(parseRadekC(radek, cislo, knihyMap))
    } catch (err) {
      kriticke_chyby.push(`Řádek ${cislo} (C): ${err}`)
      preskocene++
    }
  }

  // Nespárované kapitoly
  const nespárovane_kapitoly = kapitoly
    .filter(c => c.kniha_isbn && !knihyMap.has(c.kniha_isbn))
    .map(c => `${c.obd_id}: ISBN ${c.kniha_isbn} (${c.kniha_nazev_raw.substring(0, 40)})`)

  return {
    knihy,
    kapitoly,
    knihy_ok: knihy.filter(k => k.chyby.length === 0).length,
    knihy_chyby: knihy.filter(k => k.chyby.length > 0).length,
    kapitoly_ok: kapitoly.filter(c => c.chyby.length === 0).length,
    kapitoly_chyby: kapitoly.filter(c => c.chyby.length > 0).length,
    nespárovane_kapitoly,
    preskocene,
    kriticke_chyby,
  }
}
