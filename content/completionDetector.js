/**
 * content/completionDetector.js
 * ────────────────────────────────────────────
 * Detects when the AI has finished generating its response.
 *
 * Primary strategy: Watch for the recorded "stop button" to
 *   APPEAR (AI started) then DISAPPEAR (AI finished).
 *
 * Fallback strategy: DOM Mutation Stabilization —
 *   watch for DOM to stop changing for N seconds.
 *
 * Used by chainRunner.js between prompt steps.
 *
 * Dependencies:
 *   - PC.SelectorEngine (content/selectorEngine.js)
 *   - PC.Constants (lib/constants.js)
 *   - PC.Utils (lib/utils.js)
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const CONF = PC.Constants.CONFIDENCE;
  const DEFAULTS = PC.Constants.DEFAULT_SETTINGS;


  root.PC.CompletionDetector = {

    /**
     * Wait for the AI response to complete.
     *
     * @param {object} completionFingerprint - Fingerprint of the stop/cancel button
     * @param {object} [opts]
     * @param {number} [opts.maxWaitTime] - Max time to wait (ms), default 5 min
     * @param {number} [opts.pollInterval] - How often to check (ms), default 500
     * @param {number} [opts.domQuietPeriod] - Quiet period for DOM fallback (ms)
     * @param {number} [opts.domMinMutations] - Min mutations before quiet counts
     * @param {AbortSignal} [opts.signal] - For cancellation
     * @returns {Promise<object>} { completed, method, duration, timedOut }
     */
    async waitForCompletion(completionFingerprint, opts = {}) {
      const maxWaitTime    = opts.maxWaitTime    || DEFAULTS.maxWaitTime;
      const pollInterval   = opts.pollInterval   || DEFAULTS.pollInterval;
      const domQuietPeriod = opts.domQuietPeriod  || DEFAULTS.domQuietPeriod;
      const domMinMutations = opts.domMinMutations || DEFAULTS.domMinMutations;
      const signal         = opts.signal;

      const startTime = Date.now();

      // ── Phase 1: Wait for stop button to APPEAR (AI started) ────
      console.log('[CompletionDetector] Phase 1: Waiting for stop button to appear...');

      const appeared = await this._waitForElementState(
        completionFingerprint,
        'appear',
        {
          timeout: 30000,   // 30 seconds to detect AI started
          pollInterval,
          signal,
        }
      );

      if (signal?.aborted) {
        return { completed: false, method: 'aborted', duration: Date.now() - startTime };
      }

      if (appeared) {
        console.log('[CompletionDetector] ✅ Phase 1 complete — stop button appeared (AI is responding)');

        // ── Phase 2: Wait for stop button to DISAPPEAR (AI finished) ──
        console.log('[CompletionDetector] Phase 2: Waiting for stop button to disappear...');

        const disappeared = await this._waitForElementState(
          completionFingerprint,
          'disappear',
          {
            timeout: maxWaitTime,
            pollInterval,
            signal,
          }
        );

        if (signal?.aborted) {
          return { completed: false, method: 'aborted', duration: Date.now() - startTime };
        }

        if (disappeared) {
          // Buffer time for DOM to settle
          await PC.Utils.sleep(800);

          const duration = Date.now() - startTime;
          console.log(`[CompletionDetector] ✅ Phase 2 complete — response done (${PC.Utils.formatDuration(duration)})`);

          return {
            completed: true,
            method: 'stopButton',
            duration,
            timedOut: false,
          };
        }

        // Phase 2 timed out — stop button never disappeared
        console.warn('[CompletionDetector] ⚠️ Phase 2 timed out — stop button never disappeared');
        return {
          completed: false,
          method: 'stopButton',
          duration: Date.now() - startTime,
          timedOut: true,
        };
      }

      // ── Fallback: Stop button never appeared ────────────────────
      // The AI might have started and finished very quickly,
      // or the stop button fingerprint is broken.
      // Use DOM mutation stabilization as fallback.

      console.warn(
        '[CompletionDetector] Stop button never appeared — ' +
        'falling back to DOM mutation stabilization'
      );

      const domResult = await this._domMutationFallback({
        quietPeriod: domQuietPeriod,
        minMutations: domMinMutations,
        timeout: maxWaitTime - (Date.now() - startTime), // remaining time
        signal,
      });

      return {
        ...domResult,
        duration: Date.now() - startTime,
      };
    },


    // ══════════════════════════════════════════════════════════════
    //  STRATEGY 1: STOP BUTTON STATE WATCHER
    // ══════════════════════════════════════════════════════════════

    /**
     * Poll for a fingerprinted element to appear or disappear.
     *
     * @param {object} fingerprint
     * @param {'appear'|'disappear'} condition
     * @param {object} opts
     * @returns {Promise<boolean>} true if condition met, false if timed out
     */
    _waitForElementState(fingerprint, condition, opts) {
      return new Promise((resolve) => {
        const { timeout, pollInterval, signal } = opts;
        const startTime = Date.now();
        let timer = null;

        const cleanup = () => {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        };

        // Handle abort signal
        if (signal) {
          signal.addEventListener('abort', () => {
            cleanup();
            resolve(false);
          }, { once: true });
        }

        const check = () => {
          // Timeout check
          if (Date.now() - startTime > timeout) {
            cleanup();
            resolve(false);
            return;
          }

          // Abort check
          if (signal?.aborted) {
            cleanup();
            resolve(false);
            return;
          }

          const match = PC.SelectorEngine.find(fingerprint);
          const isPresent = match !== null && match.confidence >= CONF.MINIMUM;

          if (condition === 'appear' && isPresent) {
            cleanup();
            resolve(true);
            return;
          }

          if (condition === 'disappear' && !isPresent) {
            cleanup();
            resolve(true);
            return;
          }
        };

        // First check immediately
        check();

        // Then poll at interval
        timer = setInterval(check, pollInterval);
      });
    },


    // ══════════════════════════════════════════════════════════════
    //  STRATEGY 2: DOM MUTATION STABILIZATION (FALLBACK)
    // ══════════════════════════════════════════════════════════════

    /**
     * Watch for DOM mutations to stabilize (stop changing).
     * If no mutations for quietPeriod ms after seeing minMutations,
     * we assume the AI response is complete.
     *
     * @param {object} opts
     * @returns {Promise<object>} { completed, method, timedOut }
     */
    _domMutationFallback(opts) {
      return new Promise((resolve) => {
        const { quietPeriod, minMutations, timeout, signal } = opts;

        let mutationCount = 0;
        let quietTimer = null;
        let observer = null;
        let timeoutTimer = null;
        let resolved = false;

        const finish = (result) => {
          if (resolved) return;
          resolved = true;
          if (observer) observer.disconnect();
          if (quietTimer) clearTimeout(quietTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(result);
        };

        // Abort support
        if (signal) {
          signal.addEventListener('abort', () => {
            finish({ completed: false, method: 'domMutation', timedOut: false });
          }, { once: true });
        }

        // Find best container to observe
        const container = this._findChatContainer();

        observer = new MutationObserver((mutations) => {
          mutationCount += mutations.length;

          // Reset quiet timer on every mutation
          if (quietTimer) clearTimeout(quietTimer);

          // Only start quiet timer after we've seen enough mutations
          // (prevents false completion before AI even starts)
          if (mutationCount >= minMutations) {
            quietTimer = setTimeout(() => {
              console.log(
                `[CompletionDetector] DOM stable for ${quietPeriod}ms ` +
                `after ${mutationCount} mutations — response complete`
              );
              finish({ completed: true, method: 'domMutation', timedOut: false });
            }, quietPeriod);
          }
        });

        observer.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        // Timeout
        if (timeout > 0) {
          timeoutTimer = setTimeout(() => {
            console.warn(
              `[CompletionDetector] DOM mutation fallback timed out ` +
              `after ${mutationCount} mutations`
            );
            finish({ completed: false, method: 'domMutation', timedOut: true });
          }, timeout);
        }
      });
    },

    /**
     * Find the best DOM container to observe for chat mutations.
     * Tries common containers, falls back to document.body.
     */
    _findChatContainer() {
      const candidates = [
        'main',
        '[role="main"]',
        '[role="presentation"]',
        '.conversation-container',
        '.chat-messages',
        '#chatMessages',
        '[data-testid="conversation"]',
        '.flex.flex-col',       // Common in ChatGPT-style layouts
      ];

      for (const selector of candidates) {
        try {
          const el = document.querySelector(selector);
          if (el) {
            console.log(`[CompletionDetector] Observing container: ${selector}`);
            return el;
          }
        } catch { /* skip invalid selectors */ }
      }

      console.log('[CompletionDetector] No specific container found — observing document.body');
      return document.body;
    },
  };

  console.log('[PC CompletionDetector] ✅ Module loaded');

})();