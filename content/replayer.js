/**
 * content/replayer.js  — V4 (Macro Replay Edition)
 * ────────────────────────────────────────────
 * Executes individual steps from JSON-based workflows/macros.
 *
 * Supported Actions:
 *   1. type — Inject text into input fields
 *   2. click — Click buttons/elements
 *   3. waitForAppear — Wait for element to become visible
 *   4. waitForDisappear — Wait for element to hide/remove
 *
 * Main Entry Point:
 *   - executeStep(step, opts) — Runs a single JSON step
 *
 * Legacy API (still supported):
 *   - injectText(fingerprint, text, opts)
 *   - clickSend(sendFingerprint, inputFingerprint, opts)
 *   - injectAndVerify(fingerprint, text, opts)
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

    // ══════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ══════════════════════════════════════════════════════════════

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

      // Find the input element via SelectorEngine
      const match = await PC.SelectorEngine.findWithWait(fingerprint, timeout);

      if (!match) {
        return {
          success: false,
          error: 'Target input element not found',
          confidence: 0,
        };
      }

      const element = match.element;

      // ── Walk up to contenteditable ancestor if needed ──────────
      const target = this._resolveEditableTarget(element);

      // Detect input type — treat "unknown" as falsy so we re-detect
      const inputType =
        (fingerprint._inputType && fingerprint._inputType !== 'unknown')
          ? fingerprint._inputType
          : this._detectInputType(target);

      console.log(
        `[Replayer] Injecting text — type: ${inputType}, ` +
        `confidence: ${match.confidence.toFixed(2)}, method: ${match.method}`
      );

      try {
        // Focus the element first
        target.focus();
        await PC.Utils.sleep(100); // let focus register

        // Inject based on element type
        switch (inputType) {
          case 'textarea':
          case 'input':
            this._injectIntoNativeInput(target, text);
            break;

          case 'contenteditable':
            this._injectIntoContentEditable(target, text);
            break;

          default:
            // Auto-detect as last resort
            if (
              target.getAttribute('contenteditable') === 'true' ||
              target.closest('[contenteditable="true"]')
            ) {
              const editableTarget =
                target.closest('[contenteditable="true"]') || target;
              this._injectIntoContentEditable(editableTarget, text);
            } else if (
              target.tagName === 'TEXTAREA' ||
              target.tagName === 'INPUT'
            ) {
              this._injectIntoNativeInput(target, text);
            } else {
              console.warn(
                '[Replayer] Unknown input type — falling back to native input approach'
              );
              this._injectIntoNativeInput(target, text);
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

      const match = await PC.SelectorEngine.findWithWait(sendFingerprint, timeout);

      if (match && match.confidence >= PC.Constants.CONFIDENCE.MINIMUM) {
        let button = match.element;

        // ── Walk up from icon children to the actual <button> ────
        const iconTags = ['MAT-ICON', 'SVG', 'svg', 'PATH', 'path', 'I', 'SPAN'];
        if (iconTags.includes(button.tagName)) {
          const parentButton = button.closest('button, [role="button"]');
          if (parentButton) {
            console.log(
              `[Replayer] Walked up from <${button.tagName.toLowerCase()}> to parent button`
            );
            button = parentButton;
          }
        }

        // ── Disabled-button wait ────────────────────────────────
        if (
          button.disabled ||
          button.getAttribute('aria-disabled') === 'true'
        ) {
          console.warn('[Replayer] Send button found but disabled — waiting…');
          const enabled = await this._waitForEnabled(button, 3000);
          if (!enabled) {
            console.warn(
              '[Replayer] Send button still disabled — trying Enter fallback'
            );
            return this._enterKeyFallback(inputFingerprint);
          }
        }

        console.log(
          `[Replayer] Clicking send — confidence: ${match.confidence.toFixed(2)}, ` +
          `method: ${match.method}, element: <${button.tagName.toLowerCase()}>`
        );

        // Robust click: native first, dispatchEvent fallback
        try {
          button.click();
        } catch (_) {
          console.warn('[Replayer] Native click threw — using dispatchEvent');
          button.dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
            })
          );
        }

        return {
          success: true,
          confidence: match.confidence,
          method: match.method,
          usedFallback: false,
        };
      }

      // Button not found → Enter key fallback
      console.warn('[Replayer] Send button not found — trying Enter key fallback');
      return this._enterKeyFallback(inputFingerprint);
    },

    /**
 * Wait for an element to appear on the page.
 * Used for completion indicators (buttons that show when AI finishes).
 *
 * @param {object} fingerprint - Element fingerprint to wait for
 * @param {object} [opts]
 * @param {number} [opts.timeout] - Max wait time (ms)
 * @param {function} [opts.onProgress] - Callback(elapsed, status)
 * @returns {Promise<object>} { success, confidence, method, elapsed }
 */
    async waitForAppear(fingerprint, opts = {}) {
      const timeout = opts.timeout || 180000; // 3 min default
      const onProgress = opts.onProgress || (() => { });
      const startTime = Date.now();

      console.log(`[Replayer] ⏳ Waiting for element to APPEAR (timeout: ${timeout}ms)`);

      return new Promise((resolve) => {
        // Progress reporting interval
        const progressInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          onProgress(elapsed, 'waiting');
        }, 1000);

        // Polling function
        const check = async () => {
          const elapsed = Date.now() - startTime;

          // Check if element exists and is visible
          const match = await PC.SelectorEngine.findWithWait(fingerprint, 1000);

          if (match && match.confidence >= PC.Constants.CONFIDENCE.MINIMUM) {
            clearInterval(progressInterval);
            console.log(
              `[Replayer] ✅ Element appeared after ${elapsed}ms ` +
              `(confidence: ${match.confidence.toFixed(2)}, method: ${match.method})`
            );
            resolve({
              success: true,
              confidence: match.confidence,
              method: match.method,
              elapsed,
            });
            return;
          }

          // Timeout check
          if (elapsed > timeout) {
            clearInterval(progressInterval);
            console.warn(`[Replayer] ❌ Element did not appear within ${timeout}ms`);
            resolve({
              success: false,
              error: 'Element did not appear within timeout',
              elapsed,
            });
            return;
          }

          // Continue polling
          setTimeout(check, 500);
        };

        // Start checking
        setTimeout(check, 500);
      });
    },

    /**
     * Wait for an element to disappear from the page.
     * Used for streaming indicators (stop button visible while AI generates).
     *
     * @param {object} fingerprint - Element fingerprint to wait for
     * @param {object} [opts]
     * @param {number} [opts.timeout] - Max wait time (ms)
     * @param {function} [opts.onProgress] - Callback(elapsed, status)
     * @returns {Promise<object>} { success, elapsed }
     */
    async waitForDisappear(fingerprint, opts = {}) {
      const timeout = opts.timeout || 180000;
      const onProgress = opts.onProgress || (() => { });
      const startTime = Date.now();

      console.log(`[Replayer] ⏳ Waiting for element to DISAPPEAR (timeout: ${timeout}ms)`);

      return new Promise((resolve) => {
        const progressInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          onProgress(elapsed, 'generating');
        }, 1000);

        const check = () => {
          const elapsed = Date.now() - startTime;

          // Check if element is gone or hidden
          const match = PC.SelectorEngine.find(fingerprint);

          if (!match || match.confidence < PC.Constants.CONFIDENCE.MINIMUM) {
            clearInterval(progressInterval);
            console.log(`[Replayer] ✅ Element disappeared after ${elapsed}ms`);
            resolve({ success: true, elapsed });
            return;
          }

          // Also check if element is invisible (some sites hide instead of removing)
          const el = match.element;
          const style = window.getComputedStyle(el);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) {
            clearInterval(progressInterval);
            console.log(`[Replayer] ✅ Element became invisible after ${elapsed}ms`);
            resolve({ success: true, elapsed });
            return;
          }

          // Timeout check
          if (elapsed > timeout) {
            clearInterval(progressInterval);
            console.warn(`[Replayer] ⚠️ Element still visible after ${timeout}ms — continuing anyway`);
            resolve({
              success: true, // ✅ Non-blocking timeout
              elapsed,
              warning: 'Timeout reached but continuing',
            });
            return;
          }

          // Continue polling
          setTimeout(check, 500);
        };

        setTimeout(check, 500);
      });
    },

    /**
     * Execute a single step from a macro/workflow.
     * This is the main entry point for step-by-step replay.
     *
     * @param {object} step - JSON step object from workflow
     * @param {object} [opts] - Options (timeout, onProgress, etc.)
     * @returns {Promise<object>} { success, result, error }
     */
    async executeStep(step, opts = {}) {
      console.log(`[Replayer] 🎬 Executing step: ${step.action} — ${step.description || ''}`);

      try {
        switch (step.action) {
          case 'type':
            return await this._executeTypeStep(step, opts);

          case 'click':
            return await this._executeClickStep(step, opts);

          case 'waitForAppear':
            return await this._executeWaitAppearStep(step, opts);

          case 'waitForDisappear':
            return await this._executeWaitDisappearStep(step, opts);

          default:
            return {
              success: false,
              error: `Unknown action type: ${step.action}`,
            };
        }
      } catch (err) {
        console.error(`[Replayer] ❌ Step execution failed:`, err);
        return {
          success: false,
          error: err.message,
        };
      }
    },

    /**
 * Execute a 'type' step with verification.
 */
    async _executeTypeStep(step, opts) {
      const text = step.value || '';
      const fingerprint = step.selector;

      const result = await this.injectAndVerify(fingerprint, text, {
        timeout: opts.timeout || 10000,
        verifyAttempts: 3,
        verifyDelay: 300,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to inject text',
          result,
        };
      }

      console.log(
        `[Replayer] ✅ Type step complete — ` +
        `injected "${PC.Utils.truncate(text, 30)}" ` +
        `(verified: ${result.verified})`
      );

      return {
        success: true,
        result: {
          textLength: text.length,
          verified: result.verified,
          confidence: result.confidence,
          method: result.method,
        },
      };
    },

    /**
     * Execute a 'click' step.
     */
    async _executeClickStep(step, opts) {
      const fingerprint = step.selector;

      // For send buttons, we might have an input fingerprint for fallback
      const inputFingerprint = opts.inputFingerprint || null;

      const result = await this.clickSend(fingerprint, inputFingerprint, {
        timeout: opts.timeout || 5000,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to click element',
          result,
        };
      }

      console.log(
        `[Replayer] ✅ Click step complete — ` +
        `confidence: ${result.confidence?.toFixed(2) || 'N/A'}, ` +
        `method: ${result.method}`
      );

      return {
        success: true,
        result: {
          confidence: result.confidence,
          method: result.method,
          usedFallback: result.usedFallback,
        },
      };
    },

    /**
     * Execute a 'waitForAppear' step.
     */
    async _executeWaitAppearStep(step, opts) {
      const fingerprint = step.selector;
      const timeout = step.timeout || opts.timeout || 180000;

      const result = await this.waitForAppear(fingerprint, {
        timeout,
        onProgress: opts.onProgress,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Element did not appear',
          result,
        };
      }

      console.log(
        `[Replayer] ✅ WaitForAppear step complete — ` +
        `element appeared after ${result.elapsed}ms`
      );

      return {
        success: true,
        result: {
          elapsed: result.elapsed,
          confidence: result.confidence,
          method: result.method,
        },
      };
    },

    /**
     * Execute a 'waitForDisappear' step.
     */
    async _executeWaitDisappearStep(step, opts) {
      const fingerprint = step.selector;
      const timeout = step.timeout || opts.timeout || 180000;

      const result = await this.waitForDisappear(fingerprint, {
        timeout,
        onProgress: opts.onProgress,
      });

      // Note: waitForDisappear is non-blocking on timeout
      console.log(
        `[Replayer] ✅ WaitForDisappear step complete — ` +
        `elapsed: ${result.elapsed}ms` +
        (result.warning ? ` (${result.warning})` : '')
      );

      return {
        success: true,
        result: {
          elapsed: result.elapsed,
          warning: result.warning,
        },
      };
    },

    /**
     * Read the current text in the input element.
     *
     * @param {object} fingerprint - The targetInput fingerprint
     * @returns {Promise<string>} current text in the input
     */
    async getInputText(fingerprint) {
      const match = PC.SelectorEngine.find(fingerprint);
      if (!match) {
        console.warn('[Replayer] getInputText: element not found');
        return '';
      }

      // Walk up to contenteditable if necessary
      const el = this._resolveEditableTarget(match.element);

      // Re-detect type (treats "unknown" as falsy)
      const inputType =
        (fingerprint._inputType && fingerprint._inputType !== 'unknown')
          ? fingerprint._inputType
          : this._detectInputType(el);

      let text;
      if (inputType === 'contenteditable') {
        text = (el.innerText || el.textContent || '').trim();
      } else {
        text = (el.value || '').trim();
      }

      console.log(
        `[Replayer] getInputText — type: ${inputType}, ` +
        `element: <${el.tagName.toLowerCase()}>, ` +
        `text: "${text.substring(0, 50)}${text.length > 50 ? '…' : ''}"`
      );
      return text;
    },

    /**
     * Inject text then verify it persisted; retry if cleared.
     *
     * @param {object} fingerprint - The targetInput fingerprint
     * @param {string} text - Text to inject
     * @param {object} [opts]
     * @param {number} [opts.timeout] - Max wait for element
     * @param {number} [opts.verifyAttempts] - Max re-inject attempts (default 3)
     * @param {number} [opts.verifyDelay] - Delay before verifying (ms, default 300)
     * @returns {Promise<object>} { success, confidence, method, inputType, verified }
     */
    async injectAndVerify(fingerprint, text, opts = {}) {
      const verifyAttempts = opts.verifyAttempts || 3;
      const verifyDelay = opts.verifyDelay || 300;

      for (let attempt = 0; attempt < verifyAttempts; attempt++) {
        const result = await this.injectText(fingerprint, text, opts);
        if (!result.success) return result;

        // Give the framework time to settle
        await PC.Utils.sleep(verifyDelay);

        // Read back what's in the input
        const currentText = await this.getInputText(fingerprint);

        console.log(
          `[Replayer] Verify attempt ${attempt + 1}: ` +
          `expected "${text.substring(0, 30)}…", ` +
          `found   "${currentText.substring(0, 30)}…"`
        );

        if (this._textsMatch(currentText, text)) {
          console.log(`[Replayer] ✅ Text verified on attempt ${attempt + 1}`);
          return { ...result, verified: true, verifyAttempt: attempt };
        }

        console.warn(
          `[Replayer] Text was cleared after injection ` +
          `(attempt ${attempt + 1}/${verifyAttempts}) — re-injecting…`
        );

        // Increasing back-off before retry
        await PC.Utils.sleep(300 * (attempt + 1));
      }

      return {
        success: false,
        error:
          `Text cleared after injection ${verifyAttempts} times — ` +
          `page may be resetting the input`,
        verified: false,
      };
    },

    // ══════════════════════════════════════════════════════════════
    //  INJECTION METHODS (private)
    // ══════════════════════════════════════════════════════════════

    /**
     * Inject into <textarea> or <input> using the native-setter trick
     * to bypass React / Vue / Angular state.
     */
    _injectIntoNativeInput(element, text) {
      const proto =
        element.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;

      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

      if (descriptor && descriptor.set) {
        descriptor.set.call(element, text);
      } else {
        element.value = text;
      }

      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

      // Auto-resize textareas
      if (element.tagName === 'TEXTAREA') {
        element.style.height = 'auto';
        element.style.height = element.scrollHeight + 'px';
      }

      console.log(
        `[Replayer] Injected ${text.length} chars into <${element.tagName.toLowerCase()}>`
      );
    },

    /**
     * Inject into a contenteditable element.
     * Uses execCommand first (works with ProseMirror / Quill / Draft.js undo stack),
     * falls back to innerHTML/textContent.
     */
    _injectIntoContentEditable(element, text) {
      element.focus();

      // Select all existing content so we replace (not append)
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand('insertText', false, text);

      if (!inserted) {
        console.warn('[Replayer] execCommand failed — using innerHTML/textContent fallback');

        // Quill wraps lines in <p>; honour that structure
        if (element.classList.contains('ql-editor')) {
          element.innerHTML = `<p>${text}</p>`;
        } else {
          element.textContent = text;
        }

        // Move cursor to end
        const r = document.createRange();
        r.selectNodeContents(element);
        r.collapse(false);
        selection.removeAllRanges();
        selection.addRange(r);
      }

      // Dispatch the events frameworks actually listen for
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        })
      );
      // Some frameworks only bind the plain Event version
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      console.log(`[Replayer] Injected ${text.length} chars into contenteditable`);
    },

    // ══════════════════════════════════════════════════════════════
    //  FALLBACKS & HELPERS (private)
    // ══════════════════════════════════════════════════════════════

    /**
     * Given any element, walk up to the nearest contenteditable ancestor
     * when the element itself isn't editable (covers Quill <p>, ProseMirror inner nodes, etc.).
     * Returns the element unchanged if no ancestor qualifies.
     */
    _resolveEditableTarget(element) {
      if (
        element.getAttribute &&
        element.getAttribute('contenteditable') === 'true'
      ) {
        return element;
      }

      const ancestor =
        element.closest &&
        element.closest('[contenteditable="true"]');

      if (ancestor) {
        console.log(
          `[Replayer] Walked up to contenteditable ancestor: ` +
          `<${ancestor.tagName.toLowerCase()}> .${(ancestor.className || '').toString().split(' ')[0]}`
        );
        return ancestor;
      }

      return element;
    },

    /**
     * Compare injected text to what we read back.
     * Tolerates whitespace differences and partial Quill formatting.
     */
    _textsMatch(current, expected) {
      if (!current || current.length === 0) return false;
      if (current === expected) return true;

      // One contains the other (Quill may add/remove a trailing newline)
      if (current.includes(expected) || expected.includes(current)) return true;

      // Whitespace-normalised comparison
      const norm = (s) => s.replace(/\s+/g, ' ').trim();
      return norm(current) === norm(expected);
    },

    /**
     * Detect the input type of an element.
     */
    _detectInputType(element) {
      if (element.getAttribute('contenteditable') === 'true') return 'contenteditable';
      if (element.tagName === 'TEXTAREA') return 'textarea';
      if (element.tagName === 'INPUT') return 'input';
      if (element.getAttribute('role') === 'textbox') return 'contenteditable';
      if (element.classList && element.classList.contains('ql-editor')) return 'contenteditable';

      // Walk parents (Quill, ProseMirror, etc.)
      let parent = element.parentElement;
      let depth = 0;
      while (parent && depth < 10) {
        if (parent.getAttribute('contenteditable') === 'true') return 'contenteditable';
        if (parent.classList.contains('ql-editor')) return 'contenteditable';
        if (parent.classList.contains('ProseMirror')) return 'contenteditable';
        parent = parent.parentElement;
        depth++;
      }

      return 'unknown';
    },

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

      // Walk up to editable ancestor so the event targets the right node
      const el = this._resolveEditableTarget(inputMatch.element);
      el.focus();

      const shared = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };

      el.dispatchEvent(new KeyboardEvent('keydown', shared));
      el.dispatchEvent(new KeyboardEvent('keypress', shared));
      el.dispatchEvent(new KeyboardEvent('keyup', shared));

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
          if (
            !button.disabled &&
            button.getAttribute('aria-disabled') !== 'true'
          ) {
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
  };

  // console.log('[PC Replayer] ✅ V3 loaded');
})();