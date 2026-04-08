type LogLevel = "debug" | "info" | "warn" | "error";

const order: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const configured = ((process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel);
const currentLevel = order[configured] ? configured : "info";
const isSystemd = process.env.INVOCATION_ID !== undefined;

/** Emits a log record in either plain-text or JSON form depending on the runtime environment. */
function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (order[level] < order[currentLevel]) {
    return;
  }

  const payload = {
    level,
    message,
    ...meta
  };

  if (isSystemd) {
    console.log(JSON.stringify(payload));
    return;
  }

  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  console.log(`${level}: ${message}${suffix}`);
}

/** Lightweight structured logger used across the daemon and CLI entry points. */
export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    emit("debug", message, meta);
  },
  info(message: string, meta?: Record<string, unknown>): void {
    emit("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    emit("warn", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>): void {
    emit("error", message, meta);
  }
};
