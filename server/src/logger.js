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
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(component) {
  return {
    debug: (message, fields) => emit('debug', component, message, fields),
    info: (message, fields) => emit('info', component, message, fields),
    warn: (message, fields) => emit('warn', component, message, fields),
    error: (message, fields) => emit('error', component, message, fields),
  };
}
