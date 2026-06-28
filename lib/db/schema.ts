import {
  pgTable, serial, text, integer, numeric, boolean,
  timestamp, date, pgEnum, unique,
} from 'drizzle-orm/pg-core'

// ── Unchanged enums ───────────────────────────────────────────────────────────
export const roomTypeEnum  = pgEnum('room_type',  ['premium', 'budget', 'dorm', 'camping'])
export const bookingStatus = pgEnum('booking_status', [
  'confirmed', 'pending', 'cancelled', 'checked_in', 'checked_out',
  'fully_paid', 'partially_paid', 'quote_sent', 'unpaid',
])
export const payrollStatus = pgEnum('payroll_status', ['draft', 'finalised'])

// ── New enums ─────────────────────────────────────────────────────────────────
export const entityTypeEnum   = pgEnum('entity_type',   ['kanaan', 'plant_hire', 'investment_project'])
export const workerTypeEnum   = pgEnum('worker_type',   ['employee', 'contractor'])
export const payStructureEnum = pgEnum('pay_structure', ['hourly', 'daily', 'floor'])
export const dayTypeEnum      = pgEnum('day_type',      ['weekday', 'saturday', 'sunday', 'public_holiday'])
export const advanceTypeEnum  = pgEnum('advance_type',  ['cash_advance', 'shop_deduction'])
export const dataSourceEnum   = pgEnum('data_source',   ['whatsapp', 'photo_timesheet', 'manual'])

// ── Rooms & Bookings (unchanged) ──────────────────────────────────────────────
export const rooms = pgTable('rooms', {
  id:       serial('id').primaryKey(),
  name:     text('name').notNull(),
  type:     roomTypeEnum('type').notNull(),
  capacity: integer('capacity').notNull().default(2),
  ratePp:   numeric('rate_pp',   { precision: 10, scale: 2 }).notNull(),
  rateSolo: numeric('rate_solo', { precision: 10, scale: 2 }),
  active:   boolean('active').notNull().default(true),
}, t => [unique().on(t.name)])

export const bookings = pgTable('bookings', {
  id:              serial('id').primaryKey(),
  roomId:          integer('room_id').notNull().references(() => rooms.id),
  guestName:       text('guest_name').notNull(),
  contact:         text('contact').notNull(),
  idNumber:        text('id_number'),
  checkIn:         date('check_in').notNull(),
  checkOut:        date('check_out').notNull(),
  adults:          integer('adults').notNull().default(1),
  children:        integer('children').notNull().default(0),
  nights:          integer('nights').notNull(),
  totalAmount:     numeric('total_amount',  { precision: 10, scale: 2 }).notNull(),
  depositPaid:     numeric('deposit_paid',  { precision: 10, scale: 2 }).notNull().default('0'),
  balanceDue:      numeric('balance_due',   { precision: 10, scale: 2 }).notNull(),
  specialRequests: text('special_requests'),
  status:          bookingStatus('status').notNull().default('confirmed'),
  source:          text('source'),
  paymentMethod:   text('payment_method'),
  invoiceNumber:   text('invoice_number'),
  payDate:         date('pay_date'),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
})

// ── Entities (Kanaan / Plant Hire / Investment Project) ───────────────────────
export const entities = pgTable('entities', {
  id:             serial('id').primaryKey(),
  name:           text('name').notNull(),           // legal name
  tradingName:    text('trading_name'),
  registrationNo: text('registration_no'),
  uifRef:         text('uif_ref'),
  payeRef:        text('paye_ref'),
  entityType:     entityTypeEnum('entity_type').notNull(),
  address:        text('address'),
  active:         boolean('active').notNull().default(true),
})

// ── Workers (replaces employees — covers all 3 entities) ──────────────────────
export const workers = pgTable('workers', {
  id:           serial('id').primaryKey(),
  entityId:     integer('entity_id').notNull().references(() => entities.id),
  name:         text('name').notNull(),
  idNumber:     text('id_number'),           // employees only; contractors informal
  bankAccount:  text('bank_account'),
  bankName:     text('bank_name'),
  workerType:   workerTypeEnum('worker_type').notNull(),
  payStructure: payStructureEnum('pay_structure').notNull(),

  // hourly (Flora, Lilian, Judith, Mathabo, Patrick, Bheki)
  hourlyRate:     numeric('hourly_rate',      { precision: 10, scale: 2 }),
  stdHoursPerDay: numeric('std_hours_per_day',{ precision: 4,  scale: 2 }), // 6.5 or 8

  // daily (Joseph, Zweli, Lucas, Walter)
  dailyRate: numeric('daily_rate', { precision: 10, scale: 2 }),

  // floor (Alpheus — R8 000 floor + R300/on-site Saturday)
  floorSalary:  numeric('floor_salary',  { precision: 10, scale: 2 }),
  saturdayRate: numeric('saturday_rate', { precision: 10, scale: 2 }),

  department: text('department'),
  position:   text('position'),
  startDate:  date('start_date'),
  active:     boolean('active').notNull().default(true),
  notes:      text('notes'),
})

// ── Worker aliases (WhatsApp informal name variants) ──────────────────────────
export const workerAliases = pgTable('worker_aliases', {
  id:       serial('id').primaryKey(),
  workerId: integer('worker_id').notNull().references(() => workers.id),
  alias:    text('alias').notNull(),   // e.g. 'Alfos', 'Florah', 'Lukas', 'Zwele', 'Patric'
})

// ── SA Public Holidays ────────────────────────────────────────────────────────
export const publicHolidays = pgTable('public_holidays', {
  id:   serial('id').primaryKey(),
  date: date('date').notNull().unique(),
  name: text('name').notNull(),
  year: integer('year').notNull(),
})

// ── Payroll runs (entity-scoped) ──────────────────────────────────────────────
export const payrollRuns = pgTable('payroll_runs', {
  id:          serial('id').primaryKey(),
  entityId:    integer('entity_id').notNull().references(() => entities.id),
  periodStart: date('period_start').notNull(),
  periodEnd:   date('period_end').notNull(),
  status:      payrollStatus('status').notNull().default('draft'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

// ── Attendance days (per worker, per day) ─────────────────────────────────────
export const attendanceDays = pgTable('attendance_days', {
  id:                serial('id').primaryKey(),
  workerId:          integer('worker_id').notNull().references(() => workers.id),
  runId:             integer('run_id').references(() => payrollRuns.id),
  date:              date('date').notNull(),
  dayType:           dayTypeEnum('day_type').notNull(),
  hoursWorked:       numeric('hours_worked',        { precision: 5, scale: 2 }),
  absent:            boolean('absent').notNull().default(false),
  absenceReason:     text('absence_reason'),         // 'sick' | 'annual_leave' | 'unpaid' | 'other'
  calculatedAmount:  numeric('calculated_amount',    { precision: 10, scale: 2 }),
  phDoubleConfirmed: boolean('ph_double_confirmed'), // null=pending, true=pay double, false=normal
  source:            dataSourceEnum('source').notNull().default('manual'),
  note:              text('note'),
})

// ── Advances & shop deductions (running ledger per worker) ────────────────────
export const advances = pgTable('advances', {
  id:          serial('id').primaryKey(),
  workerId:    integer('worker_id').notNull().references(() => workers.id),
  runId:       integer('run_id').references(() => payrollRuns.id),
  date:        date('date').notNull(),
  amount:      numeric('amount', { precision: 10, scale: 2 }).notNull(),
  advanceType: advanceTypeEnum('advance_type').notNull(),
  note:        text('note'),
  source:      dataSourceEnum('source').notNull().default('manual'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

// ── WhatsApp chat parse records ───────────────────────────────────────────────
export const whatsappParses = pgTable('whatsapp_parses', {
  id:            serial('id').primaryKey(),
  rawText:       text('raw_text').notNull(),
  parsedMonth:   text('parsed_month'),     // '2026-06'
  extractedJson: text('extracted_json'),   // JSON: [{date, workerName, event, amount}]
  confirmedAt:   timestamp('confirmed_at'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
})

// ── Timesheet photo uploads ───────────────────────────────────────────────────
export const timesheetUploads = pgTable('timesheet_uploads', {
  id:          serial('id').primaryKey(),
  workerId:    integer('worker_id').references(() => workers.id),
  imageUrl:    text('image_url'),
  ocrRaw:      text('ocr_raw'),
  parsedJson:  text('parsed_json'),  // JSON: [{date, hoursWorked, note}]
  confirmedAt: timestamp('confirmed_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

// ── Payroll entries ───────────────────────────────────────────────────────────
export const payrollEntries = pgTable('payroll_entries', {
  id:       serial('id').primaryKey(),
  runId:    integer('run_id').notNull().references(() => payrollRuns.id),
  workerId: integer('worker_id').notNull().references(() => workers.id),

  // hours / days worked
  ordinaryHours: numeric('ordinary_hours', { precision: 6, scale: 2 }).notNull().default('0'),
  saturdayHours: numeric('saturday_hours', { precision: 6, scale: 2 }).notNull().default('0'),
  phHours:       numeric('ph_hours',       { precision: 6, scale: 2 }).notNull().default('0'),
  daysWorked:    numeric('days_worked',    { precision: 5, scale: 1 }).notNull().default('0'),
  saturdayDays:  numeric('saturday_days',  { precision: 4, scale: 1 }).notNull().default('0'),

  // earnings
  basicPay:       numeric('basic_pay',       { precision: 10, scale: 2 }).notNull().default('0'),
  saturdayPay:    numeric('saturday_pay',    { precision: 10, scale: 2 }).notNull().default('0'),
  phPay:          numeric('ph_pay',          { precision: 10, scale: 2 }).notNull().default('0'),
  bonus:          numeric('bonus',           { precision: 10, scale: 2 }).notNull().default('0'),
  otherAdditions: numeric('other_additions', { precision: 10, scale: 2 }).notNull().default('0'),

  // deductions
  salaryAdvance:  numeric('salary_advance',  { precision: 10, scale: 2 }).notNull().default('0'),
  shopDeductions: numeric('shop_deductions', { precision: 10, scale: 2 }).notNull().default('0'),
  uifEmployee:    numeric('uif_employee',    { precision: 10, scale: 2 }).notNull().default('0'),
  uifEmployer:    numeric('uif_employer',    { precision: 10, scale: 2 }).notNull().default('0'),
  otherDeductions:numeric('other_deductions',{ precision: 10, scale: 2 }).notNull().default('0'),

  // totals
  grossPay: numeric('gross_pay', { precision: 10, scale: 2 }).notNull().default('0'),
  netPay:   numeric('net_pay',   { precision: 10, scale: 2 }).notNull().default('0'),

  // leave (employees only)
  annualLeaveDaysTaken: numeric('annual_leave_days_taken', { precision: 4, scale: 1 }).notNull().default('0'),
  sickLeaveDaysTaken:   numeric('sick_leave_days_taken',   { precision: 4, scale: 1 }).notNull().default('0'),

  // contractor invoice fields
  contractorInvoiceNo:   text('contractor_invoice_no'),
  engagementDescription: text('engagement_description'),

  // Alpheus TLB — placeholder until Fuel Recon module is built
  tlbReconSummary: text('tlb_recon_summary'), // JSON: {offSiteHours, clients, dieselLitres}

  // PAYE monitoring (Plant Hire / Alpheus)
  payeTaxableAmount: numeric('paye_taxable_amount', { precision: 10, scale: 2 }),

  notes: text('notes'),
})

// ── Fuel logs ─────────────────────────────────────────────────────────────────
export const fuelLogs = pgTable('fuel_logs', {
  id:        serial('id').primaryKey(),
  logDate:   date('log_date').notNull(),
  vehicle:   text('vehicle').notNull(),
  openReading:  numeric('open_reading',  { precision: 10, scale: 2 }),
  closeReading: numeric('close_reading', { precision: 10, scale: 2 }),
  litres:    numeric('litres', { precision: 8, scale: 2 }).notNull(),
  purpose:   text('purpose'),
  notes:     text('notes'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ── Staff log (mobile freetext entries for payroll prep) ──────────────────────
export const staffLogTypeEnum = pgEnum('staff_log_type', [
  'hours', 'advance', 'shop_purchase', 'note',
])

export const staffLogEntries = pgTable('staff_log_entries', {
  id:        serial('id').primaryKey(),
  workerId:  integer('worker_id').references(() => workers.id),
  workerName: text('worker_name').notNull(), // denormalised for quick entry
  logType:   staffLogTypeEnum('log_type').notNull().default('note'),
  logDate:   date('log_date').notNull(),
  message:   text('message').notNull(),
  amount:    numeric('amount', { precision: 10, scale: 2 }),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ── Leave balances (employees only) ──────────────────────────────────────────
export const leaveBalances = pgTable('leave_balances', {
  id:                serial('id').primaryKey(),
  workerId:          integer('worker_id').notNull().references(() => workers.id),
  year:              integer('year').notNull(),
  annualDaysAccrued: numeric('annual_days_accrued', { precision: 5, scale: 2 }).notNull().default('0'),
  annualDaysTaken:   numeric('annual_days_taken',   { precision: 5, scale: 2 }).notNull().default('0'),
  sickDaysTaken:     numeric('sick_days_taken',     { precision: 5, scale: 2 }).notNull().default('0'),
  toilHours:         numeric('toil_hours',           { precision: 6, scale: 2 }).notNull().default('0'),
})
