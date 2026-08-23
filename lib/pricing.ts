// Room-capacity guidance shared by the pricelist page and booking forms.
// Booking totals are entered manually — see app/dashboard/bookings/{new,[id]}/page.tsx.

// Soft guidance only — front desk may still override for specific guests.
export function minOccupancy(capacity: number): number {
  return Math.max(1, capacity - 1)
}
