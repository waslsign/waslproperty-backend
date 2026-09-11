-- Organisation-level currency support. Safe/additive throughout: no data
-- is dropped, and ContractorQuote's existing "currency" values are
-- preserved via RENAME COLUMN rather than the DROP+ADD a naive diff would
-- produce (which would have silently reset every existing quote to the new
-- default, losing its real historical value).

-- Organisation gets a currencyCode, defaulting existing rows to AUD.
ALTER TABLE "organisations" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'AUD';

-- WorkOrder is a new currency-aware field — no prior value to preserve, so
-- every existing row gets AUD.
ALTER TABLE "work_orders" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'AUD';

-- ContractorQuote already stored a currency; only the column name and the
-- forward-looking default change. Existing rows keep whatever value they
-- already had (including the old hard-coded 'AED' default) — historical
-- financial records are never rewritten by this migration.
ALTER TABLE "contractor_quotes" RENAME COLUMN "currency" TO "currencyCode";
ALTER TABLE "contractor_quotes" ALTER COLUMN "currencyCode" SET DEFAULT 'AUD';
