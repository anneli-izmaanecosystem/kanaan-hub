import { Redis } from '@upstash/redis'

let _redis: Redis | undefined

function getRedis() {
  if (!_redis) {
    _redis = new Redis({
      url:   (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL)!,
      token: (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN)!,
    })
  }
  return _redis
}

export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return (getRedis() as any)[prop]
  },
})
