/**
 * lib/messages.js
 * ────────────────────────────────────────────
 * Message type constants and helpers for the
 * 3-way messaging system:
 *   Popup/SidePanel/Dashboard ↔ Background ↔ Content Script
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  // ── Message Type Constants ──────────────────────────────────────
  // Naming convention: SOURCE_ACTION
  // This makes it clear who sends the message and what it does.

  root.PC.MessageTypes = Object.freeze({

    // ── Recording ─────────────────────────────────────────────────
    START_RECORDING:      'START_RECORDING',       // popup → content: begin setup wizard
    CANCEL_RECORDING:     'CANCEL_RECORDING',      // popup → content: abort recording
    RECORDING_STEP:       'RECORDING_STEP',        // content → popup/bg: wizard step completed
    RECORDING_COMPLETE:   'RECORDING_COMPLETE',     // content → popup/bg: recipe fully recorded
    RECORDING_CANCELLED:  'RECORDING_CANCELLED',    // content → popup/bg: recording aborted

    // ── Chain Execution ───────────────────────────────────────────
    RUN_CHAIN:            'RUN_CHAIN',             // popup → bg → content: start chain
    PAUSE_CHAIN:          'PAUSE_CHAIN',           // popup/sidepanel → bg → content
    RESUME_CHAIN:         'RESUME_CHAIN',          // popup/sidepanel → bg → content
    CANCEL_CHAIN:         'CANCEL_CHAIN',          // popup/sidepanel → bg → content
    SKIP_STEP:            'SKIP_STEP',             // sidepanel → bg → content

    // ── Chain Status (content → bg → popup/sidepanel) ─────────────
    CHAIN_STATUS:         'CHAIN_STATUS',          // generic status update
    CHAIN_STARTED:        'CHAIN_STARTED',
    CHAIN_COMPLETED:      'CHAIN_COMPLETED',
    CHAIN_FAILED:         'CHAIN_FAILED',
    CHAIN_PAUSED:         'CHAIN_PAUSED',
    CHAIN_RESUMED:        'CHAIN_RESUMED',
    CHAIN_CANCELLED:      'CHAIN_CANCELLED',
    STEP_STARTED:         'STEP_STARTED',
    STEP_COMPLETED:       'STEP_COMPLETED',
    STEP_FAILED:          'STEP_FAILED',
    STEP_RETRYING:        'STEP_RETRYING',
    STEP_SKIPPED:         'STEP_SKIPPED',
    RESPONSE_TIMEOUT:     'RESPONSE_TIMEOUT',
    USER_INTERFERENCE:    'USER_INTERFERENCE',

    // ── Health Check ──────────────────────────────────────────────
    CHECK_HEALTH:         'CHECK_HEALTH',          // popup/bg → content
    HEALTH_RESULT:        'HEALTH_RESULT',         // content → popup/bg
    RERECORD_NEEDED:      'RERECORD_NEEDED',       // content → popup

    // ── State Queries ─────────────────────────────────────────────
    GET_CHAIN_STATUS:     'GET_CHAIN_STATUS',      // sidepanel → content (on open)
    GET_RECORDING_STATUS: 'GET_RECORDING_STATUS',  // popup → content

    // ── Navigation ────────────────────────────────────────────────
    OPEN_DASHBOARD:       'OPEN_DASHBOARD',        // popup → bg: open dashboard tab
    OPEN_SIDEPANEL:       'OPEN_SIDEPANEL',        // popup → bg: open side panel
  });


  // ── Message Helpers ─────────────────────────────────────────────

  root.PC.Messages = {

    /**
     * Send a message via chrome.runtime.sendMessage.
     * Used from: content script, popup, sidepanel, dashboard.
     * Catches errors silently (receiver may not exist).
     *
     * @param {string} type - One of PC.MessageTypes
     * @param {object} [data] - Additional payload
     * @returns {Promise<any>} response from receiver
     */
    async send(type, data = {}) {
      try {
        return await chrome.runtime.sendMessage({ type, ...data });
      } catch (err) {
        // This is expected when:
        //  - No listener registered (background not running yet)
        //  - Popup/sidepanel is closed
        // Fail silently — the sender doesn't need to know.
        if (!err.message?.includes('Receiving end does not exist')) {
          console.warn(`[PC.Messages] Send failed for ${type}:`, err.message);
        }
        return null;
      }
    },

    /**
     * Send a message to a specific tab's content script.
     * Used from: background service worker.
     *
     * @param {number} tabId - Target tab
     * @param {string} type - One of PC.MessageTypes
     * @param {object} [data] - Additional payload
     * @returns {Promise<any>} response from content script
     */
    async sendToTab(tabId, type, data = {}) {
      try {
        return await chrome.tabs.sendMessage(tabId, { type, ...data });
      } catch (err) {
        console.warn(`[PC.Messages] SendToTab(${tabId}) failed for ${type}:`, err.message);
        return null;
      }
    },

    /**
     * Register a message listener with type-based routing.
     * Returns a cleanup function to remove the listener.
     *
     * @param {Object<string, function>} handlers - Map of type → handler function
     * @returns {function} cleanup function
     *
     * Usage:
     *   const cleanup = PC.Messages.listen({
     *     'RUN_CHAIN': (msg, sender) => { ... },
     *     'PAUSE_CHAIN': (msg, sender) => { ... },
     *   });
     */
    listen(handlers) {
      const listener = (message, sender, sendResponse) => {
        const handler = handlers[message.type];
        if (!handler) return; // Not our message type

        const result = handler(message, sender, sendResponse);

        // If handler returns a Promise, keep the channel open
        if (result instanceof Promise) {
          result
            .then((res) => sendResponse(res))
            .catch((err) => sendResponse({ error: err.message }));
          return true; // Keep sendResponse channel open for async
        }

        // If handler returned a value synchronously, send it
        if (result !== undefined) {
          sendResponse(result);
        }
      };

      chrome.runtime.onMessage.addListener(listener);

      // Return cleanup function
      return () => chrome.runtime.onMessage.removeListener(listener);
    },
  };
})();