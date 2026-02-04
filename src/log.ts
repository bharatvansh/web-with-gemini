type LogLevel = "debug" | "info" | "warn" | "error";

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(level: LogLevel) {
  const threshold = priority[level];

  function write(l: LogLevel, message: string, extra?: unknown) {
    if (priority[l] < threshold) return;
    const base = `[${new Date().toISOString()}] ${l.toUpperCase()}: ${message}`;
    if (extra === undefined) {
      process.stderr.write(base + "\n");
      return;
    }
    let serialized = "";
    try {
      serialized = JSON.stringify(extra);
    } catch {
      serialized = String(extra);
    }
    process.stderr.write(base + " " + serialized + "\n");
  }

  return {
    debug: (m: string, e?: unknown) => write("debug", m, e),
    info: (m: string, e?: unknown) => write("info", m, e),
    warn: (m: string, e?: unknown) => write("warn", m, e),
    error: (m: string, e?: unknown) => write("error", m, e)
  };
}
