// Add SQLite triggers + partial unique index for ledger immutability.
// Prisma can't emit CHECK constraints or triggers, so we apply raw SQL.
// Idempotent (uses IF NOT EXISTS). Safe to re-run.
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

const SQL = [
  // One reversal per target entry (partial unique index)
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_reversal ON "LedgerEntry"(targetEntryId) WHERE kind = 'reversal';`,
  // Posted (confirmed) entries cannot be UPDATEd
  `CREATE TRIGGER IF NOT EXISTS ledger_no_update
   BEFORE UPDATE ON "LedgerEntry"
   WHEN OLD.status = 'confirmed'
   BEGIN
     SELECT RAISE(ABORT, 'posted entries are immutable: use a correcting entry');
   END;`,
  // Posted (confirmed) entries cannot be DELETEd
  `CREATE TRIGGER IF NOT EXISTS ledger_no_delete
   BEFORE DELETE ON "LedgerEntry"
   WHEN OLD.status = 'confirmed'
   BEGIN
     SELECT RAISE(ABORT, 'posted entries cannot be deleted');
   END;`,
]

async function main() {
  for (const stmt of SQL) {
    await db.$executeRawUnsafe(stmt)
    console.log("applied:", stmt.split("\n")[0].slice(0, 70))
  }
  console.log("Triggers + index ready.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
