/** Structured error taxonomy (Phase 17). */

export const ERROR_CODES = {
  INVALID_URL: 'INVALID_URL',
  SECURITY_BLOCKED: 'SECURITY_BLOCKED',
  DNS_FAILURE: 'DNS_FAILURE',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  TLS_ERROR: 'TLS_ERROR',
  BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  TOO_MANY_REDIRECTS: 'TOO_MANY_REDIRECTS',
  REDIRECT_LOOP: 'REDIRECT_LOOP',
  WAYBACK_UNAVAILABLE: 'WAYBACK_UNAVAILABLE',
  NO_ARCHIVED_SNAPSHOTS: 'NO_ARCHIVED_SNAPSHOTS',
  NO_SUCCESSOR_FOUND: 'NO_SUCCESSOR_FOUND',
  SUCCESSOR_UNVERIFIED: 'SUCCESSOR_UNVERIFIED',
  MULTIPLE_POSSIBLE_SUCCESSORS: 'MULTIPLE_POSSIBLE_SUCCESSORS',
  RATE_LIMITED: 'RATE_LIMITED',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  DISCOVERY_LIMIT_REACHED: 'DISCOVERY_LIMIT_REACHED',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
};

export class LrError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES | string} code
   * @param {string} message
   * @param {{ status?: number, details?: unknown, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'LrError';
    this.code = code;
    this.status = options.status ?? 500;
    this.details = options.details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}
