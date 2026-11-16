/** Structured JSON-lines logger (Phase 2 #14). Never logs secrets. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LR_LOG_LEVEL ?? 'info'] ?? LEVELS.info;

function emit(level, component, message, fields) {
  if (LEVELS[level] < threshold) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(fields ? { fields } : {}),
  };
  const line = JSON.stringify(entry);
  // stdout is a binary protocol channel when this process is a Native Host.
  // Send every log level to stderr so framing can never be corrupted.
  console.error(line);
}

export function createLogger(component) {
  return {
    debug: (message, fields) => emit('debug', component, message, fields),
    info: (message, fields) => emit('info', component, message, fields),
    warn: (message, fields) => emit('warn', component, message, fields),
    error: (message, fields) => emit('error', component, message, fields),
  };
}
