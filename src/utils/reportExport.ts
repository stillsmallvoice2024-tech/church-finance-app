import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import type {
  ReportGroup,
  ReportItem,
  ReportGroupChild,
  ReportSubgroup,
  ReportTable,
  ReportLayout,
  ReportCategoryBalance,
  ReportPortion,
  OperationalBalanceMap,
} from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFmt(locale: string) {
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (n: number) => nf.format(n)
}

// jsPDF's standard fonts render the Latin-1 range (U+0020-U+00FF) plus a few
// cp1252 glyphs - notably the euro sign. Currency symbols outside that set
// (naira, rupee, won, baht, ...) corrupt the ENTIRE PDF string, so for those we
// print the ISO currency code instead. Excel uses the same token so both
// exports stay consistent.
const PDF_SAFE_EXTRA = new Set(['\u20AC'])

function isRenderableSymbol(sym: string): boolean {
  for (const ch of sym) {
    if (ch.charCodeAt(0) <= 0xff) continue
    if (PDF_SAFE_EXTRA.has(ch)) continue
    return false
  }
  return true
}

/** Token shown inside "Amount (...)" headers: symbol when renderable, else ISO code. */
function currencyToken(symbol: string, code: string): string {
  return isRenderableSymbol(symbol) ? symbol : code
}

/** Prefix printed before an amount: symbol when renderable, else "CODE ". */
function moneyPrefix(symbol: string, code: string): string {
  return isRenderableSymbol(symbol) ? symbol : `${code} `
}

function getCategoryBalance(
  bal: ReportCategoryBalance | undefined,
  portion: ReportPortion,
): number {
  if (!bal) return 0
  switch (portion) {
    case 'Percentage':    return bal.percentageAllocated
    case 'Specific Seed': return bal.specificSeed
    case 'Savings':       return bal.savingsNet
    case 'All':
    default:              return bal.percentageAllocated + bal.specificSeed + bal.savingsNet
  }
}

// ── Balance helpers ───────────────────────────────────────────────────────────

export function getItemBalance(
  item: ReportItem,
  balances: Map<string, ReportCategoryBalance>,
  opBalances: OperationalBalanceMap,
): number {
  const rowType = item.rowType ?? 'category'
  if (rowType === 'inflow_type') {
    return opBalances.get(`it::${item.incomeTypeId ?? ''}`) ?? 0
  }
  if (rowType === 'transaction_type') {
    return opBalances.get(`tt::${item.transactionTypeKey ?? ''}`) ?? 0
  }
  return getCategoryBalance(balances.get(item.categoryName), item.portion)
}

export function computeGroupTotal(
  group: ReportGroup,
  balances: Map<string, ReportCategoryBalance>,
  opBalances: OperationalBalanceMap = new Map(),
): number {
  let total = 0
  for (const child of group.children) {
    if (child.kind === 'item') {
      if (child.data.visible) total += getItemBalance(child.data, balances, opBalances)
    } else {
      if (!child.data.visible) continue
      for (const item of child.data.items) {
        if (item.visible) total += getItemBalance(item, balances, opBalances)
      }
    }
  }
  return total
}

export function computeTableTotal(
  table: ReportTable,
  balances: Map<string, ReportCategoryBalance>,
  opBalances: OperationalBalanceMap = new Map(),
): number {
  return table.groups
    .filter(g => g.visible)
    .reduce((sum, g) => sum + computeGroupTotal(g, balances, opBalances), 0)
}

/** Sum only visible tables opted into the combined total */
export function computeGrandTotal(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
  opBalances: OperationalBalanceMap = new Map(),
): number {
  const tables = normaliseTables(layout)
  return tables
    .filter(t => t.visible && (t.include_in_combined_total ?? true))
    .reduce((sum, t) => sum + computeTableTotal(t, balances, opBalances), 0)
}

function migrateGroupChildren(g: ReportGroup): ReportGroupChild[] {
  const raw = g as unknown as { children?: ReportGroupChild[]; items?: ReportItem[]; subgroups?: ReportSubgroup[] }
  if (raw.children !== undefined) return raw.children
  return [
    ...(raw.items ?? []).map(data => ({ kind: 'item' as const, data })),
    ...(raw.subgroups ?? []).map(data => ({ kind: 'subgroup' as const, data })),
  ]
}

/** Coerce old single-table layout to the new multi-table format */
export function normaliseTables(layout: ReportLayout): ReportTable[] {
  const rawTables =
    layout.tables && layout.tables.length > 0
      ? layout.tables
      : layout.groups && layout.groups.length > 0
        ? [{ id: 'legacy', title: 'Board Report', visible: true, groups: layout.groups, include_in_combined_total: true }]
        : []
  return rawTables.map(t => ({
    ...t,
    groups: t.groups.map(g => ({ ...g, children: migrateGroupChildren(g) })),
  }))
}

// ── PDF Export ────────────────────────────────────────────────────────────────

type Cell = string | { content: string; styles: object }

type RGB = [number, number, number]

// Clariva brand palette (see brand.md). Centralised so every PDF export shares
// one source of truth.
const BRAND: Record<string, RGB> = {
  tealAnchor:  [13, 115, 119],   // #0D7377 — primary structural bands
  tealBright:  [20, 160, 133],   // #14A085 — secondary accent
  deepNavy:    [26, 44, 66],     // #1A2C42 — trust / body text / headline totals
  goldHonour:  [200, 155, 60],   // #C89B3C — sparing accent (rules, premium)
  tealMist:    [230, 244, 241],  // #E6F4F1 — group-header tint
  slate:       [74, 85, 104],    // #4A5568 — secondary text / notes
  silverCloud: [247, 249, 250],  // #F7F9FA — subgroup / alt-row tint
  white:       [255, 255, 255],
}

// A4 portrait is 210mm wide; the report table is this wide. Side margins are
// derived from these so the table sits centred on the page.
const PDF_TABLE_WIDTH = 155 // 110 (description) + 45 (amount)

export function exportReportPDF(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
  reportDate: string,
  orgName = 'Board Report',
  opBalances: OperationalBalanceMap = new Map(),
  currencySymbol = '₦',
  numberLocale = 'en-NG',
  hideZeroRows = false,
  currencyCode = 'NGN',
): void {
  const fmt = makeFmt(numberLocale)
  const pdfSym = moneyPrefix(currencySymbol, currencyCode)
  const headerToken = currencyToken(currencySymbol, currencyCode)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const pageWidth  = doc.internal.pageSize.getWidth()
  const sideMargin = (pageWidth - PDF_TABLE_WIDTH) / 2
  const centerX    = pageWidth / 2

  const dateLabel = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...BRAND.deepNavy)
  doc.text(orgName, centerX, 18, { align: 'center' })
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...BRAND.slate)
  doc.text(`BREAKDOWN OF FINANCIAL REPORT – ${dateLabel.toUpperCase()}`, centerX, 25, { align: 'center' })

  // Thin gold accent rule under the header
  doc.setDrawColor(...BRAND.goldHonour)
  doc.setLineWidth(0.6)
  doc.line(sideMargin, 28.5, pageWidth - sideMargin, 28.5)

  const tables = normaliseTables(layout)
  let startY = 33

  for (let ti = 0; ti < tables.length; ti++) {
    const table = tables[ti]
    if (!table.visible) continue

    const tableBody: Cell[][] = []

    // Table title header (for multi-table layouts)
    if (tables.length > 1) {
      tableBody.push([
        {
          content: table.title.toUpperCase(),
          styles: {
            fontStyle: 'bold',
            fillColor: BRAND.deepNavy,
            textColor: BRAND.white,
            fontSize: 10,
          },
        },
        { content: '', styles: { fillColor: BRAND.deepNavy } },
      ])
    }

    for (const group of table.groups) {
      if (!group.visible) continue

      tableBody.push([
        { content: group.label, styles: { fontStyle: 'bold', fillColor: BRAND.tealMist, textColor: BRAND.deepNavy } },
        { content: '', styles: { fillColor: BRAND.tealMist } },
      ])

      for (const child of group.children) {
        if (child.kind === 'item') {
          if (!child.data.visible) continue
          const val = getItemBalance(child.data, balances, opBalances)
          if (hideZeroRows && val === 0) continue
          tableBody.push([child.data.displayLabel, `${pdfSym}${fmt(val)}`])
        } else {
          const sg = child.data
          if (!sg.visible) continue
          const visibleItems = sg.items.filter(i => i.visible && (!hideZeroRows || getItemBalance(i, balances, opBalances) !== 0))
          if (visibleItems.length === 0) continue
          tableBody.push([
            { content: `  ${sg.label}`, styles: { fontStyle: 'italic', fillColor: BRAND.silverCloud, textColor: BRAND.slate } },
            { content: '', styles: { fillColor: BRAND.silverCloud } },
          ])
          for (const item of visibleItems) {
            const val = getItemBalance(item, balances, opBalances)
            tableBody.push([`    ${item.displayLabel}`, `${pdfSym}${fmt(val)}`])
          }
          const sgTotal = sg.items.filter(i => i.visible).reduce((s, i) => s + getItemBalance(i, balances, opBalances), 0)
          tableBody.push([
            { content: `  ${sg.label} Sub-Total`, styles: { fontStyle: 'bold', fillColor: BRAND.silverCloud, textColor: BRAND.deepNavy } },
            { content: `${pdfSym}${fmt(sgTotal)}`, styles: { fontStyle: 'bold', fillColor: BRAND.silverCloud, textColor: BRAND.deepNavy } },
          ])
        }
      }

      const groupTotal = computeGroupTotal(group, balances, opBalances)
      tableBody.push([
        { content: `${group.label} Sub-Total`, styles: { fontStyle: 'bold', textColor: BRAND.deepNavy } },
        { content: `${pdfSym}${fmt(groupTotal)}`, styles: { fontStyle: 'bold', textColor: BRAND.deepNavy } },
      ])
      tableBody.push([{ content: '', styles: { cellPadding: 1 } }, ''])
    }

    // Table grand total
    const tableTotal = computeTableTotal(table, balances, opBalances)
    const totalLabel = tables.length > 1 ? `${table.title} TOTAL` : 'GRAND TOTAL'
    tableBody.push([
      { content: totalLabel, styles: { fontStyle: 'bold', fillColor: BRAND.tealAnchor, textColor: BRAND.white } },
      { content: `${pdfSym}${fmt(tableTotal)}`, styles: { fontStyle: 'bold', fillColor: BRAND.tealAnchor, textColor: BRAND.white } },
    ])

    autoTable(doc, {
      startY,
      head: [['Account / Description', `Amount (${headerToken})`]],
      body: tableBody,
      // headStyles keeps the header white on Teal Anchor. Body text is Deep Navy
      // via bodyStyles; the coloured total rows set white at the cell level
      // (which outranks bodyStyles). textColor is deliberately NOT set in
      // columnStyles, which would override both head and cell styles.
      headStyles: { fillColor: BRAND.tealAnchor, fontStyle: 'bold', textColor: BRAND.white },
      bodyStyles: { textColor: BRAND.deepNavy },
      columnStyles: {
        0: { cellWidth: 110, halign: 'left', overflow: 'linebreak' },
        1: { cellWidth: 45, halign: 'right' },
      },
      styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
      margin: { left: sideMargin, right: sideMargin },
    })

    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

    // Page break between tables if not the last
    if (ti < tables.length - 1 && startY > 220) {
      doc.addPage()
      startY = 20
    }
  }

  // Combined grand total (only tables opted in, and only when >1 table)
  const combinedTables = tables.filter(t => t.visible && (t.include_in_combined_total ?? true))
  if (tables.filter(t => t.visible).length > 1 && combinedTables.length > 0) {
    const combinedTotal = combinedTables.reduce((s, t) => s + computeTableTotal(t, balances, opBalances), 0)
    autoTable(doc, {
      startY,
      body: [[
        { content: 'COMBINED GRAND TOTAL', styles: { fontStyle: 'bold', fillColor: BRAND.deepNavy, textColor: BRAND.white, fontSize: 10 } },
        { content: `${pdfSym}${fmt(combinedTotal)}`, styles: { fontStyle: 'bold', fillColor: BRAND.deepNavy, textColor: BRAND.white, fontSize: 10, halign: 'right' } },
      ]],
      // Gold border to mark the headline figure (premium / honour accent).
      columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 45, halign: 'right' } },
      styles: { fontSize: 9, cellPadding: 2.5, lineColor: BRAND.goldHonour, lineWidth: 0.5 },
      margin: { left: sideMargin, right: sideMargin },
    })
  }

  // Add note if rows were hidden
  if (hideZeroRows) {
    const pageHeight = doc.internal.pageSize.getHeight()
    const currentY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY
    const noteY = Math.min(currentY + 12, pageHeight - 15)
    doc.setFontSize(8)
    doc.setTextColor(...BRAND.slate)
    doc.text('Note: Rows with zero values are hidden from view. All subtotals and totals are calculated from complete data.', sideMargin, noteY, { maxWidth: PDF_TABLE_WIDTH })
  }

  doc.save(`Board_Report_${reportDate}.pdf`)
}

// ── Excel Export ──────────────────────────────────────────────────────────────

export function exportReportExcel(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
  reportDate: string,
  orgName = 'Board Report',
  opBalances: OperationalBalanceMap = new Map(),
  currencySymbol = '₦',
  _numberLocale = 'en-NG',
  hideZeroRows = false,
  currencyCode = 'NGN',
): void {
  const wb = XLSX.utils.book_new()
  // Use the same symbol-or-ISO-code token as the PDF export for consistency.
  const headerToken = currencyToken(currencySymbol, currencyCode)

  const dateLabel = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const tables = normaliseTables(layout)
  const visibleTables = tables.filter(t => t.visible)

  // Single worksheet: all tables stacked vertically, separated by a title
  // heading and a blank spacer row, instead of one sheet per table.
  const rows: (string | number)[][] = []
  rows.push([orgName])
  rows.push([`BREAKDOWN OF FINANCIAL REPORT – ${dateLabel.toUpperCase()}`])
  rows.push([])

  for (let ti = 0; ti < visibleTables.length; ti++) {
    const table = visibleTables[ti]

    // Table heading (only meaningful when there is more than one table)
    if (visibleTables.length > 1) rows.push([table.title.toUpperCase()])
    rows.push(['Account / Description', `Amount (${headerToken})`])

    for (const group of table.groups) {
      if (!group.visible) continue

      rows.push([group.label, ''])

      for (const child of group.children) {
        if (child.kind === 'item') {
          if (!child.data.visible) continue
          const val = getItemBalance(child.data, balances, opBalances)
          if (hideZeroRows && val === 0) continue
          rows.push([`  ${child.data.displayLabel}`, val])
        } else {
          const sg = child.data
          if (!sg.visible) continue
          const visibleItems = sg.items.filter(i => i.visible && (!hideZeroRows || getItemBalance(i, balances, opBalances) !== 0))
          if (visibleItems.length === 0) continue
          rows.push([`  ${sg.label}`, ''])
          for (const item of visibleItems) {
            rows.push([`    ${item.displayLabel}`, getItemBalance(item, balances, opBalances)])
          }
          const sgTotal = sg.items.filter(i => i.visible).reduce((s, i) => s + getItemBalance(i, balances, opBalances), 0)
          rows.push([`  ${sg.label} Sub-Total`, sgTotal])
        }
      }

      rows.push([`${group.label} Sub-Total`, computeGroupTotal(group, balances, opBalances)])
      rows.push([])
    }

    const tableTotal = computeTableTotal(table, balances, opBalances)
    const totalLabel = visibleTables.length > 1 ? `${table.title} TOTAL` : 'GRAND TOTAL'
    rows.push([totalLabel, tableTotal])

    // Spacer between consecutive tables
    if (ti < visibleTables.length - 1) {
      rows.push([])
      rows.push([])
    }
  }

  // Combined grand total section (only when >1 table and at least one opted in)
  const combinedTbls = visibleTables.filter(t => t.include_in_combined_total ?? true)
  if (visibleTables.length > 1 && combinedTbls.length > 0) {
    rows.push([])
    rows.push([])
    rows.push(['SUMMARY', ''])
    rows.push(['Table', `Total (${headerToken})`])
    for (const t of combinedTbls) {
      rows.push([t.title, computeTableTotal(t, balances, opBalances)])
    }
    rows.push(['COMBINED GRAND TOTAL', combinedTbls.reduce((s, t) => s + computeTableTotal(t, balances, opBalances), 0)])
  }

  // Note at the bottom of the same sheet when rows were hidden
  if (hideZeroRows) {
    rows.push([])
    rows.push(['Note: Rows with zero values are hidden from view. All subtotals and totals are calculated from complete data.'])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 50 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Report')

  XLSX.writeFile(wb, `Board_Report_${reportDate}.xlsx`)
}
