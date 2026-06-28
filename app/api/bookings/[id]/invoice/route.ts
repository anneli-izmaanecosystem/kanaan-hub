import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, bookings, rooms } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import React from 'react'

const COMPANY = {
  name:    'Simba Ventures trading as Kanaan Guest Farm',
  address: 'PTN 4 Farm Glencairn 8, Hazyview, Mpumalanga 1242',
  phone:   '+27 63 794 3880',
  email:   'bookings@kanaanguestfarm.com',
  bank:    'Capitec Business',
  account: '1054489262',
}

const OLIVE = '#6b7c45'
const LIGHT_OLIVE = '#f0f4e8'

const s = StyleSheet.create({
  page:        { fontFamily: 'Helvetica', fontSize: 9, color: '#222', padding: 40, backgroundColor: '#fff' },
  row:         { flexDirection: 'row' },
  col:         { flexDirection: 'column' },
  bold:        { fontFamily: 'Helvetica-Bold' },
  company:     { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subtext:     { fontSize: 8, color: '#555', lineHeight: 1.5 },
  heading:     { fontSize: 20, color: OLIVE, fontFamily: 'Helvetica-Bold', marginTop: 24, marginBottom: 16 },
  metaLabel:   { color: '#888', fontSize: 8, width: 70 },
  metaValue:   { fontSize: 8 },
  metaRow:     { flexDirection: 'row', marginBottom: 3 },
  divider:     { borderBottomWidth: 1, borderBottomColor: '#ddd', marginVertical: 10 },
  tableHead:   { flexDirection: 'row', backgroundColor: LIGHT_OLIVE, paddingVertical: 5, paddingHorizontal: 4, marginBottom: 2 },
  tableHeadTx: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: OLIVE },
  tableRow:    { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  tableCell:   { fontSize: 9 },
  totalsRow:   { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 4, paddingHorizontal: 4 },
  totalsLabel: { fontSize: 9, color: '#666', width: 100, textAlign: 'right', paddingRight: 12 },
  totalsValue: { fontSize: 9, width: 70, textAlign: 'right' },
  balLabel:    { fontSize: 11, fontFamily: 'Helvetica-Bold', width: 100, textAlign: 'right', paddingRight: 12 },
  balValue:    { fontSize: 11, fontFamily: 'Helvetica-Bold', width: 70, textAlign: 'right' },
  banking:     { marginTop: 20, fontSize: 8, color: '#555' },
  bankingTitle:{ fontSize: 8, color: '#888', marginBottom: 3 },
})

function fmtDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function fmt(n: string | number) {
  return `R ${parseFloat(String(n)).toFixed(2)}`
}

function roomLabel(type: string) {
  if (type === 'premium') return 'Premium Room'
  if (type === 'budget')  return 'Budget Room'
  if (type === 'dorm')    return 'Dorm Bed'
  if (type === 'camping') return 'Campsite'
  return 'Accommodation'
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const [row] = await db
    .select({ booking: bookings, room: rooms })
    .from(bookings)
    .innerJoin(rooms, eq(bookings.roomId, rooms.id))
    .where(eq(bookings.id, parseInt(id)))

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { booking, room } = row
  const invNo   = booking.invoiceNumber ?? `${booking.id}`
  const invDate = fmtDate(booking.checkIn)
  const nights  = booking.nights
  const rate    = (parseFloat(booking.totalAmount) / nights).toFixed(2)
  const total   = parseFloat(booking.totalAmount)
  const balance = parseFloat(booking.balanceDue)

  const doc = React.createElement(Document, {},
    React.createElement(Page, { size: 'A4', style: s.page },

      // Header
      React.createElement(View, { style: s.col },
        React.createElement(Text, { style: s.company }, COMPANY.name),
        React.createElement(Text, { style: s.subtext }, COMPANY.address),
        React.createElement(Text, { style: s.subtext }, COMPANY.phone),
        React.createElement(Text, { style: s.subtext }, COMPANY.email),
      ),

      React.createElement(Text, { style: s.heading }, 'Cash Invoice'),

      // Bill to + meta
      React.createElement(View, { style: { ...s.row, justifyContent: 'space-between', marginBottom: 10 } },
        React.createElement(View, { style: s.col },
          React.createElement(Text, { style: { ...s.subtext, color: '#aaa', marginBottom: 3 } }, 'BILL TO'),
          React.createElement(Text, { style: { ...s.bold, fontSize: 10 } }, booking.guestName),
        ),
        React.createElement(View, { style: s.col },
          React.createElement(View, { style: s.metaRow },
            React.createElement(Text, { style: s.metaLabel }, 'INVOICE'),
            React.createElement(Text, { style: s.metaValue }, invNo),
          ),
          React.createElement(View, { style: s.metaRow },
            React.createElement(Text, { style: s.metaLabel }, 'DATE'),
            React.createElement(Text, { style: s.metaValue }, invDate),
          ),
          React.createElement(View, { style: s.metaRow },
            React.createElement(Text, { style: s.metaLabel }, 'TERMS'),
            React.createElement(Text, { style: s.metaValue }, 'Due on receipt'),
          ),
          React.createElement(View, { style: s.metaRow },
            React.createElement(Text, { style: s.metaLabel }, 'DUE DATE'),
            React.createElement(Text, { style: s.metaValue }, invDate),
          ),
        ),
      ),

      // Table header
      React.createElement(View, { style: s.tableHead },
        React.createElement(Text, { style: { ...s.tableHeadTx, width: 70 } }, 'DATE'),
        React.createElement(Text, { style: { ...s.tableHeadTx, width: 90 } }, 'ACTIVITY'),
        React.createElement(Text, { style: { ...s.tableHeadTx, flex: 1 } }, 'DESCRIPTION'),
        React.createElement(Text, { style: { ...s.tableHeadTx, width: 35, textAlign: 'right' } }, 'NIGHTS'),
        React.createElement(Text, { style: { ...s.tableHeadTx, width: 60, textAlign: 'right' } }, 'RATE'),
        React.createElement(Text, { style: { ...s.tableHeadTx, width: 70, textAlign: 'right' } }, 'AMOUNT'),
      ),

      // Line item
      React.createElement(View, { style: s.tableRow },
        React.createElement(Text, { style: { ...s.tableCell, width: 70 } }, fmtDate(booking.checkIn)),
        React.createElement(Text, { style: { ...s.tableCell, width: 90 } }, roomLabel(room.type)),
        React.createElement(Text, { style: { ...s.tableCell, flex: 1 } }, room.name),
        React.createElement(Text, { style: { ...s.tableCell, width: 35, textAlign: 'right' } }, String(nights)),
        React.createElement(Text, { style: { ...s.tableCell, width: 60, textAlign: 'right' } }, parseFloat(rate).toFixed(2)),
        React.createElement(Text, { style: { ...s.tableCell, width: 70, textAlign: 'right' } }, total.toFixed(2)),
      ),

      React.createElement(View, { style: { ...s.divider, marginTop: 16 } }),

      // Totals
      React.createElement(View, { style: s.totalsRow },
        React.createElement(Text, { style: s.totalsLabel }, 'TOTAL'),
        React.createElement(Text, { style: s.totalsValue }, fmt(total)),
      ),
      React.createElement(View, { style: { ...s.totalsRow, marginTop: 4 } },
        React.createElement(Text, { style: s.balLabel }, 'BALANCE DUE'),
        React.createElement(Text, { style: s.balValue }, fmt(balance)),
      ),

      // Banking details
      React.createElement(View, { style: s.banking },
        React.createElement(Text, { style: s.bankingTitle }, 'PAYMENT DETAILS'),
        React.createElement(Text, {}, `${COMPANY.bank}  ·  Account # ${COMPANY.account}  ·  Ref: INV ${invNo}`),
      ),
    )
  )

  const buffer = await renderToBuffer(doc)
  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="Invoice-${invNo}.pdf"`,
    },
  })
}
