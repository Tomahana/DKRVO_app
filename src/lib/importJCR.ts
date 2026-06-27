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
  celkem: number
  ok: number
  s_chybami: number
  preskocene: number
  radky: JCRRadekRozsireny[]
  kriticke_chyby: string[]
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

function parseCsvRadky(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length <= 1) return []

  const delimiter = lines[0].includes(';') ? ';' : ','
  const header = lines[0].split(delimiter).map((h) => h.trim())

  return lines.slice(1).map((line) => {
    const values = line.split(delimiter)
    const row: Record<string, string> = {}
    header.forEach((klic, idx) => {
      row[klic] = (values[idx] ?? '').trim()
    })
    return row
  })
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

export function parseJCRCsv(csv: string): ImportVysledekJCR {
  const kriticke_chyby: string[] = []
  const source = parseCsvRadky(csv)
  const radky = source.map(mapJcrRadek)
  return {
    celkem: radky.length,
    ok: radky.length,
    s_chybami: 0,
    preskocene: 0,
    radky,
    kriticke_chyby,
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
