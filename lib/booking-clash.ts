// The database refuses to put two active bookings in the same room on the same night
// (drizzle/0022_booking_room_clash.sql) and raises exclusion_violation when asked to.
// Drizzle may wrap the driver's error, so look on the error and on its cause.
export function bookingClashMessage(err: unknown): string | null {
  for (const e of [err, (err as any)?.cause]) {
    if ((e as any)?.code === '23P01') return (e as any).message ?? 'Room is already booked for those dates'
  }
  return null
}
