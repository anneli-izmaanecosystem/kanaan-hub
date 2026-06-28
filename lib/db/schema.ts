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

  // Setup: timesheet vs default hours
  usesTimesheet:     boolean('uses_timesheet').notNull().default(true),
  defaultHoursPerDay:  numeric('default_hours_per_day',  { precision: 4, scale: 2 }),
  defaultDaysInPeriod: integer('default_days_in_period'),
  defaultsApplied:   boolean('defaults_applied').notNull().default(false),

  notes: text('notes'),
})

// ── Fuel logs (legacy stub — superseded by fuelFills below) ──────────────────
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

// ── Fuel Log v2 ───────────────────────────────────────────────────────────────

export const fuelFillStatusEnum = pgEnum('fuel_fill_status', ['draft', 'final'])
export const fuelFillFlagEnum   = pgEnum('fuel_fill_flag',   ['ok', 'estimated', 'delivery', 'shortage'])
export const fuelAllocTypeEnum  = pgEnum('fuel_alloc_type',  ['onsite', 'offsite'])
export const alpheusDayTypeEnum = pgEnum('alpheus_day_type', ['onsite', 'offsite', 'partial'])
export const invoiceStatusEnum  = pgEnum('invoice_status',   ['unpaid', 'paid_cash', 'paid_eft', 'overdue'])

// Active R/litre rate is derived from the most recent fuel_purchases row.
// A fill's cost = fill.litres * fill.rate_per_litre (snapshotted at capture time).

export const fuelFills = pgTable('fuel_fills', {
  id:            serial('id').primaryKey(),
  fillDate:      date('fill_date').notNull(),
  driverId:      integer('driver_id').references(() => workers.id),   // nullable — allow unknown driver
  driverName:    text('driver_name').notNull(),                        // denormalised for quick display
  vehicle:       text('vehicle').notNull(),                            // 'TLB/JCB' | 'Pickup' | 'Bakkie' | 'Other'
  openReading:   numeric('open_reading',  { precision: 10, scale: 2 }),
  closeReading:  numeric('close_reading', { precision: 10, scale: 2 }),
  litres:        numeric('litres',        { precision: 8,  scale: 2 }).notNull(),
  isEstimated:   boolean('is_estimated').notNull().default(false),
  ratePerLitre:  numeric('rate_per_litre', { precision: 8, scale: 2 }).notNull(),
  photoUrl:      text('photo_url'),
  notes:         text('notes'),
  status:        fuelFillStatusEnum('status').notNull().default('draft'),
  flag:          fuelFillFlagEnum('flag').notNull().default('ok'),
  createdBy:     text('created_by'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
})

// One fill can be split across multiple allocations (on-site + off-site same day).
// litres across all allocations for a fill must sum to fill.litres.
// day_id links to alpheus_days when the match is confirmed (auto-match by date+driver).
export const fuelAllocations = pgTable('fuel_allocations', {
  id:          serial('id').primaryKey(),
  fillId:      integer('fill_id').notNull().references(() => fuelFills.id, { onDelete: 'cascade' }),
  dayId:       integer('day_id').references(() => alpheusDays.id),    // null until matched
  allocType:   fuelAllocTypeEnum('alloc_type').notNull(),
  clientName:  text('client_name'),    // required when offsite
  billingInfo: text('billing_info'),
  hoursWorked: numeric('hours_worked', { precision: 5, scale: 2 }),
  litres:      numeric('litres',       { precision: 8, scale: 2 }).notNull(),
  cost:        numeric('cost',         { precision: 10, scale: 2 }).notNull(), // litres * rate snapshotted
  notes:       text('notes'),
})

// Alpheus's working days — captured by manager.
// Matched to fuel fills by fillDate = alpheusDays.dayDate + driverName = 'Alpheus'.
export const alpheusDays = pgTable('alpheus_days', {
  id:        serial('id').primaryKey(),
  dayDate:   date('day_date').notNull(),
  dayType:   alpheusDayTypeEnum('day_type').notNull(),
  notes:     text('notes'),
  status:    fuelFillStatusEnum('status').notNull().default('draft'),  // reuse draft/final
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Per-client blocks within an Alpheus day (a partial day can have multiple clients).
export const alpheusDayClients = pgTable('alpheus_day_clients', {
  id:          serial('id').primaryKey(),
  dayId:       integer('day_id').notNull().references(() => alpheusDays.id, { onDelete: 'cascade' }),
  clientName:  text('client_name').notNull(),
  billingInfo: text('billing_info'),
  hoursWorked: numeric('hours_worked', { precision: 5, scale: 2 }).notNull(),
})

// Bulk diesel deliveries — saving a row updates the active R/litre rate.
export const fuelPurchases = pgTable('fuel_purchases', {
  id:            serial('id').primaryKey(),
  purchaseDate:  date('purchase_date').notNull(),
  supplier:      text('supplier').notNull().default('Bosbok Gas Nelspruit'),
  invoiceNo:     text('invoice_no'),
  docketNo:      text('docket_no'),
  litres:        numeric('litres',          { precision: 10, scale: 2 }).notNull(),
  pricePerLitre: numeric('price_per_litre', { precision: 8,  scale: 2 }).notNull(),
  totalExclVat:  numeric('total_excl_vat',  { precision: 12, scale: 2 }).notNull(),
  vatRate:       numeric('vat_rate',        { precision: 5,  scale: 2 }).notNull().default('0'),
  totalInclVat:  numeric('total_incl_vat',  { precision: 12, scale: 2 }).notNull(),
  notes:         text('notes'),
  createdBy:     text('created_by'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
})

// Client invoices generated from off-site summary.
// Not synced to QBO — used for reference and payment tracking only.
export const fuelInvoices = pgTable('fuel_invoices', {
  id:             serial('id').primaryKey(),
  invoiceNumber:  text('invoice_number').notNull().unique(),  // auto: INV-YYYY-NNNN
  clientName:     text('client_name').notNull(),
  billingInfo:    text('billing_info'),
  periodStart:    date('period_start').notNull(),
  periodEnd:      date('period_end').notNull(),
  hours:          numeric('hours',          { precision: 6, scale: 2 }).notNull(),
  tlbRate:        numeric('tlb_rate',       { precision: 8, scale: 2 }).notNull(),
  labourExclVat:  numeric('labour_excl_vat',{ precision: 12, scale: 2 }).notNull(),
  dieselLitres:   numeric('diesel_litres',  { precision: 8, scale: 2 }).notNull(),
  dieselRate:     numeric('diesel_rate',    { precision: 8, scale: 2 }).notNull(),
  dieselCost:     numeric('diesel_cost',    { precision: 12, scale: 2 }).notNull(),
  vatRate:        numeric('vat_rate',       { precision: 5, scale: 2 }).notNull().default('15'), // 0 for cash
  vatAmount:      numeric('vat_amount',     { precision: 12, scale: 2 }).notNull(),
  totalDue:       numeric('total_due',      { precision: 12, scale: 2 }).notNull(),
  paymentStatus:  invoiceStatusEnum('payment_status').notNull().default('unpaid'),
  paidAt:         timestamp('paid_at'),
  paymentMethod:  text('payment_method'),   // 'cash' | 'eft'
  notes:          text('notes'),
  createdBy:      text('created_by'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
})

// ── Staff log (mobile freetext entries for payroll prep) ──────────────────────
export const staffLogTypeEnum = pgEnum('staff_log_type', [
  'hours', 'advance', 'shop_purchase', 'note',
])

export const staffLogEntries = pgTable('staff_log_entries', {
  id:          serial('id').primaryKey(),
  workerId:    integer('worker_id').references(() => workers.id),
  workerName:  text('worker_name').notNull(),
  logType:     staffLogTypeEnum('log_type').notNull().default('note'),
  logDate:     date('log_date').notNull(),
  message:     text('message').notNull(),
  amount:      numeric('amount', { precision: 10, scale: 2 }),
  createdBy:   text('created_by'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
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
