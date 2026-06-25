/**
 * DKRVO Kalkulačka — Import mapper pro výsledky JIMP
 * Parsuje TSV export z OBD a připraví data pro Supabase
 */

import * as XLSX from 'xlsx'

export interface OBDRadekJimp {
  ID: string
  Stav: string
  'Literární forma': string
  'Rozšíření LiF': string
  'Titul (v originále)': string
  'Autoři': string
  'Rok publikace': string
  'Název zdroje': string
  'Číslo/kód': string
  'ISSN:': string
  'ISBN:': string
  'e-ISSN:': string
  'Náz.zdr.zkráceně': string
  'Vydavatel': string
  'Ročník': string
  'Strany': string
  'Dostupnost': string
  'Odkazy': string
  'Jazyk (originál)': string
  'SCI': string
  'Typ financování': string
  'Číslo financování': string
  'Počet stran': string
  'Kód UT ISI': string
  'RIV ID': string
  [key: string]: string
}

export interface AutorParsed {
  autor_raw: string
  jmeno_raw: string
  pracoviste_kod_raw: string
  externi: boolean
  poradi_autora: number
}

export interface JimpRadekParsed {
  obd_id: string
  rok: number
  stav: string
  nazev: string
  casopis_nazev_raw: string
  casopis_nazev_zkracene: string
  issn: string | null
  eissn: string | null
  rocnik: string | null
  cislo: string | null
  strany: string | null
  wos_ut: string | null
  databaze_sci: string | null
  stav_oa: string | null
  dedikace_raw: string | null
  riv_id: string | null
  doi_urls: string[]
  autori: AutorParsed[]
  chyby: string[]
  varovani: string[]
}

export interface ImportVysledek {
  celkem: number
  ok: number
  s_chybami: number
  preskocene: number
  radky: JimpRadekParsed[]
  kriticke_chyby: string[]
}

export function parseAutory(raw: string): AutorParsed[] {
  if (!raw?.trim()) return []
  const segmenty = raw.split(';').map(s => s.trim()).filter(Boolean)
  const autori: AutorParsed[] = []
  for (let i = 0; i < segmenty.length; i++) {
    const seg = segmenty[i]
    const match = seg.match(/^(.+?)\s*\(Prac\.:\s*(\d*)\s*\)/)
    if (!match) {
      autori.push({ autor_raw: seg, jmeno_raw: seg, pracoviste_kod_raw: '', externi: true, poradi_autora: i + 1 })
      continue
    }
    const jmeno_raw = match[1].trim()
    const pracoviste_kod_raw = match[2].trim()
    autori.push({ autor_raw: seg, jmeno_raw, pracoviste_kod_raw, externi: pracoviste_kod_raw === '', poradi_autora: i + 1 })
  }
  return autori
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

export function parseRadekJimp(radek: OBDRadekJimp, cisloRadku: number): JimpRadekParsed {
  const chyby: string[] = []
  const varovani: string[] = []
  const obd_id = radek['ID']?.trim()
  if (!obd_id) chyby.push(`Řádek ${cisloRadku}: chybí OBD ID`)
  const rok = parseInt(radek['Rok publikace']?.trim(), 10)
  if (isNaN(rok) || rok < 2000 || rok > 2100) chyby.push(`OBD ${obd_id}: neplatný rok`)
  const issn = normalizeISSN(radek['ISSN:'])
  const eissn = normalizeISSN(radek['e-ISSN:'])
  if (!issn && !eissn) varovani.push(`OBD ${obd_id}: chybí ISSN i eISSN`)
  const autori = parseAutory(radek['Autoři'])
  if (autori.length === 0) chyby.push(`OBD ${obd_id}: nelze parsovat pole Autoři`)
  if (autori.filter(a => !a.externi).length === 0) varovani.push(`OBD ${obd_id}: žádný interní autor`)
  const sciRaw = radek['SCI']?.trim().replace(/;$/, '').trim()
  const sciMap: Record<string, string> = { 'I': 'SCI', 'II': 'SSCI', 'III': 'A&HCI' }
  const typFin = radek['Typ financování']?.trim()
  const cisloFin = radek['Číslo financování']?.trim()
  return {
    obd_id,
    rok,
    stav: radek['Stav']?.trim() || '',
    nazev: radek['Titul (v originále)']?.trim() || '',
    casopis_nazev_raw: radek['Název zdroje']?.trim() || '',
    casopis_nazev_zkracene: radek['Náz.zdr.zkráceně']?.trim() || '',
    issn,
    eissn,
    rocnik: radek['Ročník']?.trim() || null,
    cislo: radek['Číslo/kód']?.trim() || null,
    strany: radek['Strany']?.trim() || null,
    wos_ut: radek['Kód UT ISI']?.trim() || null,
    databaze_sci: sciMap[sciRaw] ?? (sciRaw || null),
    stav_oa: radek['Dostupnost']?.trim() || null,
    dedikace_raw: [typFin, cisloFin].filter(Boolean).join(' | ') || null,
    riv_id: radek['RIV ID']?.trim() || null,
    doi_urls: parseUrls(radek['Odkazy']),
    autori,
    chyby,
    varovani,
  }
}

export function parseTsvJimp(tsv: string): ImportVysledek {
  const radky = tsv.split('\n').filter(r => r.trim())
  if (radky.length < 2) {
    return { celkem: 0, ok: 0, s_chybami: 0, preskocene: 0, radky: [], kriticke_chyby: ['Soubor neobsahuje žádná data'] }
  }
  const hlavicka = radky[0].split('\t').map(h => h.trim())
  const parsovane: JimpRadekParsed[] = []
  let preskocene = 0
  const kriticke_chyby: string[] = []
  for (let i = 1; i < radky.length; i++) {
    const hodnoty = radky[i].split('\t')
    if (hodnoty.every(h => !h.trim())) { preskocene++; continue }
    const obj: Record<string, string> = {}
    hlavicka.forEach((klic, idx) => { obj[klic] = hodnoty[idx] ?? '' })
    if (obj['Rozšíření LiF']?.trim() && obj['Rozšíření LiF']?.trim() !== 'Jimp') { preskocene++; continue }
    try {
      parsovane.push(parseRadekJimp(obj as OBDRadekJimp, i + 1))
    } catch (err) {
      kriticke_chyby.push(`Řádek ${i + 1}: ${err}`)
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

export function parseXlsxJimp(buffer: ArrayBuffer): ImportVysledek {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const radky = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
  })

  const parsovane: JimpRadekParsed[] = []
  let preskocene = 0
  const kriticke_chyby: string[] = []

  for (let i = 0; i < radky.length; i++) {
    const obj = radky[i]
    if (obj['Rozšíření LiF']?.trim() && obj['Rozšíření LiF']?.trim() !== 'Jimp') {
      preskocene++
      continue
    }
    try {
      parsovane.push(parseRadekJimp(obj as OBDRadekJimp, i + 2))
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
