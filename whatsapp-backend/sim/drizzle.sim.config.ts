// The dashboard's schema, pushed into the simulator's local database only.
export default {
  schema: './lib/db/schema.ts',  // run from the repo root (see run.sh)
  dialect: 'postgresql',
  dbCredentials: { url: 'postgresql://postgres:sim@127.0.0.1:55432/kanaan_hub' },
}
