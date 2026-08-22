/**
 * Structured logger with field classification per spec §20.4:
 *   - 'safe'              → included in all logs and exports
 *   - 'device-sensitive'  → removed from normal support exports unless
 *                           diagnostic detail is enabled
 *   - 'secret'            → NEVER logged; treated as a bug if encountered
 *
 * Domain code should call the module-level helpers (info/warn/error/event)
 * and let the sink handle the classification. Nothing here imports from
 * React or React Native — that lets the logger be unit-tested and used
 * from workers or scripts.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type FieldClass = 'safe' | 'device-sensitive' | 'secret'

export interface ClassifiedField {
  /** Field value. */
  value: unknown
  /** Classification per §20.4. */
  class: FieldClass
}

export interface LogRecord {
  level: LogLevel
  monotonicTimeMs: number
  wallTimeIso: string
  code: string
  message: string
  fields: Record<string, ClassifiedField>
}

export interface LogSink {
  write(record: LogRecord): void
}

class ConsoleSink implements LogSink {
  write(r: LogRecord): void {
    const visible: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r.fields)) {
      if (v.class === 'secret') continue
      visible[k] = v.value
    }
    const tag = `[${r.level.toUpperCase()}] ${r.code}`
    if (r.level === 'error') console.error(tag, r.message, visible)
    else if (r.level === 'warn') console.warn(tag, r.message, visible)
    else console.info(tag, r.message, visible)
  }
}

const sinks: LogSink[] = [new ConsoleSink()]
export function addSink(s: LogSink): void { sinks.push(s) }
export function replaceSinks(next: LogSink[]): void {
  sinks.length = 0
  sinks.push(...next)
}

function nowMonotonicMs(): number {
  // performance.now() is monotonic across React Native, Node, and JSCore.
  // Fall back to Date.now() only when performance is truly missing.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/** Mark a value as 'safe' — appears everywhere. Shortcut for `{value, class:'safe'}`. */
export function safe(value: unknown): ClassifiedField { return { value, class: 'safe' } }
export function deviceSensitive(value: unknown): ClassifiedField { return { value, class: 'device-sensitive' } }
export function secret(_value: unknown): ClassifiedField {
  // Never store the actual value — the classifier's contract is that a
  // 'secret' field never leaves this call. Store only a marker.
  return { value: '[redacted]', class: 'secret' }
}

export function log(level: LogLevel, code: string, message: string, fields: Record<string, ClassifiedField> = {}): void {
  const record: LogRecord = {
    level,
    monotonicTimeMs: nowMonotonicMs(),
    wallTimeIso: new Date().toISOString(),
    code,
    message,
    fields,
  }
  for (const s of sinks) s.write(record)
}

export const logger = {
  debug: (code: string, message: string, fields?: Record<string, ClassifiedField>) => log('debug', code, message, fields),
  info: (code: string, message: string, fields?: Record<string, ClassifiedField>) => log('info', code, message, fields),
  warn: (code: string, message: string, fields?: Record<string, ClassifiedField>) => log('warn', code, message, fields),
  error: (code: string, message: string, fields?: Record<string, ClassifiedField>) => log('error', code, message, fields),
} as const
