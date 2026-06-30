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
  nejlepsi_jif_kvartal: string | null
  nejlepsi_jif_percentil: number | null
}

export interface ImportVysledekJCR {
  rok_metrik: number
  celkem_radku: number
  unikatnich_casopisu: number
  radky: JCRRadekRozsireny[]
  kriticke_chyby: string[]
  varovani: string[]

  // zpětná kompatibilita pro existující UI
  celkem: number
  ok: number
  s_chybami: number
  preskocene: number
}

interface SloupceMap {
  nazev: number
  issn: number
  eissn: number
  kategorie: number
  vydani: number | null
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
  // Normalizuj — lowercase, odstraň středníky a přebytečné mezery
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
    vydani: najdi('edition') >= 0 ? najdi('edition') : null,
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
  // 1) Rok přímo v názvu sloupce, např. "2020 JIF"
  for (const sloupec of hlavicka) {
    const match = sloupec.match(/\b(20\d{2})\s*(?:jif|ais)\b/i)
      ?? sloupec.match(/\b(?:jif|ais)\s*(20\d{2})\b/i)
    if (match) {
      const rok = Number.parseInt(match[1], 10)
      if (Number.isFinite(rok)) return rok
    }
  }

  // 2) Rok v samostatném sloupci "AIS Year" nebo "JIF Year"
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

  // 3) Fallback z textu před hlavičkou
  return parseRokText(prvniRadekText) ?? 0
}

function parseRadek(bunky: string[], mapa: SloupceMap): JCRRadek | null {
  const nazev = (bunky[mapa.nazev] ?? '').trim()
  if (!nazev) return null

  const issn = mapa.issn >= 0 ? normalizeIssn(bunky[mapa.issn] ?? '') : null
  const eissn = mapa.eissn >= 0 ? normalizeIssn(bunky[mapa.eissn] ?? '') : null
  const kategorie = mapa.kategorie >= 0 ? parseKategorie(bunky[mapa.kategorie] ?? '') : []

  const ais_hodnota = mapa.ais !== null ? parseCislo(bunky[mapa.ais] ?? '') : null
  const ais_kvartal = mapa.ais_q !== null ? normalizeQuartile(bunky[mapa.ais_q] ?? '') : null
  const jif_hodnota = mapa.jif >= 0 ? parseCislo(bunky[mapa.jif] ?? '') : null
  const jif_kvartal = mapa.jif_q !== null ? normalizeQuartile(bunky[mapa.jif_q] ?? '') : null
  const jif_percentil = mapa.jif_p !== null ? parseCislo(bunky[mapa.jif_p] ?? '') : null

  return {
    nazev,
    issn,
    eissn,
    kategorie,
    ais_hodnota,
    ais_kvartal,
    jif_hodnota,
    jif_kvartal,
    jif_percentil,
  }
}

export function parseJCRCsv(text: string, rokOverride?: number): ImportVysledekJCR {
  const kriticke_chyby: string[] = []
  const varovani: string[] = []

  const radky = text.split(/\r?\n/).filter((r) => r.trim())

  // Najdi hlavičkový řádek
  let hlavickaIdx = -1
  const prvniRadekText = radky[0] ?? ''

  for (let i = 0; i < Math.min(radky.length, 5); i++) {
    if (radky[i].toLowerCase().includes('journal name')) {
      hlavickaIdx = i
      break
    }
  }

  if (hlavickaIdx < 0) {
    return {
      rok_metrik: rokOverride ?? 0,
      celkem_radku: 0,
      unikatnich_casopisu: 0,
      radky: [],
      kriticke_chyby: ['CSV: nenalezen hlavičkový řádek'],
      varovani: [],
      celkem: 0,
      ok: 0,
      s_chybami: 0,
      preskocene: 0,
    }
  }

  const vzorkovyRadek = radky[hlavickaIdx + 1] ?? ''
  const jeStaryFormat = vzorkovyRadek.startsWith('"') && vzorkovyRadek.includes('""')

  function parseStaryRadek(radek: string): string[] {
    const ocisteny = radek
      .trim()
      .replace(/^"/, '')
      .replace(/[",;\s]+$/, '')

    const parts = ocisteny.split(',""')
    const bunky: string[] = []

    for (let i = 0; i < parts.length; i++) {
      const val = parts[i]
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
        const jeEscaped = inQuotes && radek[i + 1] === '"'
        if (jeEscaped) {
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

  const hlavickaRaw = radky[hlavickaIdx]
  const hlavicka = jeStaryFormat
    ? hlavickaRaw.split(',').map((s) => s.replace(/"/g, '').trim())
    : parseNovyRadek(hlavickaRaw)

  const mapa = mapujSloupce(hlavicka)
  if (!mapa) {
    return {
      rok_metrik: rokOverride ?? 0,
      celkem_radku: 0,
      unikatnich_casopisu: 0,
      radky: [],
      kriticke_chyby: [`CSV: nelze namapovat sloupce. Hlavička: ${hlavicka.slice(0, 6).join(' | ')}`],
      varovani: [],
      celkem: 0,
      ok: 0,
      s_chybami: 0,
      preskocene: 0,
    }
  }

  const dataRows = radky.slice(hlavickaIdx + 1)
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

  const unikatni = new Set(parsovane.map((r) => r.issn ?? r.eissn ?? r.nazev))
  return {
    rok_metrik,
    celkem_radku: parsovane.length,
    unikatnich_casopisu: unikatni.size,
    radky: parsovane,
    kriticke_chyby,
    varovani,
    celkem: parsovane.length,
    ok: parsovane.length,
    s_chybami: 0,
    preskocene: 0,
  }
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
      return {
        rok_metrik: rokOverride ?? 0,
        celkem_radku: 0,
        unikatnich_casopisu: 0,
        radky: [],
        kriticke_chyby: ['XLSX: nenalezen hlavičkový řádek'],
        varovani: [],
        celkem: 0,
        ok: 0,
        s_chybami: 0,
        preskocene: 0,
      }
    }

    const hlavicka = rows[hlavickaIdx]
    const mapa = mapujSloupce(hlavicka)
    if (!mapa) {
      return {
        rok_metrik: rokOverride ?? 0,
        celkem_radku: 0,
        unikatnich_casopisu: 0,
        radky: [],
        kriticke_chyby: ['XLSX: nelze namapovat sloupce'],
        varovani: [],
        celkem: 0,
        ok: 0,
        s_chybami: 0,
        preskocene: 0,
      }
    }

    const dataRows = rows.slice(hlavickaIdx + 1)
    const rok_metrik = rokOverride ?? detekujRokZahlavi(hlavicka, mapa, dataRows[0] ?? null, rows[0]?.join(' ') ?? '')
    const parsovane = dataRows
      .map((r) => parseRadek(r, mapa))
      .filter((r): r is JCRRadek => r !== null)

    const unikatni = new Set(parsovane.map((r) => r.issn ?? r.eissn ?? r.nazev))
    return {
      rok_metrik,
      celkem_radku: parsovane.length,
      unikatnich_casopisu: unikatni.size,
      radky: parsovane,
      kriticke_chyby: [],
      varovani: [],
      celkem: parsovane.length,
      ok: parsovane.length,
      s_chybami: 0,
      preskocene: 0,
    }
  } catch (error) {
    return {
      rok_metrik: rokOverride ?? 0,
      celkem_radku: 0,
      unikatnich_casopisu: 0,
      radky: [],
      kriticke_chyby: [String(error)],
      varovani: [],
      celkem: 0,
      ok: 0,
      s_chybami: 0,
      preskocene: 0,
    }
  }
}

function vypoctiPozici(poradi: number, celkem: number): PozicniMetriky {
  const percentil_pozice = (poradi / celkem) * 100
  const kvartal =
    percentil_pozice <= 25 ? 'Q1' :
      percentil_pozice <= 50 ? 'Q2' :
        percentil_pozice <= 75 ? 'Q3' : 'Q4'
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
  if (hodnoceni === 'D1') {
    return { label: 'D1', cssTrida: 'h-d1', tooltip: 'Top 10% v oboru' }
  }
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
    const hodnocene = indexy
      .filter((idx) => vystup[idx].ais_hodnota !== null)
      .sort((a, b) => (vystup[b].ais_hodnota ?? 0) - (vystup[a].ais_hodnota ?? 0))
    const celkem = hodnocene.length

    for (let idx = 0; idx < hodnocene.length; idx++) {
      const i = hodnocene[idx]
      const pozice = vypoctiPozici(idx + 1, celkem)
      const aktualniScore = HODNOCENI_PORADI[vystup[i].ais_hodnoceni ?? ''] ?? 0
      const noveScore = HODNOCENI_PORADI[pozice.hodnoceni] ?? 0
      if (noveScore >= aktualniScore) {
        vystup[i].ais_poradi = pozice.poradi
        vystup[i].ais_celkem = pozice.celkem
        vystup[i].ais_hodnoceni = pozice.hodnoceni
        vystup[i].ais_kvartal_vypocteny = pozice.kvartal
        vystup[i].ais_decil_vypocteny = pozice.decil
        vystup[i].ais_percentil_vypocteny = pozice.percentil_pozice
      }
    }
  }
  return vystup
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
    const nejlepsiAis = skupina.reduce((best, r) => (r.ais_hodnota ?? -Infinity) > (best.ais_hodnota ?? -Infinity) ? r : best)
    const nejlepsiJif = skupina.reduce((best, r) => (r.jif_hodnota ?? -Infinity) > (best.jif_hodnota ?? -Infinity) ? r : best)

    const nejlepsiHodnoceni = skupina.reduce((best, r) => {
      const h = r.ais_hodnoceni ?? r.ais_kvartal ?? null
      const score = HODNOCENI_PORADI[h ?? ''] ?? 0
      const bestScore = HODNOCENI_PORADI[best ?? ''] ?? 0
      return score > bestScore ? h : best
    }, null as string | null)

    const radekHodnoceni = skupina.find((r) => (r.ais_hodnoceni ?? r.ais_kvartal ?? null) === nejlepsiHodnoceni) ?? null
    const nejlepsiJifKvartal = skupina.reduce((best, r) => {
      const q = r.jif_kvartal ?? null
      const score = HODNOCENI_PORADI[q ?? ''] ?? 0
      const bestScore = HODNOCENI_PORADI[best ?? ''] ?? 0
      return score > bestScore ? q : best
    }, null as string | null)

    return {
      nazev: prvni.nazev,
      issn: prvni.issn,
      eissn: prvni.eissn,
      kategorie: Array.from(new Set(skupina.flatMap((r) => r.kategorie))),
      nejlepsi_ais: nejlepsiAis.ais_hodnota,
      nejlepsi_ais_hodnoceni: nejlepsiHodnoceni,
      nejlepsi_ais_kvartal: radekHodnoceni?.ais_kvartal ?? radekHodnoceni?.ais_kvartal_vypocteny ?? null,
      nejlepsi_ais_decil: radekHodnoceni?.ais_decil_vypocteny ?? null,
      nejlepsi_ais_percentil: radekHodnoceni?.ais_percentil_vypocteny ?? null,
      nejlepsi_ais_poradi: radekHodnoceni?.ais_poradi ?? null,
      nejlepsi_ais_celkem: radekHodnoceni?.ais_celkem ?? null,
      ais_kvartal_zdroj: radekHodnoceni?.ais_kvartal ? 'jcr' : radekHodnoceni?.ais_kvartal_vypocteny ? 'vypocet' : null,
      nejlepsi_jif: nejlepsiJif.jif_hodnota,
      nejlepsi_jif_kvartal: nejlepsiJifKvartal,
      nejlepsi_jif_percentil: nejlepsiJif.jif_percentil,
    }
  })
}

export async function ulozitJCRDoSupabase(
  agregace: CasopisAgregace[],
  rokMetrik: number
): Promise<{ ulozeno: number; chyby: string[]; varovani: string[]; tabulka: string }> {
  const tabulka = import.meta.env.VITE_SUPABASE_CASOPISY_TABLE ?? 'casopisy'
  const chyby: string[] = []
  const varovani: string[] = []
  let ulozeno = 0

  if (!supabase) {
    return {
      ulozeno: 0,
      chyby: ['Supabase není nakonfigurovaný (chybí nebo je neplatné VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).'],
      varovani,
      tabulka,
    }
  }

  for (const r of agregace) {
    const payload: Record<string, unknown> = {
      rok_metrik: rokMetrik,
      nazev: r.nazev,
      issn: r.issn,
      eissn: r.eissn,
      kategorie: r.kategorie,
      ais_hodnota: r.nejlepsi_ais,
      ais_hodnoceni: r.nejlepsi_ais_hodnoceni,
      ais_kvartal: r.nejlepsi_ais_kvartal,
      ais_decil: r.nejlepsi_ais_decil,
      ais_percentil: r.nejlepsi_ais_percentil,
      ais_poradi: r.nejlepsi_ais_poradi,
      ais_celkem: r.nejlepsi_ais_celkem,
      ais_kvartal_zdroj: r.ais_kvartal_zdroj,
      jif_hodnota: r.nejlepsi_jif,
      jif_kvartal: r.nejlepsi_jif_kvartal,
      jif_percentil: r.nejlepsi_jif_percentil,
    }

    // Adaptace payloadu pro tabulky s menším počtem sloupců.
    let finalPayload = { ...payload }
    let adaptacniPokusy = 0
    while (adaptacniPokusy < 15) {
      adaptacniPokusy++
      const conflictCols = ['rok_metrik', 'issn', 'eissn', 'nazev'].filter((c) => c in finalPayload)
      const onConflict = conflictCols.length > 0 ? conflictCols.join(',') : 'nazev'

      const upsertRes = await supabase.from(tabulka).upsert(finalPayload, { onConflict })
      if (!upsertRes.error) {
        ulozeno++
        break
      }

      const missingColMatch = upsertRes.error.message.match(/column ([a-zA-Z0-9_]+) of relation .* does not exist/)
        ?? upsertRes.error.message.match(/Could not find the '([a-zA-Z0-9_]+)' column/)
      if (missingColMatch) {
        const missingCol = missingColMatch[1]
        if (missingCol in finalPayload) {
          delete finalPayload[missingCol]
          varovani.push(`Tabulka ${tabulka} neobsahuje sloupec "${missingCol}" — uloženo bez něj.`)
          continue
        }
      }

      // Fallback pro tabulky bez unique constraint.
      const insertRes = await supabase.from(tabulka).insert(finalPayload)
      if (!insertRes.error) {
        ulozeno++
        break
      }

      const insertMissingCol = insertRes.error.message.match(/column ([a-zA-Z0-9_]+) of relation .* does not exist/)
        ?? insertRes.error.message.match(/Could not find the '([a-zA-Z0-9_]+)' column/)
      if (insertMissingCol) {
        const missingCol = insertMissingCol[1]
        if (missingCol in finalPayload) {
          delete finalPayload[missingCol]
          varovani.push(`Tabulka ${tabulka} neobsahuje sloupec "${missingCol}" — uloženo bez něj.`)
          continue
        }
      }

      chyby.push(`${r.nazev}: ${insertRes.error.message}`)
      break
    }
  }

  return { ulozeno, chyby, varovani, tabulka }
}
