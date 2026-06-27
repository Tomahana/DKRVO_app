import * as XLSX from 'xlsx'

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

  // AIS
  nejlepsi_ais: number | null
  nejlepsi_ais_hodnoceni: string | null
  nejlepsi_ais_kvartal: string | null
  nejlepsi_ais_decil: string | null
  nejlepsi_ais_percentil: number | null
  nejlepsi_ais_poradi: number | null
  nejlepsi_ais_celkem: number | null
  ais_kvartal_zdroj: 'jcr' | 'vypocet' | null

  // JIF
  nejlepsi_jif: number | null
  nejlepsi_jif_kvartal: string | null
  nejlepsi_jif_percentil: number | null
}

export interface ImportVysledekJCR {
  rok_metrik?: number
  celkem_radku?: number
  unikatnich_casopisu?: number
  celkem: number
  ok: number
  s_chybami: number
  preskocene: number
  radky: JCRRadekRozsireny[]
  kriticke_chyby: string[]
  varovani?: string[]
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

function pickValue(radek: Record<string, string>, moznosti: string[]): string {
  for (const klic of moznosti) {
    const hodnota = radek[klic]
    if (hodnota !== undefined && hodnota !== null && String(hodnota).trim() !== '') {
      return String(hodnota).trim()
    }
  }
  return ''
}

function parseCislo(raw: string): number | null {
  if (!raw) return null
  const normal = raw.replace(',', '.').trim()
  const cislo = Number.parseFloat(normal)
  return Number.isFinite(cislo) ? cislo : null
}

function normalizeQuartile(raw: string): string | null {
  const hodnoty = raw.trim().toUpperCase()
  return /^Q[1-4]$/.test(hodnoty) ? hodnoty : null
}

function normalizeIssn(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, '')
  if (!cleaned) return null
  if (!/^\d{4}-[\dXx]{4}$/.test(cleaned)) return null
  return cleaned.toUpperCase()
}

function parseKategorie(raw: string): string[] {
  return raw
    .split(/[;|]/)
    .map((k) => k.trim())
    .filter(Boolean)
}

function mapJcrRadek(radek: Record<string, string>): JCRRadekRozsireny {
  const kategorieRaw = pickValue(radek, ['Kategorie', 'Category', 'WoS Categories'])
  return {
    nazev: pickValue(radek, ['Název', 'Nazev', 'Title', 'Journal Name']),
    issn: normalizeIssn(pickValue(radek, ['ISSN', 'ISSN:'])),
    eissn: normalizeIssn(pickValue(radek, ['eISSN', 'e-ISSN', 'e-ISSN:'])),
    kategorie: parseKategorie(kategorieRaw),
    ais_hodnota: parseCislo(pickValue(radek, ['AIS', 'Article Influence Score'])),
    ais_kvartal: normalizeQuartile(pickValue(radek, ['AIS Quartile', 'AIS kvartál', 'AIS kvartal'])),
    jif_hodnota: parseCislo(pickValue(radek, ['JIF', 'Journal Impact Factor'])),
    jif_kvartal: normalizeQuartile(pickValue(radek, ['JIF Quartile', 'JIF kvartál', 'JIF kvartal'])),
    jif_percentil: parseCislo(pickValue(radek, ['JIF %', 'JIF Percentile', 'JIF percentil'])),
  }
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
}

function mapujSloupce(hlavicka: string[]): SloupceMap | null {
  // Normalizuj — lowercase, odstraň středníky a přebytečné mezery
  const h = hlavicka.map((s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/;/g, '')    // ← klíčová oprava pro 2021 formát
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
  }
}

function detekujRok(prvniRadekText: string, hlavicka: string[]): number {
  const kandidati = `${prvniRadekText} ${hlavicka.join(' ')}`
  const match = kandidati.match(/\b(20\d{2})\b/)
  if (!match) return 0
  const rok = Number.parseInt(match[1], 10)
  return Number.isFinite(rok) ? rok : 0
}

function parseRadek(bunky: string[], mapa: SloupceMap, _rok?: number): JCRRadek | null {
  const nazev = (bunky[mapa.nazev] ?? '').trim()
  if (!nazev) return null

  const issn = mapa.issn >= 0 ? normalizeIssn(bunky[mapa.issn] ?? '') : null
  const eissn = mapa.eissn >= 0 ? normalizeIssn(bunky[mapa.eissn] ?? '') : null
  const kategorie = mapa.kategorie >= 0 ? parseKategorie((bunky[mapa.kategorie] ?? '').trim()) : []

  const ais_hodnota = mapa.ais !== null ? parseCislo((bunky[mapa.ais] ?? '').trim()) : null
  const ais_kvartal = mapa.ais_q !== null ? normalizeQuartile((bunky[mapa.ais_q] ?? '').trim()) : null
  const jif_hodnota = mapa.jif >= 0 ? parseCislo((bunky[mapa.jif] ?? '').trim()) : null
  const jif_kvartal = mapa.jif_q !== null ? normalizeQuartile((bunky[mapa.jif_q] ?? '').trim()) : null
  const jif_percentil = mapa.jif_p !== null ? parseCislo((bunky[mapa.jif_p] ?? '').trim()) : null

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

function vypoctiPozici(poradi: number, celkem: number): PozicniMetriky {
  const percentil_pozice = (poradi / celkem) * 100

  // Kvartil Q1-Q4
  const kvartal =
    percentil_pozice <= 25 ? 'Q1' :
    percentil_pozice <= 50 ? 'Q2' :
    percentil_pozice <= 75 ? 'Q3' : 'Q4'

  // Decil D1-D10
  const decilCislo = Math.min(10, Math.ceil(percentil_pozice / 10))
  const decil = `D${decilCislo}`

  // Hlavní hodnocení: P1-P10, pak D1, pak Q1-Q4
  let hodnoceni: string
  if (percentil_pozice <= 10) {
    // P1-P10: ceil percentilu (ale min 1)
    const pCislo = Math.max(1, Math.ceil(percentil_pozice))
    hodnoceni = `P${pCislo}`
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
      tooltip: cislo === 1 ? 'Top 25% v oboru' :
        cislo === 2 ? '25–50% v oboru' :
          cislo === 3 ? '50–75% v oboru' : 'Dolních 25% v oboru',
    }
  }
  return { label: hodnoceni, cssTrida: '', tooltip: '' }
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

  // Detekuj formát — starý 2021 nebo nový 2022+
  const vzorkovyRadek = radky[hlavickaIdx + 1] ?? ''
  const jeStaryFormat = vzorkovyRadek.startsWith('"') &&
    vzorkovyRadek.includes('""')

  // Parser pro starý formát 2021:
  // "NATURE MEDICINE,""1078-8956"",""1546-170X"",""BIOCHEMISTRY..."",""53.44"",""Q1"",""20.837"",";"
  function parseStaryRadek(radek: string): string[] {
    // Odstraň vnější uvozovky a středník/čárku na konci
    const ocisteny = radek
      .trim()
      .replace(/^"/, '')              // začáteční "
      .replace(/[",;\s]+$/, '')       // koncový ", nebo ; nebo mezery

    // Split podle ,""
    const parts = ocisteny.split(',""')
    const bunky: string[] = []

    for (let i = 0; i < parts.length; i++) {
      const val = parts[i]
        .replace(/""$/g, '')          // zbytky "" na konci
        .replace(/""/g, '"')          // escapované uvozovky
        .trim()
      bunky.push(val)
    }

    return bunky
  }

  // Parser pro nový formát 2022+: standardní CSV s uvozovkami
  function parseNovyRadek(radek: string): string[] {
    const bunky: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < radek.length; i++) {
      const ch = radek[i]
      if (ch === '"') {
        inQuotes = !inQuotes
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

  // Parsuj hlavičku
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
      kriticke_chyby: [`CSV: nelze namapovat sloupce. Hlavička: ${hlavicka.slice(0, 5).join(' | ')}`],
      varovani: [],
      celkem: 0,
      ok: 0,
      s_chybami: 0,
      preskocene: 0,
    }
  }

  const rok = rokOverride ?? detekujRok(prvniRadekText, hlavicka)
  const parsovane: JCRRadek[] = []

  for (let i = hlavickaIdx + 1; i < radky.length; i++) {
    const radek = radky[i]
    if (!radek?.trim()) continue

    const bunky = jeStaryFormat
      ? parseStaryRadek(radek)
      : parseNovyRadek(radek)

    if (bunky.every((b) => !b)) continue

    const parsed = parseRadek(bunky, mapa, rok)
    if (parsed) parsovane.push(parsed)
  }

  const unikatniISSN = new Set(parsovane.map((r) => r.issn ?? r.eissn ?? r.nazev))

  return {
    rok_metrik: rok,
    celkem_radku: parsovane.length,
    unikatnich_casopisu: unikatniISSN.size,
    radky: parsovane,
    kriticke_chyby,
    varovani,
    celkem: parsovane.length,
    ok: parsovane.length,
    s_chybami: 0,
    preskocene: 0,
  }
}

export function parseJCRXlsx(buffer: ArrayBuffer): ImportVysledekJCR {
  try {
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const source = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: '',
      raw: false,
    })
    const radky = source.map(mapJcrRadek)
    return {
      celkem: radky.length,
      ok: radky.length,
      s_chybami: 0,
      preskocene: 0,
      radky,
      kriticke_chyby: [],
    }
  } catch (error) {
    return {
      celkem: 0,
      ok: 0,
      s_chybami: 0,
      preskocene: 0,
      radky: [],
      kriticke_chyby: [String(error)],
    }
  }
}

export function vypoctiPoradi(radky: JCRRadekRozsireny[]): JCRRadekRozsireny[] {
  const vystup = radky.map((r) => ({ ...r }))
  const podleKategorie = new Map<string, number[]>()

  for (let i = 0; i < vystup.length; i++) {
    const radek = vystup[i]
    const kategorie = radek.kategorie.length > 0 ? radek.kategorie : ['__all__']
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
      const poradiIndex = hodnocene[idx]
      const rozsireny = vystup[poradiIndex]
      const poradi = idx + 1
      const pozice = vypoctiPozici(poradi, celkem)

      const aktualniScore = HODNOCENI_PORADI[rozsireny.ais_hodnoceni ?? ''] ?? 0
      const noveScore = HODNOCENI_PORADI[pozice.hodnoceni] ?? 0

      if (noveScore >= aktualniScore) {
        rozsireny.ais_poradi = pozice.poradi
        rozsireny.ais_celkem = pozice.celkem
        rozsireny.ais_hodnoceni = pozice.hodnoceni
        rozsireny.ais_kvartal_vypocteny = pozice.kvartal
        rozsireny.ais_decil_vypocteny = pozice.decil
        rozsireny.ais_percentil_vypocteny = pozice.percentil_pozice
      }
    }
  }

  return vystup
}

export function agregujMetriky(radky: JCRRadekRozsireny[]): CasopisAgregace[] {
  const map = new Map<string, JCRRadekRozsireny[]>()

  for (const r of radky) {
    const key = `${r.issn ?? ''}|${r.eissn ?? ''}|${r.nazev.toLowerCase()}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }

  return Array.from(map.values()).map((skupina) => {
    const prvni = skupina[0]

    const nejlepsiAisRadek = skupina.reduce((best, r) => {
      if (!best) return r
      return (r.ais_hodnota ?? -Infinity) > (best.ais_hodnota ?? -Infinity) ? r : best
    }, null as JCRRadekRozsireny | null)

    const nejlepsiJifRadek = skupina.reduce((best, r) => {
      if (!best) return r
      return (r.jif_hodnota ?? -Infinity) > (best.jif_hodnota ?? -Infinity) ? r : best
    }, null as JCRRadekRozsireny | null)

    // Priorita hodnocení: P1 > P2 > ... > P10 > D1 > Q1 > Q2 > Q3 > Q4
    const nejlepsiHodnoceni = skupina.reduce((best, r) => {
      const hodnoceni = r.ais_hodnoceni ?? r.ais_kvartal ?? null
      const poradi = HODNOCENI_PORADI[hodnoceni ?? ''] ?? 0
      const bestPoradi = HODNOCENI_PORADI[best ?? ''] ?? 0
      return poradi > bestPoradi ? hodnoceni : best
    }, null as string | null)

    const radekHodnoceni = skupina.find(
      (r) => (r.ais_hodnoceni ?? r.ais_kvartal ?? null) === nejlepsiHodnoceni
    ) ?? null

    const nejlepsiJifKvartal = skupina.reduce((best, r) => {
      const kvartal = r.jif_kvartal ?? null
      const poradi = HODNOCENI_PORADI[kvartal ?? ''] ?? 0
      const bestPoradi = HODNOCENI_PORADI[best ?? ''] ?? 0
      return poradi > bestPoradi ? kvartal : best
    }, null as string | null)

    const vsechnyKategorie = Array.from(
      new Set(skupina.flatMap((r) => r.kategorie).filter(Boolean))
    )

    return {
      nazev: prvni.nazev,
      issn: prvni.issn,
      eissn: prvni.eissn,
      kategorie: vsechnyKategorie,

      nejlepsi_ais: nejlepsiAisRadek?.ais_hodnota ?? null,
      nejlepsi_ais_hodnoceni: nejlepsiHodnoceni ?? null,
      nejlepsi_ais_kvartal: radekHodnoceni?.ais_kvartal ?? radekHodnoceni?.ais_kvartal_vypocteny ?? null,
      nejlepsi_ais_decil: radekHodnoceni?.ais_decil_vypocteny ?? null,
      nejlepsi_ais_percentil: radekHodnoceni?.ais_percentil_vypocteny ?? null,
      nejlepsi_ais_poradi: radekHodnoceni?.ais_poradi ?? null,
      nejlepsi_ais_celkem: radekHodnoceni?.ais_celkem ?? null,
      ais_kvartal_zdroj: radekHodnoceni?.ais_kvartal
        ? 'jcr'
        : radekHodnoceni?.ais_kvartal_vypocteny
          ? 'vypocet'
          : null,

      nejlepsi_jif: nejlepsiJifRadek?.jif_hodnota ?? null,
      nejlepsi_jif_kvartal: nejlepsiJifKvartal,
      nejlepsi_jif_percentil: nejlepsiJifRadek?.jif_percentil ?? null,
    }
  })
}
