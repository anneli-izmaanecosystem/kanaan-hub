// A throwaway Postgres for the simulator: UTF8 (the live databases are UTF8), port 55432,
// data wiped on every start. Stays up until this process is stopped.
import EmbeddedPostgres from 'embedded-postgres'

const pg = new EmbeddedPostgres({
  databaseDir: new URL('./.pgdata', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  user: 'postgres', password: 'sim', port: 55432, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
})
await pg.initialise()
await pg.start()
for (const db of ['kanaan_hub', 'notification_service']) await pg.createDatabase(db)
console.log('READY postgresql://postgres:sim@127.0.0.1:55432')
const stop = async () => { await pg.stop(); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
setInterval(() => {}, 1 << 30)
