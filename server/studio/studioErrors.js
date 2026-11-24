/**
 * Shared Studio error type — own module to keep service/store/routes cycle-free.
 */
export class StudioError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
