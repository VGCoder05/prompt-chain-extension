/**
 * content/extraAction.js
 * ────────────────────────────────────────────
 * Executes optional post-response actions:
 *   - click: Click the recorded element
 *   - copy:  Read text from the element and copy to clipboard
 *   - download: Click an element that triggers a download
 *
 * Dependencies:
 *   - PC.SelectorEngine
 *   - PC.Constants
 *   - PC.Logger
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const ACTION_TYPES = PC.Constants.EXTRA_ACTION_TYPES;

  root.PC.ExtraAction = {

    /**
     * Execute the extra action defined in the recipe.
     *
     * @param {object} fingerprint - The extraAction fingerprint (has _actionType)
     * @param {object} [opts]
     * @param {number} [opts.timeout] - Max wait for element (ms)
     * @returns {Promise<object>} { success, actionType, error? }
     */
    async execute(fingerprint, opts = {}) {
      if (!fingerprint) {
        return { success: false, error: 'No extra action configured' };
      }

      const timeout = opts.timeout || 5000;
      const actionType = fingerprint._actionType || ACTION_TYPES.CLICK;

      // Find the element
      const match = await PC.SelectorEngine.findWithWait(fingerprint, timeout);

      if (!match) {
        return {
          success: false,
          actionType,
          error: 'Extra action element not found',
        };
      }

      console.log(
        `[ExtraAction] Executing "${actionType}" — ` +
        `confidence: ${match.confidence.toFixed(2)}, method: ${match.method}`
      );

      try {
        switch (actionType) {

          case ACTION_TYPES.CLICK:
            match.element.click();
            return { success: true, actionType };

          case ACTION_TYPES.COPY:
            return await this._copyAction(match.element);

          case ACTION_TYPES.DOWNLOAD:
            // Download is just a click on a download button/link
            match.element.click();
            return { success: true, actionType };

          default:
            // Unknown type — try a click
            match.element.click();
            return { success: true, actionType: 'click (fallback)' };
        }

      } catch (err) {
        return {
          success: false,
          actionType,
          error: err.message,
        };
      }
    },

    /**
     * Copy text content from an element to the clipboard.
     */
    async _copyAction(element) {
      // Get the text content to copy
      const text = element.innerText || element.textContent || '';

      if (!text.trim()) {
        // The element itself might be a button — look for nearby
        // response content (sibling or parent's last response)
        console.warn('[ExtraAction] Copy target has no text — clicking instead');
        element.click();
        return { success: true, actionType: 'click (copy fallback)' };
      }

      try {
        await navigator.clipboard.writeText(text.trim());
        console.log(`[ExtraAction] Copied ${text.trim().length} chars to clipboard`);
        return { success: true, actionType: 'copy', charsCopied: text.trim().length };
      } catch (err) {
        // Clipboard API might fail without user gesture
        console.warn('[ExtraAction] Clipboard API failed — clicking element instead');
        element.click();
        return { success: true, actionType: 'click (clipboard fallback)', note: err.message };
      }
    },
  };

  console.log('[PC ExtraAction] ✅ Module loaded');

})();