/**
 * Narrow structural port over the bits of expo-sqlite's SQLiteDatabase that
 * our repositories actually use.
 *
 * Why this exists: `SQLiteDatabase` is backed by a native module, so importing
 * it for real inside Jest pulls in a native binding that does not exist on the
 * Windows workstation. Repositories depend on this interface instead, which a
 * real `SQLiteDatabase` satisfies structurally at the call site while tests
 * pass an in-memory fake. That keeps the §21 promise that pure logic — batching,
 * row mapping, dedup accounting — is unit-testable without hardware.
 *
 * This is a port, not an abstraction layer: it deliberately mirrors expo-sqlite's
 * shape rather than inventing a query DSL.
 */

/** Mirrors expo-sqlite's SQLiteBindValue so a real database satisfies this port. */
export type SqlBindValue = string | number | boolean | null | Uint8Array

export interface SqlStatementResult<TRow> {
  getAllSync(): TRow[]
}

export interface SqlStatement {
  /**
   * Params are required (pass `[]` for none) because expo-sqlite's own
   * signature is non-optional; an optional parameter here would not be
   * satisfied by the real SQLiteDatabase.
   */
  executeSync<TRow = unknown>(params: SqlBindValue[]): SqlStatementResult<TRow>
  finalizeSync(): void
}

export interface SqlPort {
  execSync(sql: string): void
  prepareSync(sql: string): SqlStatement
}
