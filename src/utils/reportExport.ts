import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import type { ReportGroup, ReportLayout, ReportCategoryBalance, ReportPortion } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function getBalance(
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

export function computeGroupTotal(
  group: ReportGroup,
  balances: Map<string, ReportCategoryBalance>,
): number {
  return group.items
    .filter(i => i.visible)
    .reduce((sum, item) => sum + getBalance(balances.get(item.categoryName), item.portion), 0)
}

export function computeGrandTotal(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
): number {
  return layout.groups
    .filter(g => g.visible)
    .reduce((sum, g) => sum + computeGroupTotal(g, balances), 0)
}

// ── PDF Export ────────────────────────────────────────────────────────────────

export function exportReportPDF(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
  reportDate: string,
  orgName = 'Financial Report',
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const dateLabel = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  // Header
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(orgName, 105, 18, { align: 'center' })
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(`BREAKDOWN OF FINANCIAL REPORT – ${dateLabel.toUpperCase()}`, 105, 25, { align: 'center' })

  const tableBody: (string | { content: string; styles: object })[][] = []

  for (const group of layout.groups) {
    if (!group.visible) continue

    // Group header row
    tableBody.push([
      { content: group.label, styles: { fontStyle: 'bold', fillColor: [230, 230, 230] as [number, number, number] } },
      { content: '', styles: { fillColor: [230, 230, 230] as [number, number, number] } },
    ])

    for (const item of group.items) {
      if (!item.visible) continue
      const val = getBalance(balances.get(item.categoryName), item.portion)
      tableBody.push([item.displayLabel, `₦${fmt(val)}`])
    }

    // Group subtotal
    const groupTotal = computeGroupTotal(group, balances)
    tableBody.push([
      { content: `${group.label} Sub-Total`, styles: { fontStyle: 'bold' } },
      { content: `₦${fmt(groupTotal)}`, styles: { fontStyle: 'bold' } },
    ])

    tableBody.push([{ content: '', styles: { cellPadding: 1 } }, ''])
  }

  // Grand total
  const grand = computeGrandTotal(layout, balances)
  tableBody.push([
    { content: 'GRAND TOTAL', styles: { fontStyle: 'bold', fillColor: [30, 58, 138] as [number, number, number], textColor: [255, 255, 255] as [number, number, number] } },
    { content: `₦${fmt(grand)}`, styles: { fontStyle: 'bold', fillColor: [30, 58, 138] as [number, number, number], textColor: [255, 255, 255] as [number, number, number] } },
  ])

  autoTable(doc, {
    startY: 32,
    head: [['Account / Description', 'Amount']],
    body: tableBody,
    headStyles: { fillColor: [30, 58, 138], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { cellWidth: 50, halign: 'right' },
    },
    styles: { fontSize: 9, cellPadding: 2.5 },
    margin: { left: 14, right: 14 },
  })

  doc.save(`Financial_Report_${reportDate}.pdf`)
}

// ── Excel Export ──────────────────────────────────────────────────────────────

export function exportReportExcel(
  layout: ReportLayout,
  balances: Map<string, ReportCategoryBalance>,
  reportDate: string,
  orgName = 'Financial Report',
): void {
  const wb = XLSX.utils.book_new()
  const rows: (string | number)[][] = []

  const dateLabel = new Date(reportDate + 'T12:00:00').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  rows.push([orgName])
  rows.push([`BREAKDOWN OF FINANCIAL REPORT – ${dateLabel.toUpperCase()}`])
  rows.push([])
  rows.push(['Account / Description', 'Amount (₦)'])

  for (const group of layout.groups) {
    if (!group.visible) continue

    rows.push([group.label, ''])

    for (const item of group.items) {
      if (!item.visible) continue
      const val = getBalance(balances.get(item.categoryName), item.portion)
      rows.push([`  ${item.displayLabel}`, val])
    }

    const groupTotal = computeGroupTotal(group, balances)
    rows.push([`${group.label} Sub-Total`, groupTotal])
    rows.push([])
  }

  rows.push(['GRAND TOTAL', computeGrandTotal(layout, balances)])

  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Column widths
  ws['!cols'] = [{ wch: 50 }, { wch: 20 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  XLSX.writeFile(wb, `Financial_Report_${reportDate}.xlsx`)
}
