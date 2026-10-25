type Fields = Record<string, unknown>
type LogFn = (msg: string, fields?: Fields) => void

export type Logger = { info: LogFn; warn: LogFn; error: LogFn }

/** JSON-lines logger. Fields never overwrite `level`, `msg` or `time`. */
export function createLogger(write: (line: string) => void = (line) => process.stdout.write(line + '\n')): Logger {
  const at = (level: 'info' | 'warn' | 'error'): LogFn => (msg, fields) =>
    write(JSON.stringify({ ...fields, level, msg, time: new Date().toISOString() }))
  return { info: at('info'), warn: at('warn'), error: at('error') }
}
