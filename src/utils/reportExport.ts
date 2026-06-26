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
        ? [{ id: 'legacy', title: 'Financial Report', visible: true, groups: layout.groups, include_in_combined_total: true }]
        : []
  return rawTables.map(t => ({
    ...t,
    groups: t.groups.map(g => ({ ...g, children: migrateGroupChildren(g) })),
  }))
}

// ── PDF Export ────────────────────────────────────────────────────────────────

type Cell = string | { content: string; styles: object }

export function exportReportPDF(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
  reportDate: string,
  orgName = 'Financial Report',
  opBalances: OperationalBalanceMap = new Map(),
  currencySymbol = '₦',
  numberLocale = 'en-NG',
  hideZeroRows = false,
): void {
  const fmt = makeFmt(numberLocale)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const dateLabel = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(orgName, 105, 18, { align: 'center' })
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`BREAKDOWN OF FINANCIAL REPORT – ${dateLabel.toUpperCase()}`, 105, 25, { align: 'center' })

  const tables = normaliseTables(layout)
  let startY = 32

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
            fillColor: [30, 58, 138] as [number, number, number],
            textColor: [255, 255, 255] as [number, number, number],
            fontSize: 10,
          },
        },
        { content: '', styles: { fillColor: [30, 58, 138] as [number, number, number] } },
      ])
    }

    for (const group of table.groups) {
      if (!group.visible) continue

      tableBody.push([
        { content: group.label, styles: { fontStyle: 'bold', fillColor: [230, 230, 230] as [number, number, number] } },
        { content: '', styles: { fillColor: [230, 230, 230] as [number, number, number] } },
      ])

      for (const child of group.children) {
        if (child.kind === 'item') {
          if (!child.data.visible) continue
          const val = getItemBalance(child.data, balances, opBalances)
          if (hideZeroRows && val === 0) continue
          tableBody.push([child.data.displayLabel, `${currencySymbol}${fmt(val)}`])
        } else {
          const sg = child.data
          if (!sg.visible) continue
          const visibleItems = sg.items.filter(i => i.visible && (!hideZeroRows || getItemBalance(i, balances, opBalances) !== 0))
          if (visibleItems.length === 0) continue
          tableBody.push([
            { content: `  ${sg.label}`, styles: { fontStyle: 'italic', fillColor: [245, 245, 245] as [number, number, number] } },
            { content: '', styles: { fillColor: [245, 245, 245] as [number, number, number] } },
          ])
          for (const item of visibleItems) {
            const val = getItemBalance(item, balances, opBalances)
            tableBody.push([`    ${item.displayLabel}`, `${currencySymbol}${fmt(val)}`])
          }
          const sgTotal = sg.items.filter(i => i.visible).reduce((s, i) => s + getItemBalance(i, balances, opBalances), 0)
          tableBody.push([
            { content: `  ${sg.label} Sub-Total`, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] as [number, number, number] } },
            { content: `${currencySymbol}${fmt(sgTotal)}`, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] as [number, number, number] } },
          ])
        }
      }

      const groupTotal = computeGroupTotal(group, balances, opBalances)
      tableBody.push([
        { content: `${group.label} Sub-Total`, styles: { fontStyle: 'bold' } },
        { content: `${currencySymbol}${fmt(groupTotal)}`, styles: { fontStyle: 'bold' } },
      ])
      tableBody.push([{ content: '', styles: { cellPadding: 1 } }, ''])
    }

    // Table grand total
    const tableTotal = computeTableTotal(table, balances, opBalances)
    const totalLabel = tables.length > 1 ? `${table.title} TOTAL` : 'GRAND TOTAL'
    tableBody.push([
      { content: totalLabel, styles: { fontStyle: 'bold', fillColor: [30, 58, 138] as [number, number, number], textColor: [255, 255, 255] as [number, number, number] } },
      { content: `${currencySymbol}${fmt(tableTotal)}`, styles: { fontStyle: 'bold', fillColor: [30, 58, 138] as [number, number, number], textColor: [255, 255, 255] as [number, number, number] } },
    ])

    autoTable(doc, {
      startY,
      head: [['Account / Description', 'Amount']],
      body: tableBody,
      headStyles: { fillColor: [30, 58, 138], fontStyle: 'bold', textColor: [255, 255, 255] },
      columnStyles: {
        0: { cellWidth: 110, halign: 'left', textColor: [0, 0, 0], overflow: 'linebreak' },
        1: { cellWidth: 45, halign: 'right', textColor: [0, 0, 0], overflow: 'linebreak' },
      },
      styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
      margin: { left: 14, right: 14 },
      didDrawCell: (data) => {
        // Ensure dark text on light backgrounds for readability
        const cell = data.cell
        const { textColor } = cell.styles as unknown as { textColor?: number[] }
        if (!textColor || (textColor[0] === 255 && textColor[1] === 255 && textColor[2] === 255)) {
          const fillColor = cell.styles.fillColor as unknown as number[] | undefined
          if (fillColor && (fillColor[0] > 100 || fillColor[1] > 100 || fillColor[2] > 100)) {
            cell.styles.textColor = [0, 0, 0]
          }
        }
      },
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
        { content: 'COMBINED GRAND TOTAL', styles: { fontStyle: 'bold', fillColor: [15, 23, 42] as [number, number, number], textColor: [255, 255, 255] as [number, number, number], fontSize: 10 } },
        { content: `${currencySymbol}${fmt(combinedTotal)}`, styles: { fontStyle: 'bold', fillColor: [15, 23, 42] as [number, number, number], textColor: [255, 255, 255] as [number, number, number], fontSize: 10, halign: 'right' } },
      ]],
      columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 50, halign: 'right' } },
      styles: { fontSize: 9, cellPadding: 2.5 },
      margin: { left: 14, right: 14 },
    })
  }

  doc.save(`Financial_Report_${reportDate}.pdf`)
}

// ── Excel Export ──────────────────────────────────────────────────────────────

export function exportReportExcel(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
  reportDate: string,
  orgName = 'Financial Report',
  opBalances: OperationalBalanceMap = new Map(),
  currencySymbol = '₦',
  _numberLocale = 'en-NG',
  hideZeroRows = false,
): void {
  const wb = XLSX.utils.book_new()

  const dateLabel = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const tables = normaliseTables(layout)

  for (let ti = 0; ti < tables.length; ti++) {
    const table = tables[ti]
    if (!table.visible) continue

    const rows: (string | number)[][] = []
    rows.push([orgName])
    rows.push([`BREAKDOWN OF FINANCIAL REPORT – ${dateLabel.toUpperCase()}`])
    if (tables.length > 1) rows.push([table.title.toUpperCase()])
    rows.push([])
    rows.push(['Account / Description', `Amount (${currencySymbol})`])

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
    const totalLabel = tables.length > 1 ? `${table.title} TOTAL` : 'GRAND TOTAL'
    rows.push([totalLabel, tableTotal])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 50 }, { wch: 20 }]

    const sheetName = tables.length > 1 ? table.title.slice(0, 31) : 'Report'
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  // Combined grand total sheet (only when >1 table and at least one opted in)
  const combinedTbls = tables.filter(t => t.visible && (t.include_in_combined_total ?? true))
  if (tables.filter(t => t.visible).length > 1 && combinedTbls.length > 0) {
    const summaryRows: (string | number)[][] = []
    summaryRows.push([orgName])
    summaryRows.push([`BREAKDOWN OF FINANCIAL REPORT – ${dateLabel.toUpperCase()}`])
    summaryRows.push([])
    summaryRows.push(['Table', `Total (${currencySymbol})`])
    for (const t of combinedTbls) {
      summaryRows.push([t.title, computeTableTotal(t, balances, opBalances)])
    }
    summaryRows.push([])
    summaryRows.push(['COMBINED GRAND TOTAL', combinedTbls.reduce((s, t) => s + computeTableTotal(t, balances, opBalances), 0)])
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)
    wsSummary['!cols'] = [{ wch: 50 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')
  }

  XLSX.writeFile(wb, `Financial_Report_${reportDate}.xlsx`)
}
