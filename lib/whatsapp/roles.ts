import { eq } from 'drizzle-orm'
import { db, drivers } from '@/lib/db'
import { toE164 } from './config'
import { loadSettings } from './settings'

/** Which side of the conversation a number is on. Unknown numbers are guests. */
export async function roleFor(phone: string): Promise<'guest' | 'ops' | 'driver'> {
  const e164 = toE164(phone)
  const { opsWhatsapp } = await loadSettings()
  if (opsWhatsapp && e164 === toE164(opsWhatsapp)) return 'ops'

  const [driver] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.phone, e164))
  return driver ? 'driver' : 'guest'
}
