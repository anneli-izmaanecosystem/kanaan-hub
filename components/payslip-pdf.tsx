'use client'

import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'

const c = {
  primary:   '#111827',
  secondary: '#6b7280',
  border:    '#e5e7eb',
  bg:        '#f9fafb',
  green:     '#15803d',
  red:       '#dc2626',
}

const s = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 9, color: c.primary, padding: 40, backgroundColor: '#ffffff' },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  farmName:    { fontSize: 18, fontWeight: 'bold' },
  docTitle:    { fontSize: 11, color: c.secondary, marginTop: 2 },
  period:      { fontSize: 8, color: c.secondary, marginTop: 2 },
  empBlock:    { alignItems: 'flex-end' },
  empName:     { fontSize: 11, fontWeight: 'bold' },
  empId:       { fontSize: 8, color: c.secondary, marginTop: 2 },
  divider:     { borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 14 },
  section:     { marginBottom: 16 },
  sectionTitle:{ fontSize: 8, color: c.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontWeight: 'bold' },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  rowLabel:    { fontSize: 8, color: c.secondary },
  rowValue:    { fontSize: 8, color: c.primary },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, backgroundColor: c.bg, paddingHorizontal: 6, borderRadius: 3, marginTop: 4 },
  totalLabel:  { fontSize: 9, fontWeight: 'bold' },
  totalValue:  { fontSize: 9, fontWeight: 'bold' },
  netBox:      { backgroundColor: c.primary, borderRadius: 6, padding: 12, alignItems: 'center', marginTop: 16 },
  netLabel:    { fontSize: 8, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  netValue:    { fontSize: 22, fontWeight: 'bold', color: '#ffffff', marginTop: 4 },
  footer:      { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  footerText:  { fontSize: 7, color: c.secondary },
})

function fmt(n: number | string) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(n))
}

interface PayslipData {
  run:      { periodStart: string; periodEnd: string }
  employee: { name: string; idNumber: string | null; department: string | null; position: string | null; bankName: string | null; bankAccount: string | null }
  entry: {
    ordinaryHours: string; overtimeHours: string; sundayPhHours: string
    basicPay: string; overtimePay: string; bonus: string; otherAdditions: string
    grossPay: string; uifEmployee: string; uifEmployer: string; leaveDeduction: string; otherDeductions: string
    netPay: string; leaveDaysTaken: string
  }
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function PayslipDocument({ data }: { data: PayslipData }) {
  const { run, employee, entry } = data

  const earnings = [
    { label: `Basic Pay (${entry.ordinaryHours} hrs)`,                    value: entry.basicPay },
    parseFloat(entry.overtimePay) > 0   && { label: `Overtime (${entry.overtimeHours} hrs × 1.5)`, value: entry.overtimePay },
    parseFloat(entry.sundayPhHours) > 0 && { label: `Sunday/PH (${entry.sundayPhHours} hrs × 2)`,  value: String(parseFloat(entry.overtimePay)) },
    parseFloat(entry.bonus) > 0         && { label: 'Bonus',                                         value: entry.bonus },
    parseFloat(entry.otherAdditions) > 0 && { label: 'Other Additions',                              value: entry.otherAdditions },
  ].filter(Boolean) as { label: string; value: string }[]

  const deductions = [
    { label: 'UIF (Employee 1%)',  value: entry.uifEmployee },
    parseFloat(entry.leaveDeduction)   > 0 && { label: 'Leave Deduction', value: entry.leaveDeduction },
    parseFloat(entry.otherDeductions)  > 0 && { label: 'Other Deductions', value: entry.otherDeductions },
  ].filter(Boolean) as { label: string; value: string }[]

  const totalDeductions = deductions.reduce((s, d) => s + parseFloat(d.value), 0)

  return (
    <Document title={`Payslip — ${employee.name}`} author="Kanaan Guest Farm">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.farmName}>Kanaan Guest Farm</Text>
            <Text style={s.docTitle}>Employee Payslip</Text>
            <Text style={s.period}>Period: {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</Text>
          </View>
          <View style={s.empBlock}>
            <Text style={s.empName}>{employee.name}</Text>
            {employee.department && <Text style={s.empId}>{employee.department}{employee.position ? ` · ${employee.position}` : ''}</Text>}
            {employee.idNumber && <Text style={s.empId}>ID: {employee.idNumber}</Text>}
          </View>
        </View>

        <View style={s.divider} />

        {/* Earnings */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Earnings</Text>
          {earnings.map(({ label, value }) => (
            <View key={label} style={s.row}>
              <Text style={s.rowLabel}>{label}</Text>
              <Text style={s.rowValue}>{fmt(value)}</Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Gross Pay</Text>
            <Text style={s.totalValue}>{fmt(entry.grossPay)}</Text>
          </View>
        </View>

        {/* Deductions */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Deductions</Text>
          {deductions.map(({ label, value }) => (
            <View key={label} style={s.row}>
              <Text style={s.rowLabel}>{label}</Text>
              <Text style={[s.rowValue, { color: c.red }]}>-{fmt(value)}</Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total Deductions</Text>
            <Text style={[s.totalValue, { color: c.red }]}>-{fmt(totalDeductions)}</Text>
          </View>
        </View>

        {/* Net Pay */}
        <View style={s.netBox}>
          <Text style={s.netLabel}>Net Pay</Text>
          <Text style={s.netValue}>{fmt(entry.netPay)}</Text>
        </View>

        {/* Bank details */}
        {(employee.bankName || employee.bankAccount) && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.sectionTitle}>Payment Details</Text>
            {employee.bankName    && <View style={s.row}><Text style={s.rowLabel}>Bank</Text><Text style={s.rowValue}>{employee.bankName}</Text></View>}
            {employee.bankAccount && <View style={s.row}><Text style={s.rowLabel}>Account</Text><Text style={s.rowValue}>{employee.bankAccount}</Text></View>}
          </View>
        )}

        {/* Employer UIF note */}
        <View style={{ marginTop: 16, backgroundColor: c.bg, borderRadius: 4, padding: 8 }}>
          <Text style={{ fontSize: 7, color: c.secondary }}>
            Employer UIF contribution: {fmt(entry.uifEmployer)} (paid directly to UIF — not deducted from employee)
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generated by Kanaan Hub</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function downloadPayslipPdf(data: PayslipData) {
  const blob = await pdf(<PayslipDocument data={data} />).toBlob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `Payslip_${data.employee.name.replace(/\s+/g, '_')}_${data.run.periodStart}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
