# Impact assessment — Aster DB, PostgreSQL 14 → 18

Date: 2026-09-14
Source of the change list: `backend/major_changes_postgresql_11_18.pdf` (PG 11→18).
Only the **15 / 16 / 17 / 18** sections apply — 11→14 is already in place.

## 1. What the server actually is

Verified live via `run_sql`, not assumed:


| Fact                                              | Value                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Server version                                    | PostgreSQL **14.23** (x86_64-pc-linux-gnu, gcc 13.2.0)                                                                          |
| Platform                                          | **Azure Database for PostgreSQL Flexible Server** (`azure` 1.1, `pgaadauth` 1.7, `azure_maintenance` / `azure_sys` DBs present) |
| Login role                                        | `asterusr`; `public` schema owned by `azure_pg_admin`                                                                           |
| Databases                                         | `postgres` = Aster (**60 MB**, 151 tables), `blockscout` (**10.1 GB**)                                                          |
| Collation                                         | both DBs `en_US.utf8` (**glibc**, not ICU)                                                                                      |
| `data_checksums`                                  | **on** already                                                                                                                  |
| Extensions                                        | `plpgsql` 1.0, `uuid-ossp` 1.1, `pg_cron` **1.4-1** (default available: 1.6), `azure` 1.1, `pgaadauth` 1.7                      |
| Objects                                           | 151 tables, 240 indexes, 99 FKs, 1 trigger, 0 views, 0 matviews, 0 partitioned tables                                           |
| Routines                                          | 10 functions in `public`, **all of them** `uuid-ossp` **C functions** — zero custom PL/pgSQL                                    |
| Generated columns                                 | **0**                                                                                                                           |
| Logical replication                               | 0 publications, 0 subscriptions, 0 replication slots                                                                            |
| Prepared xacts / event triggers / unlogged tables | 0 / 0 / 0                                                                                                                       |


The version target is available: PG 18 is **GA on Azure Flexible Server** (current minor 18.6) with
in-place major version upgrade support.

## 2. Blockers and gates (resolve before scheduling)


| #   | Item                                                                                                                                                                                                                                                                  | Status                                                                              | Action                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | `pg_cron` **1.4-1 is stale by two minor lines.** pg_cron gained PG16 support in 1.6.0 and PG17/18 support in later 1.6.x patches. 1.4 predates all of it. It is in `shared_preload_libraries`, so an incompatible binary blocks server start, not just the extension. | Open                                                                                | `ALTER EXTENSION pg_cron UPDATE;` to the version Azure ships for PG18, and confirm the target minor supports 18 before the window. Also capture `cron.job` contents first — the `cron` schema is not readable as `asterusr`, so the job list is currently unknown to us. |
| B2  | **Read replicas / geo-replication must be deleted first.** Azure does not support in-place upgrade with a replica attached (including cascading).                                                                                                                     | Unknown                                                                             | Check the portal. `pg_stat_replication` shows 0 rows, but Azure's same-zone/zone-redundant HA standby does not appear there, so SQL cannot answer this.                                                                                                                  |
| B3  | **Azure pre-upgrade validation** also fails on unsupported extensions (`dblink`, `postgres_fdw`, `timescaledb`, `orafce`, `anon`, AGE), logical slots, prepared transactions, event triggers, and pending restart-required parameter changes.                         | Clear on the SQL-visible items (all zero; none of the blocked extensions installed) | Run Azure's validate-only upgrade and read its report.                                                                                                                                                                                                                   |
| B4  | `blockscout` **(10.1 GB) rides along.** The upgrade is per-server, not per-database, so Blockscout is upgraded whether or not it is in scope, and it dominates downtime and post-upgrade reindex cost.                                                                | Open                                                                                | Confirm the Blockscout release in use is tested on PG18, and get its owner to sign off on the same window. This is the largest unscoped risk in the change.                                                                                                              |
| B5  | **MD5 password auth is deprecated in PG18.** Roles whose password is still an `md5` hash keep working but are on borrowed time.                                                                                                                                       | Unknown                                                                             | `pg_shadow` / `pg_authid` are not readable as `asterusr`. A DBA must run `SELECT rolname FROM pg_authid WHERE rolpassword LIKE 'md5%'` and rotate to SCRAM. 21 roles exist. Servers using Entra ID (`pgaadauth`) are unaffected for those principals.                    |




## 3. Highest correctness risk: glibc collation change

**80 of 240 indexes are collation-dependent**, and both databases use glibc `en_US.utf8`. A major
version upgrade moves to a new OS image, which can change glibc's collation rules. PostgreSQL does
not re-sort existing indexes, so a changed rule leaves text B-trees silently mis-ordered:
range scans and equality lookups miss rows, and **unique indexes stop detecting duplicates**.

PG15 added collation version tracking, so PG18 will *warn* — but only when the affected index is
touched, and warnings in the Azure log are easy to miss.

Collation-dependent **unique / primary key** indexes, worst-case first:


| Index                                                           | Table                        | Why it matters                                         |
| --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| `wallet_address_idx`, `wallet_address_user_idx`                 | `user`                       | unique wallet addresses — duplicates would be admitted |
| `uq_reward_code`                                                | `reward_item_digital`        | unique reward codes — double-redemption                |
| `employee_email_current_idx`                                    | `employee`                   | unique current email                                   |
| `token_owners_pkey`                                             | `token_owners`               | 872 kB, largest                                        |
| `claimed_events_pkey`                                           | `claimed_events`             | claim idempotency                                      |
| `airdrop_session_user_pkey`, `registered_session_user_pkey`     | session tables               | per-user uniqueness                                    |
| `ux_aur_wallet_achievement_reward`, `ux_aur_wallet_achievement` | `achievement_user_reward`    | reward grant idempotency                               |
| `uq_achievement_user_whitelist_achievement_wallet`              | `achievement_user_whitelist` | whitelist uniqueness                                   |
| `uq_user_stage_reward`                                          | `season_pass_user_reward`    | season pass idempotency                                |
| `lot_of_luck_pool_un`                                           | `lot_of_luck_pool`           | draw pool uniqueness                                   |


**Mitigation:** `REINDEX DATABASE CONCURRENTLY` (or `reindexdb --concurrently --all`) immediately
after the upgrade, before reopening writes. At 60 MB the Aster DB is a few seconds; budget the real
time for `blockscout` at 10 GB. Then verify with
`SELECT * FROM pg_index WHERE indcollversion <> ...` / check for any remaining collation-version
mismatch warnings. Treat "reindex done and verified" as part of the definition of done for the
window, not a follow-up ticket.

## 4. Application-code impact



### 4.1 In this repo — confirmed

- `backend/agents/ingest/parsers/sql-schema.ts:45` calls `parse(normalized)` from `pgsql-ast-parser`
**with no try/catch**, and `parseSQLToSchema` is the only DDL path. `pgsql-ast-parser` 12.0.2 has no
grammar for PG18-only DDL — **temporal** `PERIOD` **constraints**, `NOT ENFORCED` **constraints**,
`NOT NULL ... NOT VALID`, and **virtual generated columns**. The first PG18-only construct that
lands in an ingested DDL file throws and takes the whole `ingest:ddl` run with it, not just that
statement. Fix: wrap the parse per statement and skip-with-warning, independently of the upgrade.
- `backend/database/postgres.ts` uses `pg` 8.23 (`Pool`, `BEGIN TRANSACTION READ ONLY`,
`statement_timeout`, `$1` placeholders). All PG18-compatible. PG18's **wire protocol 3.2** is
opt-in; `pg` continues to negotiate 3.0 and is unaffected.
- No ORM, no migration framework, no raw DDL executed by this backend against Aster. `run_sql`
rejects DDL by design.



### 4.2 Outside this repo — needs a grep in the Go admin-service and Aster Web repos

Not present in this working tree, so unverified. Three greps worth running:

1. `RETURNING` **with** `old` **/** `new` — PG18 gives `OLD.` and `NEW.` meaning inside `RETURNING`.
  A query returning a column or alias literally named `old` or `new` can now resolve differently.
2. `GENERATED ALWAYS AS (...)` **without** `STORED` — in PG18 the default is **VIRTUAL**
  (computed at read time, not stored, not indexable). The live schema has **zero** generated
   columns today, so nothing existing breaks; this is a forward-looking DDL trap. Always write
   `STORED` explicitly.
3. **Anything parsing** `EXPLAIN ANALYZE` **text output** — PG18 includes buffer usage by default, so
  the output shape changes.



## 5. Confirmed non-impacts

Ruled out against the live schema, so they need no work:

- **PG15** `public` **schema hardening** — the ACL is still the pre-15 `=UC/azure_pg_admin`
(PUBLIC holds CREATE), plus explicit `deployusr=UC` and `blockscoutusr=U`. An **in-place**
upgrade is `pg_upgrade` and preserves ACLs, so migrations keep working. *This only bites on a
dump-and-restore into a fresh PG18 server*, where the new cluster's `public` gets the PG15+
default and DDL as `deployusr`/`asterusr` starts failing with `permission denied for schema public`.
If the route changes from in-place to migrate-and-cut-over, re-grant explicitly.
- **PG12** `WITH OIDS`**, PG13 pre-8.0 opclass syntax, PG15 PL/Python 2, PG15 exclusive backup mode** —
nothing in the schema uses any of them. Backups are Azure-managed.
- **PG18 data checksums on by default** — already `on`, so no `pg_upgrade` checksum mismatch.
- **Custom procedural code** — none. Zero PL/pgSQL functions, 1 trigger, 0 views, 0 matviews.
Nothing to port.
- **Logical replication rework (PG15/16/17)** — no publications, subscriptions, or slots.
- **Partitioning changes** — no partitioned tables.
- `uuid-ossp` — `uuid_generate_v4()` etc. keep working; PG18's native `uuidv7()` does not
collide with them.



## 6. Worth taking, once on 18

Not required by the upgrade; cheap wins it unlocks.

- `uuidv7()` — timestamp-ordered UUIDs. Aster's `uuid_generate_v4()` defaults produce random
keys that fragment B-trees on insert. New tables should use `uuidv7()`.
- **Async I/O** (`io_method`, default `worker`) — the PDF's headline 3x read claim applies to
sequential scans, bitmap heap scans, and vacuum. Note the worker processes are new; check the
Azure SKU's memory headroom rather than assuming the default is free.
- **Skip scan** — multicolumn indexes become usable without the leading column. May let some of
the 240 indexes be dropped; re-examine after upgrading, with real plans.
- `NOT NULL ... NOT VALID` — adds a not-null constraint without a full table scan. Relevant to
future migrations on the larger Blockscout tables.
- `MERGE` **(PG15)** — replaces hand-rolled `INSERT ... ON CONFLICT` idempotency in the reward and
achievement grant paths.
- **Tighten** `public` — the PUBLIC `CREATE` grant is the pre-15 default and is worth revoking on
its own merits, separately from the upgrade window so a failure is attributable.



## 7. Recommended sequence

1. Read the `cron.job` list and the `pg_authid` password types (needs a role above `asterusr`). Resolve B1 and B5.
2. Confirm Blockscout's PG18 support and get its owner into the window (B4). Check for read replicas (B2).
3. Run Azure's **validate-only** major version upgrade; fix everything it reports (B3).
4. Restore a PITR copy to a throwaway PG18 server. Run the app test suites and the PVT-style
  read checks against it. This is where collation damage shows up cheaply.
5. Snapshot, then upgrade in place. Keep the pre-upgrade backup until step 7 passes.
6. `reindexdb --concurrently --all` on both databases, then verify no collation-version
  mismatches remain. Do not reopen writes before this completes.
7. `ANALYZE` both databases (PG18 preserves statistics across upgrade, but re-analyzing is cheap),
  then compare plans on the hottest queries.



## 8. Open questions

- Is the upgrade **in place** or **migrate-and-cut-over**? It changes the `public` schema ACL
answer in §5 and the downtime profile. The assessment above assumes in place.
- What is the acceptable downtime window? 10.1 GB of Blockscout plus its reindex, not Aster's
60 MB, sets the floor.
- Who owns `blockscout`, and is it in scope for this change at all?
- Which roles still authenticate with MD5 (B5)?



## Sources

- `backend/major_changes_postgresql_11_18.pdf`
- [PostgreSQL 18 Now GA on Azure Postgres Flexible Server](https://techcommunity.microsoft.com/blog/adforpostgresql/postgresql-18-now-ga-on-azure-postgres-flexible-server/4469802)
- [Supported versions of PostgreSQL in Azure Database for PostgreSQL flexible server](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-supported-versions)
- [Major Version Upgrades — Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-major-version-upgrade)
- [Major version upgrade in Azure Database for PostgreSQL Flexible Server (how-to)](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/how-to-perform-major-version-upgrade)
- [Considerations when using extensions and modules](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-considerations)
- [Read replicas in Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas)

