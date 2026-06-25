/**
 * DKRVO Kalkulačka — Import mapper pro výsledky JSc
 * Formát exportu z OBD je identický s JIMP, liší se Rozšíření LiF = 'Jsc'
 * a párování jde přes vydavatele (ne časopis)
 */

import * as XLSX from 'xlsx'
import { parseAutory, AutorParsed } from './importJimp'

export interface JscRadekParsed {
  obd_id: string
  rok: number
  stav: string
  nazev: string
  vydavatel_raw: string        // klíč pro párování s tabulkou vydavatele
  issn: string | null
  eissn: string | null
  isbn: string | null
  rocnik: string | null
  cislo: string | null
  strany: string | null
  stav_oa: string | null
  dedikace_raw: string | null
  riv_id: string | null
  doi_urls: string[]
  autori: AutorParsed[]
  chyby: string[]
  varovani: string[]
}

export interface ImportVysledekJsc {
  celkem: number
  ok: number
  s_chybami: number
  preskocene: number
  radky: JscRadekParsed[]
  kriticke_chyby: string[]
}

function parseUrls(raw: string): string[] {
  if (!raw?.trim()) return []
  return raw.split(',').map(u => u.trim()).filter(u => u.startsWith('http'))
}

function normalizeISSN(raw: string): string | null {
  const cleaned = raw?.trim().replace(/\s+/g, '')
  if (!cleaned) return null
  if (!/^\d{4}-[\dXx]{4}$/.test(cleaned)) return null
  return cleaned.toUpperCase()
}

function normalizeISBN(raw: string): string | null {
  const cleaned = raw?.trim().replace(/[\s-]/g, '')
  if (!cleaned) return null
  if (cleaned.length !== 10 && cleaned.length !== 13) return null
  return cleaned
}

export function parseRadekJsc(radek: Record<string, string>, cisloRadku: number): JscRadekParsed {
  const chyby: string[] = []
  const varovani: string[] = []

  const obd_id = radek['ID']?.trim()
  if (!obd_id) chyby.push(`Řádek ${cisloRadku}: chybí OBD ID`)

  const rok = parseInt(radek['Rok publikace']?.trim(), 10)
  if (isNaN(rok) || rok < 2000 || rok > 2100) {
    chyby.push(`OBD ${obd_id}: neplatný rok`)
  }

  const vydavatel_raw = radek['Vydavatel']?.trim() || ''
  if (!vydavatel_raw) {
    varovani.push(`OBD ${obd_id}: chybí vydavatel — nelze spárovat`)
  }

  const autori = parseAutory(radek['Autoři'])
  if (autori.length === 0) chyby.push(`OBD ${obd_id}: nelze parsovat pole Autoři`)
  if (autori.filter(a => !a.externi).length === 0) {
    varovani.push(`OBD ${obd_id}: žádný interní autor`)
  }

  const typFin = radek['Typ financování']?.trim()
  const cisloFin = radek['Číslo financování']?.trim()

  return {
    obd_id,
    rok,
    stav: radek['Stav']?.trim() || '',
    nazev: radek['Titul (v originále)']?.trim() || '',
    vydavatel_raw,
    issn: normalizeISSN(radek['ISSN:']),
    eissn: normalizeISSN(radek['e-ISSN:']),
    isbn: normalizeISBN(radek['ISBN:']),
    rocnik: radek['Ročník']?.trim() || null,
    cislo: radek['Číslo/kód']?.trim() || null,
    strany: radek['Strany']?.trim() || null,
    stav_oa: radek['Dostupnost']?.trim() || null,
    dedikace_raw: [typFin, cisloFin].filter(Boolean).join(' | ') || null,
    riv_id: radek['RIV ID']?.trim() || null,
    doi_urls: parseUrls(radek['Odkazy']),
    autori,
    chyby,
    varovani,
  }
}

export function parseXlsxJsc(buffer: ArrayBuffer): ImportVysledekJsc {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const radky = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
  })

  const parsovane: JscRadekParsed[] = []
  let preskocene = 0
  const kriticke_chyby: string[] = []

  for (let i = 0; i < radky.length; i++) {
    const obj = radky[i]
    const lif = obj['Rozšíření LiF']?.trim()

    // Přeskoč řádky které nejsou Jsc
    if (lif && lif !== 'Jsc') { preskocene++; continue }

    try {
      parsovane.push(parseRadekJsc(obj, i + 2))
    } catch (err) {
      kriticke_chyby.push(`Řádek ${i + 2}: ${err}`)
      preskocene++
    }
  }

  return {
    celkem: parsovane.length,
    ok: parsovane.filter(r => r.chyby.length === 0).length,
    s_chybami: parsovane.filter(r => r.chyby.length > 0).length,
    preskocene,
    radky: parsovane,
    kriticke_chyby,
  }
}
