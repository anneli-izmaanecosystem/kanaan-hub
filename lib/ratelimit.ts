import { Ratelimit } from '@upstash/ratelimit'
import { redis } from './redis'

export const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 m'),
  prefix: 'kanaan:rl',
})

// Rate limiting is a safety net, not a core feature — if Redis is unreachable or
// misconfigured, fail open rather than blocking every request behind it.
export async function checkRatelimit(userId: string): Promise<boolean> {
  try {
    const { success } = await ratelimit.limit(userId)
    return success
  } catch (err) {
    console.error('[ratelimit] failed open —', err)
    return true
  }
}
