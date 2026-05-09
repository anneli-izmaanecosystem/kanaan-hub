import { pgTable, serial, text, integer, numeric, boolean, timestamp, date, pgEnum } from 'drizzle-orm/pg-core'

export const payTypeEnum    = pgEnum('pay_type',    ['fixed_salary', 'hourly'])
export const hoursTypeEnum  = pgEnum('hours_type',  ['fixed_monthly', 'variable'])
export const roomTypeEnum   = pgEnum('room_type',   ['premium', 'budget', 'dorm', 'camping'])
export const bookingStatus  = pgEnum('booking_status', ['confirmed', 'pending', 'cancelled', 'checked_in', 'checked_out'])
export const payrollStatus  = pgEnum('payroll_status', ['draft', 'finalised'])

export const rooms = pgTable('rooms', {
  id:        serial('id').primaryKey(),
  name:      text('name').notNull(),
  type:      roomTypeEnum('type').notNull(),
  capacity:  integer('capacity').notNull().default(2),
  ratePp:    numeric('rate_pp', { precision: 10, scale: 2 }).notNull(),
  rateSolo:  numeric('rate_solo', { precision: 10, scale: 2 }),
  active:    boolean('active').notNull().default(true),
})

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
  totalAmount:     numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  depositPaid:     numeric('deposit_paid', { precision: 10, scale: 2 }).notNull().default('0'),
  balanceDue:      numeric('balance_due', { precision: 10, scale: 2 }).notNull(),
  specialRequests: text('special_requests'),
  status:          bookingStatus('status').notNull().default('confirmed'),
  source:          text('source'),
  notes:           text('notes'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
})

export const employees = pgTable('employees', {
  id:             serial('id').primaryKey(),
  name:           text('name').notNull(),
  idNumber:       text('id_number'),
  bankAccount:    text('bank_account'),
  bankName:       text('bank_name'),
  payType:        payTypeEnum('pay_type').notNull(),
  hoursType:      hoursTypeEnum('hours_type').notNull(),
  monthlySalary:  numeric('monthly_salary', { precision: 10, scale: 2 }),
  hourlyRate:     numeric('hourly_rate', { precision: 10, scale: 2 }),
  fixedHours:     numeric('fixed_hours', { precision: 6, scale: 2 }),
  department:     text('department'),
  position:       text('position'),
  startDate:      date('start_date'),
  active:         boolean('active').notNull().default(true),
})

export const payrollRuns = pgTable('payroll_runs', {
  id:          serial('id').primaryKey(),
  periodStart: date('period_start').notNull(),
  periodEnd:   date('period_end').notNull(),
  status:      payrollStatus('status').notNull().default('draft'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
})

export const payrollEntries = pgTable('payroll_entries', {
  id:               serial('id').primaryKey(),
  runId:            integer('run_id').notNull().references(() => payrollRuns.id),
  employeeId:       integer('employee_id').notNull().references(() => employees.id),
  ordinaryHours:    numeric('ordinary_hours',    { precision: 6, scale: 2 }).notNull().default('0'),
  overtimeHours:    numeric('overtime_hours',    { precision: 6, scale: 2 }).notNull().default('0'),
  sundayPhHours:    numeric('sunday_ph_hours',   { precision: 6, scale: 2 }).notNull().default('0'),
  basicPay:         numeric('basic_pay',         { precision: 10, scale: 2 }).notNull().default('0'),
  overtimePay:      numeric('overtime_pay',      { precision: 10, scale: 2 }).notNull().default('0'),
  bonus:            numeric('bonus',             { precision: 10, scale: 2 }).notNull().default('0'),
  otherAdditions:   numeric('other_additions',   { precision: 10, scale: 2 }).notNull().default('0'),
  uifEmployee:      numeric('uif_employee',      { precision: 10, scale: 2 }).notNull().default('0'),
  uifEmployer:      numeric('uif_employer',      { precision: 10, scale: 2 }).notNull().default('0'),
  leaveDeduction:   numeric('leave_deduction',   { precision: 10, scale: 2 }).notNull().default('0'),
  otherDeductions:  numeric('other_deductions',  { precision: 10, scale: 2 }).notNull().default('0'),
  grossPay:         numeric('gross_pay',         { precision: 10, scale: 2 }).notNull().default('0'),
  netPay:           numeric('net_pay',           { precision: 10, scale: 2 }).notNull().default('0'),
  leaveDaysTaken:   numeric('leave_days_taken',  { precision: 4, scale: 1 }).notNull().default('0'),
  notes:            text('notes'),
})

export const leaveBalances = pgTable('leave_balances', {
  id:                serial('id').primaryKey(),
  employeeId:        integer('employee_id').notNull().references(() => employees.id),
  year:              integer('year').notNull(),
  annualDaysAccrued: numeric('annual_days_accrued', { precision: 5, scale: 2 }).notNull().default('0'),
  annualDaysTaken:   numeric('annual_days_taken',   { precision: 5, scale: 2 }).notNull().default('0'),
  sickDaysTaken:     numeric('sick_days_taken',     { precision: 5, scale: 2 }).notNull().default('0'),
  toilHours:         numeric('toil_hours',          { precision: 6, scale: 2 }).notNull().default('0'),
})
