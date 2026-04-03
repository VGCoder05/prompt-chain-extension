/**
 * lib/constants.js
 * ────────────────────────────────────────────
 * Global constants used across the entire extension.
 * Attaches to the PC (PromptChain) namespace.
 *
 * Loading:
 *   - Content scripts: via manifest "js" array
 *   - Background:      via importScripts()
 *   - Popup/Dashboard: via <script> tag
 */
(() => {
  // Establish the global namespace (works in window, service worker, and content script)
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  root.PC.Constants = Object.freeze({

    // ── Storage Keys ──────────────────────────────────────────────
    STORAGE_KEYS: {
      RECIPES: 'pc_recipes',
      CHAINS: 'pc_chains',
      LOGS: 'pc_logs',
      SETTINGS: 'pc_settings',
      ACTIVE_CHAIN_STATE: 'pc_active_chain_state',
    },

    // ── Chain-Level States ────────────────────────────────────────
    CHAIN_STATES: {
      IDLE: 'idle',
      RUNNING: 'running',
      PAUSED: 'paused',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    },

    // ── Step-Level States ─────────────────────────────────────────
    STEP_STATES: {
      PENDING: 'pending',
      INJECTING: 'injecting',
      SENT: 'sent',
      WAITING_RESPONSE: 'waiting_response',
      COMPLETED: 'completed',
      FAILED: 'failed',
      SKIPPED: 'skipped',
    },

    // ── Log Actions ───────────────────────────────────────────────
    LOG_ACTIONS: {
      // Recording
      RECORD_START: 'record_start',
      RECORD_STEP: 'record_step',
      RECORD_COMPLETE: 'record_complete',
      RECORD_CANCEL: 'record_cancel',

      // Chain execution
      CHAIN_START: 'chain_start',
      CHAIN_COMPLETE: 'chain_complete',
      CHAIN_FAIL: 'chain_fail',
      CHAIN_CANCEL: 'chain_cancel',
      CHAIN_PAUSE: 'chain_pause',
      CHAIN_RESUME: 'chain_resume',

      // Per-step actions
      INJECT: 'inject',
      SEND: 'send',
      WAIT_START: 'wait_start',
      WAIT_COMPLETE: 'wait_complete',
      EXTRA_ACTION: 'extra_action',

      // Health & errors
      HEALTH_CHECK: 'health_check',
      RETRY: 'retry',
      ERROR: 'error',
      SKIP: 'skip',
    },

    // ── Log Statuses ──────────────────────────────────────────────
    LOG_STATUSES: {
      SUCCESS: 'success',
      FAILED: 'failed',
      RETRYING: 'retrying',
      SKIPPED: 'skipped',
      INFO: 'info',
    },

    // ── Completion Signal Types ───────────────────────────────────
    SIGNAL_TYPES: {
      ELEMENT_DISAPPEARS: 'elementDisappears',   // stop button vanishes
      ELEMENT_APPEARS: 'elementAppears',       // new element shows up
      DOM_STABILIZATION: 'domStabilization',     // fallback: no mutations for N ms
      SITE_SPECIFIC: 'siteSpecific',
      TEXT_CHANGES: 'textChanges',
    },

    // ── Extra Action Types ────────────────────────────────────────
    EXTRA_ACTION_TYPES: {
      CLICK: 'click',
      COPY: 'copy',
      DOWNLOAD: 'download',
      CONTINUE: 'continue',
    },

    // ── Confidence Thresholds ─────────────────────────────────────
    CONFIDENCE: {
      HEALTHY: 0.8,   // > 0.8 = element found reliably
      DEGRADED: 0.5,   // 0.5 - 0.8 = found but risky
      UNRELIABLE: 0.5,   // < 0.5 = can't trust this match
      MINIMUM: 0.6,   // minimum to attempt using the element
    },

    // ── Default Replay Settings ───────────────────────────────────
    DEFAULT_SETTINGS: {
      delayBeforeInject: 1000,   // ms before injecting text
      delayAfterInject: 300,    // ms after inject, before clicking send
      delayAfterSend: 1000,   // ms after send, before watching for response
      delayAfterResponse: 1500,   // ms after response complete, before next prompt
      retryAttempts: 3,      // retries per step before giving up
      continueOnError: true,   // log failure + auto-continue to next prompt
      jitterMs: 200,    // ±random variation on all delays
      maxWaitTime: 300000, // 5 min max wait for AI response
      pollInterval: 500,    // ms between checks during response detection
      domQuietPeriod: 3000,   // ms of no mutations = response complete (fallback)
      domMinMutations: 5,      // minimum mutations before quiet period counts
    },

    // ── Recording Wizard Steps ────────────────────────────────────
    RECORDING_STEPS: {
      TARGET_INPUT: 'targetInput',
      SEND_TRIGGER: 'sendTrigger',
      STREAMING_INDICATOR: 'streamingIndicator',
      COMPLETION_INDICATOR: 'completionIndicator',
      COMPLETION_SIGNAL: 'completionSignal',
      EXTRA_ACTION: 'extraAction',
    },
  });
})();