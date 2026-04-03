/**
 * content/completionDetector.js
 * ────────────────────────────────────────────
 * Detects when the AI has finished generating its response.
 *
 * TWO DETECTION STRATEGIES:
 *
 * 1. ELEMENT_APPEARS (New, Recommended)
 *    Wait for a "completion indicator" to appear:
 *    - Send button re-enabled
 *    - Copy button appeared
 *    - Feedback buttons (thumbs up/down) appeared
 *    - Regenerate button appeared
 *
 * 2. ELEMENT_DISAPPEARS (Legacy)
 *    Watch for the "stop button" to:
 *    - APPEAR (AI started generating)
 *    - DISAPPEAR (AI finished)
 *
 * FALLBACK: DOM Mutation Stabilization
 *    If primary strategy fails, watch for DOM to stop changing.
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
  const SIGNAL_TYPES = PC.Constants.SIGNAL_TYPES;


  root.PC.CompletionDetector = {

    /**
     * Wait for the AI response to complete.
     *
     * @param {object} completionFingerprint - Fingerprint of completion/stop element
     * @param {object} [opts]
     * @param {object} [opts.streamingIndicator] - Optional streaming indicator (stop button)
     * @param {number} [opts.maxWaitTime] - Max time to wait (ms), default 5 min
     * @param {number} [opts.pollInterval] - How often to check (ms), default 500
     * @param {number} [opts.domQuietPeriod] - Quiet period for DOM fallback (ms)
     * @param {number} [opts.domMinMutations] - Min mutations before quiet counts
     * @param {AbortSignal} [opts.signal] - For cancellation
     * @returns {Promise<object>} { completed, method, duration, timedOut }
     */
    async waitForCompletion(completionFingerprint, opts = {}) {
      const maxWaitTime     = opts.maxWaitTime     || DEFAULTS.maxWaitTime;
      const pollInterval    = opts.pollInterval    || DEFAULTS.pollInterval;
      const domQuietPeriod  = opts.domQuietPeriod  || DEFAULTS.domQuietPeriod;
      const domMinMutations = opts.domMinMutations || DEFAULTS.domMinMutations;
      const streamingIndicator = opts.streamingIndicator || null;
      const signal          = opts.signal;

      const startTime = Date.now();

      // Determine which strategy to use based on signal type
      const signalType = completionFingerprint?._signalType || SIGNAL_TYPES.ELEMENT_DISAPPEARS;

      console.log(`[CompletionDetector] Using strategy: ${signalType}`);

      // ══════════════════════════════════════════════════════════════
      //  STRATEGY 1: ELEMENT_APPEARS (Recommended for new recordings)
      // ══════════════════════════════════════════════════════════════
      if (signalType === SIGNAL_TYPES.ELEMENT_APPEARS) {
        return this._waitForCompletionIndicator(completionFingerprint, {
          streamingIndicator,
          maxWaitTime,
          pollInterval,
          domQuietPeriod,
          domMinMutations,
          signal,
          startTime,
        });
      }

      // ══════════════════════════════════════════════════════════════
      //  STRATEGY 2: ELEMENT_DISAPPEARS (Legacy stop button approach)
      // ══════════════════════════════════════════════════════════════
      return this._waitForStopButtonDisappear(completionFingerprint, {
        maxWaitTime,
        pollInterval,
        domQuietPeriod,
        domMinMutations,
        signal,
        startTime,
      });
    },


    // ══════════════════════════════════════════════════════════════════
    //  STRATEGY 1: WAIT FOR COMPLETION INDICATOR TO APPEAR
    // ══════════════════════════════════════════════════════════════════

    /**
     * Wait for a completion indicator element to appear, become visible,
     * or become enabled (e.g., send button re-enabled).
     */
    async _waitForCompletionIndicator(fingerprint, opts) {
      const {
        streamingIndicator,
        maxWaitTime,
        pollInterval,
        domQuietPeriod,
        domMinMutations,
        signal,
        startTime,
      } = opts;

      console.log('[CompletionDetector] Waiting for completion indicator to appear...');

      // Optional: If we have a streaming indicator (stop button), wait for it first
      if (streamingIndicator) {
        console.log('[CompletionDetector] Checking for streaming indicator (stop button)...');

        const streamingAppeared = await this._waitForElementState(
          streamingIndicator,
          'appear',
          { timeout: 15000, pollInterval, signal }
        );

        if (signal?.aborted) {
          return { completed: false, method: 'aborted', duration: Date.now() - startTime };
        }

        if (streamingAppeared) {
          console.log('[CompletionDetector] ✅ Streaming started (stop button visible)');
        } else {
          console.log('[CompletionDetector] Stop button not seen — AI may respond quickly');
        }
      }

      // Now wait for the completion indicator to appear
      const result = await this._waitForElementReady(fingerprint, {
        timeout: maxWaitTime - (Date.now() - startTime),
        pollInterval,
        signal,
      });

      if (signal?.aborted) {
        return { completed: false, method: 'aborted', duration: Date.now() - startTime };
      }

      if (result.found) {
        // Add buffer time for UI to settle
        await PC.Utils.sleep(500);

        const duration = Date.now() - startTime;
        console.log(`[CompletionDetector] ✅ Completion indicator found (${PC.Utils.formatDuration(duration)})`);

        return {
          completed: true,
          method: 'completionIndicator',
          duration,
          timedOut: false,
          element: result.element,
          confidence: result.confidence,
        };
      }

      // Fallback: Completion indicator never appeared
      console.warn('[CompletionDetector] Completion indicator not found — trying DOM fallback');

      const domResult = await this._domMutationFallback({
        quietPeriod: domQuietPeriod,
        minMutations: domMinMutations,
        timeout: maxWaitTime - (Date.now() - startTime),
        signal,
      });

      return {
        ...domResult,
        duration: Date.now() - startTime,
      };
    },

    /**
     * Wait for an element to be present, visible, and enabled.
     */
    _waitForElementReady(fingerprint, opts) {
      return new Promise((resolve) => {
        const { timeout, pollInterval, signal } = opts;
        const startTime = Date.now();
        let timer = null;
        let initialCheck = true;

        const cleanup = () => {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        };

        if (signal) {
          signal.addEventListener('abort', () => {
            cleanup();
            resolve({ found: false });
          }, { once: true });
        }

        const check = () => {
          // Timeout
          if (Date.now() - startTime > timeout) {
            cleanup();
            resolve({ found: false, timedOut: true });
            return;
          }

          // Abort
          if (signal?.aborted) {
            cleanup();
            resolve({ found: false });
            return;
          }

          const match = PC.SelectorEngine.find(fingerprint);

          if (!match || match.confidence < CONF.MINIMUM) {
            // Element not found yet
            if (initialCheck) {
              console.log('[CompletionDetector] Completion indicator not yet visible...');
              initialCheck = false;
            }
            return;
          }

          const el = match.element;

          // Check if element is actually visible and ready
          if (!this._isElementVisible(el)) {
            return;
          }

          // Check if element is enabled (for buttons)
          // If the recorded state shows it was enabled when recording finished,
          // we wait for it to be enabled again
          const recordedState = fingerprint._recordedState;
          if (recordedState && recordedState.wasDisabled === false) {
            const isCurrentlyDisabled = el.disabled || 
                                        el.getAttribute('aria-disabled') === 'true' ||
                                        el.classList.contains('disabled');
            if (isCurrentlyDisabled) {
              // Still disabled — keep waiting
              return;
            }
          }

          // Element is ready!
          cleanup();
          resolve({
            found: true,
            element: el,
            confidence: match.confidence,
          });
        };

        // First check immediately
        check();

        // Then poll
        timer = setInterval(check, pollInterval);
      });
    },


    // ══════════════════════════════════════════════════════════════════
    //  STRATEGY 2: WAIT FOR STOP BUTTON TO DISAPPEAR (Legacy)
    // ══════════════════════════════════════════════════════════════════

    /**
     * Legacy approach: Wait for stop button to appear then disappear.
     */
    async _waitForStopButtonDisappear(fingerprint, opts) {
      const {
        maxWaitTime,
        pollInterval,
        domQuietPeriod,
        domMinMutations,
        signal,
        startTime,
      } = opts;

      // ── Phase 1: Wait for stop button to APPEAR (AI started) ────
      console.log('[CompletionDetector] Phase 1: Waiting for stop button to appear...');

      const appeared = await this._waitForElementState(
        fingerprint,
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
          fingerprint,
          'disappear',
          {
            timeout: maxWaitTime - (Date.now() - startTime),
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
      console.warn(
        '[CompletionDetector] Stop button never appeared — ' +
        'falling back to DOM mutation stabilization'
      );

      const domResult = await this._domMutationFallback({
        quietPeriod: domQuietPeriod,
        minMutations: domMinMutations,
        timeout: maxWaitTime - (Date.now() - startTime),
        signal,
      });

      return {
        ...domResult,
        duration: Date.now() - startTime,
      };
    },


    // ══════════════════════════════════════════════════════════════════
    //  SHARED HELPERS
    // ══════════════════════════════════════════════════════════════════

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
          const isPresent = match !== null && 
                           match.confidence >= CONF.MINIMUM &&
                           this._isElementVisible(match?.element);

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

    /**
     * Check if an element is visible on the page.
     */
    _isElementVisible(element) {
      if (!element) return false;
      if (!element.isConnected) return false;

      const style = window.getComputedStyle(element);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;

      return true;
    },


    // ══════════════════════════════════════════════════════════════════
    //  FALLBACK: DOM MUTATION STABILIZATION
    // ══════════════════════════════════════════════════════════════════

    /**
     * Watch for DOM mutations to stabilize (stop changing).
     * If no mutations for quietPeriod ms after seeing minMutations,
     * we assume the AI response is complete.
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
        '.flex.flex-col',
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


    // ══════════════════════════════════════════════════════════════════
    //  PUBLIC UTILITIES
    // ══════════════════════════════════════════════════════════════════

    /**
     * Quick check: Is the completion indicator currently visible?
     * Useful for health checks.
     */
    isComplete(fingerprint) {
      if (!fingerprint) return false;

      const match = PC.SelectorEngine.find(fingerprint);
      if (!match || match.confidence < CONF.MINIMUM) return false;

      return this._isElementVisible(match.element);
    },

    /**
     * Quick check: Is the streaming indicator (stop button) currently visible?
     */
    isStreaming(fingerprint) {
      if (!fingerprint) return false;

      const match = PC.SelectorEngine.find(fingerprint);
      if (!match || match.confidence < CONF.MINIMUM) return false;

      return this._isElementVisible(match.element);
    },
  };

  console.log('[PC CompletionDetector] ✅ Module loaded');

})();