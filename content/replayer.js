/**
 * content/replayer.js
 * ────────────────────────────────────────────
 * Handles the two core replay actions:
 *   1. TEXT INJECTION — Insert text into the recorded input element
 *   2. CLICK SEND — Click the recorded send button
 *
 * Uses PC.SelectorEngine to re-find elements from stored fingerprints.
 * Does NOT manage the chain loop (that's chainRunner.js in Phase 5).
 * This module provides the atomic building blocks for each step.
 *
 * Dependencies:
 *   - PC.SelectorEngine (content/selectorEngine.js)
 *   - PC.Constants (lib/constants.js)
 *   - PC.Utils (lib/utils.js)
 *   - PC.Logger (lib/logger.js)
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};


  root.PC.Replayer = {

    /**
     * Inject text into the recorded target input element.
     * Handles textarea, input, and contenteditable elements.
     *
     * @param {object} fingerprint - The targetInput fingerprint from the recipe
     * @param {string} text - The prompt text to inject
     * @param {object} [opts]
     * @param {number} [opts.timeout] - Max wait for element (ms)
     * @returns {Promise<object>} { success, confidence, method, inputType }
     */
    async injectText(fingerprint, text, opts = {}) {
      const timeout = opts.timeout || 10000;

      // Find the input element
      const match = await PC.SelectorEngine.findWithWait(fingerprint, timeout);

      if (!match) {
        return {
          success: false,
          error: 'Target input element not found',
          confidence: 0,
        };
      }

      const element = match.element;
      const inputType = fingerprint._inputType || this._detectInputType(element);

      console.log(
        `[Replayer] Injecting text — type: ${inputType}, ` +
        `confidence: ${match.confidence.toFixed(2)}, method: ${match.method}`
      );

      try {
        // Focus the element first
        element.focus();

        // Small delay for focus to register
        await PC.Utils.sleep(100);

        // Inject based on element type
        switch (inputType) {
          case 'textarea':
          case 'input':
            this._injectIntoNativeInput(element, text);
            break;

          case 'contenteditable':
            this._injectIntoContentEditable(element, text);
            break;

          default:
            // Try to auto-detect
            if (element.getAttribute('contenteditable') === 'true') {
              this._injectIntoContentEditable(element, text);
            } else if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
              this._injectIntoNativeInput(element, text);
            } else {
              // Last resort: try native input approach
              this._injectIntoNativeInput(element, text);
            }
        }

        return {
          success: true,
          confidence: match.confidence,
          method: match.method,
          inputType,
        };

      } catch (err) {
        return {
          success: false,
          error: err.message,
          confidence: match.confidence,
          method: match.method,
          inputType,
        };
      }
    },

    /**
     * Click the recorded send button.
     * Falls back to pressing Enter on the input if button not found.
     *
     * @param {object} sendFingerprint - The sendTrigger fingerprint
     * @param {object} [inputFingerprint] - The targetInput fingerprint (for Enter fallback)
     * @param {object} [opts]
     * @param {number} [opts.timeout] - Max wait for element (ms)
     * @returns {Promise<object>} { success, confidence, method, usedFallback }
     */
    async clickSend(sendFingerprint, inputFingerprint, opts = {}) {
      const timeout = opts.timeout || 5000;

      // Try to find the send button
      const match = await PC.SelectorEngine.findWithWait(sendFingerprint, timeout);

      if (match && match.confidence >= PC.Constants.CONFIDENCE.MINIMUM) {
        const button = match.element;

        // Check if button is disabled
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
          console.warn('[Replayer] Send button found but disabled — waiting...');

          // Wait up to 3 seconds for it to enable
          const enabled = await this._waitForEnabled(button, 3000);
          if (!enabled) {
            console.warn('[Replayer] Send button still disabled — trying Enter fallback');
            return this._enterKeyFallback(inputFingerprint);
          }
        }

        console.log(
          `[Replayer] Clicking send — confidence: ${match.confidence.toFixed(2)}, ` +
          `method: ${match.method}`
        );

        button.click();

        return {
          success: true,
          confidence: match.confidence,
          method: match.method,
          usedFallback: false,
        };
      }

      // Send button not found — try Enter key fallback
      console.warn('[Replayer] Send button not found — trying Enter key fallback');
      return this._enterKeyFallback(inputFingerprint);
    },


    // ══════════════════════════════════════════════════════════════
    //  INJECTION METHODS
    // ══════════════════════════════════════════════════════════════

    /**
     * Inject text into a <textarea> or <input> element.
     * Uses the native setter trick to bypass React/Vue state.
     */
    _injectIntoNativeInput(element, text) {
      // Determine the correct prototype for the native setter
      const proto = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

      if (descriptor && descriptor.set) {
        // Use native setter — this bypasses React's synthetic state
        descriptor.set.call(element, text);
      } else {
        // Fallback: direct assignment (less reliable with frameworks)
        element.value = text;
      }

      // Dispatch events that frameworks listen for
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

      // Trigger potential auto-resize on textareas
      if (element.tagName === 'TEXTAREA') {
        element.style.height = 'auto';
        element.style.height = element.scrollHeight + 'px';
      }

      console.log(`[Replayer] Injected ${text.length} chars into ${element.tagName.toLowerCase()}`);
    },

    /**
     * Inject text into a contenteditable element.
     * Uses execCommand for compatibility with ProseMirror, Quill, etc.
     */
    _injectIntoContentEditable(element, text) {
      element.focus();

      // Select all existing content (so we replace it, not append)
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);

      // Use execCommand — it works with undo history and
      // triggers the right events for ProseMirror/Quill/Draft.js
      const inserted = document.execCommand('insertText', false, text);

      if (!inserted) {
        // Fallback: manually set textContent and dispatch events
        console.warn('[Replayer] execCommand failed — using textContent fallback');
        element.textContent = text;

        // Move cursor to end
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Dispatch input event for framework state sync
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      }));

      console.log(`[Replayer] Injected ${text.length} chars into contenteditable`);
    },


    // ══════════════════════════════════════════════════════════════
    //  FALLBACKS & HELPERS
    // ══════════════════════════════════════════════════════════════

    /**
     * Fallback: simulate pressing Enter on the input element to send.
     */
    async _enterKeyFallback(inputFingerprint) {
      if (!inputFingerprint) {
        return {
          success: false,
          error: 'No input fingerprint for Enter fallback',
          usedFallback: true,
        };
      }

      const inputMatch = PC.SelectorEngine.find(inputFingerprint);
      if (!inputMatch) {
        return {
          success: false,
          error: 'Input element not found for Enter fallback',
          usedFallback: true,
        };
      }

      const el = inputMatch.element;
      el.focus();

      // Simulate Enter key press (not Shift+Enter which is newline)
      const keydownEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(keydownEvent);

      const keypressEvent = new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(keypressEvent);

      const keyupEvent = new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(keyupEvent);

      console.log('[Replayer] Sent via Enter key fallback');

      return {
        success: true,
        confidence: inputMatch.confidence,
        method: 'enterKeyFallback',
        usedFallback: true,
      };
    },

    /**
     * Wait for a button element to become enabled.
     */
    _waitForEnabled(button, timeout = 3000) {
      return new Promise((resolve) => {
        const start = Date.now();

        const check = () => {
          if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') {
            resolve(true);
            return;
          }
          if (Date.now() - start > timeout) {
            resolve(false);
            return;
          }
          setTimeout(check, 200);
        };

        check();
      });
    },

    /**
     * Detect the input type of an element.
     */
    _detectInputType(element) {
      if (element.getAttribute('contenteditable') === 'true') return 'contenteditable';
      if (element.tagName === 'TEXTAREA') return 'textarea';
      if (element.tagName === 'INPUT') return 'input';
      if (element.getAttribute('role') === 'textbox') return 'contenteditable';
      return 'unknown';
    },
  };

  console.log('[PC Replayer] ✅ Module loaded');

})();