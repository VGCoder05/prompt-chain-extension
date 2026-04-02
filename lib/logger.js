/**
 * lib/logger.js
 * ────────────────────────────────────────────
 * Structured activity logger.
 * Every extension action is logged with:
 *   id, timestamp, sessionId, recipeId, chainId,
 *   promptIndex, action, status, details
 *
 * Logs are persisted via PC.Storage.logs.add()
 * and can be viewed in Dashboard or exported as JSON.
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const ACTIONS = root.PC.Constants.LOG_ACTIONS;
  const STATUSES = root.PC.Constants.LOG_STATUSES;

  // The current session context.
  // Set when a chain starts, cleared when it ends.
  let _context = {
    sessionId: null,
    recipeId:  null,
    chainId:   null,
  };

  root.PC.Logger = {

    // ── Context Management ────────────────────────────────────────

    /**
     * Set the logging context for a chain execution session.
     * All subsequent log() calls include this context.
     */
    setContext({ sessionId, recipeId, chainId }) {
      _context = { sessionId, recipeId, chainId };
    },

    /**
     * Clear the logging context (after chain completes/fails/cancels).
     */
    clearContext() {
      _context = { sessionId: null, recipeId: null, chainId: null };
    },

    /**
     * Get the current session ID (creates one if not set).
     */
    getSessionId() {
      if (!_context.sessionId) {
        _context.sessionId = PC.Utils.uuid();
      }
      return _context.sessionId;
    },

    // ── Core Log Method ───────────────────────────────────────────

    /**
     * Write a structured log entry.
     *
     * @param {string} action - One of PC.Constants.LOG_ACTIONS
     * @param {string} status - One of PC.Constants.LOG_STATUSES
     * @param {object} [details] - Extra info (promptIndex, duration, error, etc.)
     * @returns {Promise<object>} the saved log entry
     */
    async log(action, status, details = {}) {
      const entry = {
        timestamp:    PC.Utils.timestamp(),
        sessionId:    _context.sessionId,
        recipeId:     _context.recipeId,
        chainId:      _context.chainId,
        action,
        status,
        details,
      };

      // Also log to console for development visibility
      const icon = status === STATUSES.SUCCESS  ? '✅' :
                   status === STATUSES.FAILED   ? '❌' :
                   status === STATUSES.RETRYING  ? '🔄' :
                   status === STATUSES.SKIPPED   ? '⏭️' : 'ℹ️';

      console.log(
        `[PC Logger] ${icon} ${action} (${status})`,
        details.promptIndex !== undefined ? `[prompt ${details.promptIndex}]` : '',
        details.error || ''
      );

      // Persist to storage
      try {
        return await PC.Storage.logs.add(entry);
      } catch (err) {
        // Storage write failed — don't crash the chain for a logging issue
        console.error('[PC Logger] Failed to persist log entry:', err);
        return entry;
      }
    },

    // ── Convenience Methods ───────────────────────────────────────
    // These make calling code more readable than using raw log() calls.

    // Recording
    recordStart(details) {
      return this.log(ACTIONS.RECORD_START, STATUSES.INFO, details);
    },
    recordStep(details) {
      return this.log(ACTIONS.RECORD_STEP, STATUSES.SUCCESS, details);
    },
    recordComplete(details) {
      return this.log(ACTIONS.RECORD_COMPLETE, STATUSES.SUCCESS, details);
    },
    recordCancel(details) {
      return this.log(ACTIONS.RECORD_CANCEL, STATUSES.INFO, details);
    },

    // Chain lifecycle
    chainStart(details) {
      return this.log(ACTIONS.CHAIN_START, STATUSES.INFO, details);
    },
    chainComplete(details) {
      return this.log(ACTIONS.CHAIN_COMPLETE, STATUSES.SUCCESS, details);
    },
    chainFail(details) {
      return this.log(ACTIONS.CHAIN_FAIL, STATUSES.FAILED, details);
    },
    chainCancel(details) {
      return this.log(ACTIONS.CHAIN_CANCEL, STATUSES.INFO, details);
    },
    chainPause(details) {
      return this.log(ACTIONS.CHAIN_PAUSE, STATUSES.INFO, details);
    },
    chainResume(details) {
      return this.log(ACTIONS.CHAIN_RESUME, STATUSES.INFO, details);
    },

    // Per-step actions
    inject(status, details) {
      return this.log(ACTIONS.INJECT, status, details);
    },
    send(status, details) {
      return this.log(ACTIONS.SEND, status, details);
    },
    waitStart(details) {
      return this.log(ACTIONS.WAIT_START, STATUSES.INFO, details);
    },
    waitComplete(details) {
      return this.log(ACTIONS.WAIT_COMPLETE, STATUSES.SUCCESS, details);
    },
    extraAction(status, details) {
      return this.log(ACTIONS.EXTRA_ACTION, status, details);
    },

    // Errors and retries
    error(details) {
      return this.log(ACTIONS.ERROR, STATUSES.FAILED, details);
    },
    retry(details) {
      return this.log(ACTIONS.RETRY, STATUSES.RETRYING, details);
    },
    skip(details) {
      return this.log(ACTIONS.SKIP, STATUSES.SKIPPED, details);
    },
    healthCheck(status, details) {
      return this.log(ACTIONS.HEALTH_CHECK, status, details);
    },
  };
})();