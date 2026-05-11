import type { Config } from 'drizzle-kit'
import { config } from 'dotenv'
config({ path: '.env.local' })

export default {
  schema: './lib/db/schema.ts',
  out:    './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
} satisfies Config
