/**
 * content/main.js
 * ────────────────────────────────────────────
 * Entry point for all content script modules.
 *
 * This file initializes the content script environment,
 * sets up the message listener for communication with
 * the background service worker, and coordinates all
 * content script modules.
 *
 * Modules loaded via manifest.json "js" array (in order):
 *   1. lib/constants.js
 *   2. lib/utils.js
 *   3. lib/messages.js
 *   4. lib/storage.js
 *   5. lib/logger.js
 *   6. content/selectorEngine.js
 *   7. content/main.js  ← this file (loaded last)
 *
 * Future phases will add more modules between 6 and 7:
 *   - content/recorder.js       (Phase 3)
 *   - content/replayer.js       (Phase 4)
 *   - content/completionDetector.js (Phase 4)
 *   - content/healthChecker.js  (Phase 4)
 *   - content/chainRunner.js    (Phase 5)
 *   - content/extraAction.js    (Phase 5)
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  // ── Verify all required modules loaded ──────────────────────────
  const requiredModules = [
    'Constants',
    'Utils',
    'Messages',
    'Storage',
    'Logger',
    'SelectorEngine',
  ];

  const missing = requiredModules.filter((m) => !root.PC[m]);
  if (missing.length > 0) {
    console.error(
      `[PC Content] Missing required modules: ${missing.join(', ')}. ` +
      'Check manifest.json content_scripts order.'
    );
    return;
  }

  console.log(
    `[PC Content] Initialized on ${window.location.hostname} — ` +
    `Modules loaded: ${requiredModules.join(', ')}`
  );


  // ── Message Router ──────────────────────────────────────────────
  // Listen for messages from Background/Popup/SidePanel.
  // Each module will register its own handlers here as they're added.

  const MSG = PC.MessageTypes;

  // Handler registry — other modules add handlers via PC.Content.registerHandlers()
  const _handlers = {};

  /**
   * Register message handlers from a content script module.
   * Called by recorder.js, chainRunner.js, etc. during their initialization.
   *
   * @param {Object<string, function>} handlers - Map of type → handler
   */
  function registerHandlers(handlers) {
    Object.assign(_handlers, handlers);
    console.log(
      `[PC Content] Registered handlers: ${Object.keys(handlers).join(', ')}`
    );
  }

  // Set up the message listener that routes to registered handlers
  PC.Messages.listen(
    // We use a Proxy so that newly registered handlers are
    // automatically available without re-registering the listener.
    new Proxy(_handlers, {
      get(target, prop) {
        return target[prop];
      },
    })
  );


  // ── Expose Content Script API ───────────────────────────────────
  // Other content modules use this to register handlers and
  // access shared state.

  root.PC.Content = {
    registerHandlers,

    /**
     * Get current page info (used in logging and recipe creation).
     */
    getPageInfo() {
      return {
        hostname: window.location.hostname,
        pathname: window.location.pathname,
        url: window.location.href,
        title: document.title,
      };
    },
  };

  // ── Register Phase 2 handlers (selector engine testing) ─────────
  // These are temporary/utility handlers for testing.
  // They'll remain useful for the dashboard's health check feature.

  registerHandlers({
    /**
     * Health check: test if a fingerprint can still find its element.
     * Used by popup/dashboard to verify recipe health.
     */
    [MSG.CHECK_HEALTH]: (message) => {
      const { fingerprints } = message;

      if (!fingerprints || typeof fingerprints !== 'object') {
        return { error: 'No fingerprints provided' };
      }

      const report = {};
      for (const [name, fp] of Object.entries(fingerprints)) {
        report[name] = PC.SelectorEngine.checkHealth(fp);
      }

      return { success: true, report };
    },
  });

})();