/**
 * content/chainRunner.js
 * ────────────────────────────────────────────
 * The core chain execution engine.
 * Runs a sequence of prompts one by one:
 *   inject → send → wait for response → (extra action) → next prompt
 *
 * State machine:
 *   idle → running → (paused) → completed / failed / cancelled
 *
 * Error recovery:
 *   retry N times per step → log failure → auto-continue to next prompt
 *
 * Survives popup close (runs in content script).
 * Reports status to background via chrome.runtime messages.
 *
 * Dependencies:
 *   - PC.Replayer
 *   - PC.CompletionDetector
 *   - PC.ExtraAction
 *   - PC.HealthChecker
 *   - PC.SelectorEngine
 *   - PC.Storage
 *   - PC.Logger
 *   - PC.Messages
 *   - PC.Constants
 *   - PC.Utils
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const MSG = PC.MessageTypes;
  const STATES = PC.Constants.CHAIN_STATES;
  const STEP_STATES = PC.Constants.STEP_STATES;
  const DEFAULTS = PC.Constants.DEFAULT_SETTINGS;


  class ChainRunner {
    constructor() {
      this.state = STATES.IDLE;
      this.queue = [];            // prompt strings
      this.currentIndex = 0;
      this.recipe = null;
      this.chainId = null;
      this.sessionId = null;
      this.settings = {};

      this._abortController = null;
      this._pausePromise = null;
      this._pauseResolver = null;
      this._interferenceHandler = null;
      this._startTime = 0;

      // Per-step results for reporting
      this.stepResults = [];
    }


    // ══════════════════════════════════════════════════════════════
    //  MAIN ENTRY POINT
    // ══════════════════════════════════════════════════════════════

    /**
     * Run a chain of prompts.
     *
     * @param {object} opts
     * @param {object} opts.recipe - The recorded recipe
     * @param {object} opts.chain  - The prompt chain { id, name, prompts:string[] }
     * @param {object} [opts.settings] - Override replay settings
     * @returns {Promise<object>} execution summary
     */
    async run({ recipe, chain, settings = {} }) {
      if (this.state === STATES.RUNNING || this.state === STATES.PAUSED) {
        throw new Error('A chain is already running');
      }

      // ── Setup ───────────────────────────────────────────
      this.recipe = recipe;
      this.queue = chain.prompts || [];
      this.chainId = chain.id;
      this.currentIndex = 0;
      this.stepResults = [];
      this.state = STATES.RUNNING;
      this._abortController = new AbortController();
      this._startTime = Date.now();

      // Merge settings: chain settings → recipe settings → defaults
      this.settings = { ...DEFAULTS, ...(recipe.settings || {}), ...settings };

      // Session for logging
      this.sessionId = PC.Utils.uuid();
      PC.Logger.setContext({
        sessionId: this.sessionId,
        recipeId: recipe.id,
        chainId: chain.id,
      });

      // ── Health Check ────────────────────────────────────
      const health = PC.HealthChecker.check(recipe);
      if (!health.canRun) {
        this.state = STATES.FAILED;
        const msg = `Health check failed — broken: [${health.brokenElements.join(', ')}]`;
        PC.Logger.chainFail({ error: msg });
        this._reportStatus(MSG.CHAIN_FAILED, { error: msg });
        PC.Logger.clearContext();
        return { success: false, error: msg };
      }

      // ── Start ───────────────────────────────────────────
      PC.Logger.chainStart({
        totalPrompts: this.queue.length,
        domain: recipe.domain,
        chainName: chain.name,
      });

      this._reportStatus(MSG.CHAIN_STARTED, {
        total: this.queue.length,
        chainName: chain.name,
        domain: recipe.domain,
      });

      this._setupInterferenceDetection();

      // ── Main Loop ───────────────────────────────────────
      try {
        for (let i = 0; i < this.queue.length; i++) {
          // Check abort
          if (this._abortController.signal.aborted) {
            this.state = STATES.CANCELLED;
            break;
          }

          // Check pause
          if (this.state === STATES.PAUSED) {
            await this._waitForResume();
            if (this._abortController.signal.aborted) {
              this.state = STATES.CANCELLED;
              break;
            }
          }

          this.currentIndex = i;
          const prompt = this.queue[i];

          this._reportStatus(MSG.STEP_STARTED, {
            step: i,
            total: this.queue.length,
            promptPreview: PC.Utils.truncate(prompt, 60),
          });

          const stepResult = await this._executeStep(prompt, i);
          this.stepResults.push(stepResult);

          if (stepResult.status === STEP_STATES.COMPLETED) {
            this._reportStatus(MSG.STEP_COMPLETED, {
              step: i,
              total: this.queue.length,
              duration: stepResult.duration,
            });
          } else {
            this._reportStatus(MSG.STEP_FAILED, {
              step: i,
              total: this.queue.length,
              error: stepResult.error,
            });
            // Auto-continue to next prompt (per Q5 requirement)
          }
        }

        // ── Finish ──────────────────────────────────────────
        if (this.state === STATES.CANCELLED) {
          PC.Logger.chainCancel({ stoppedAt: this.currentIndex });
          this._reportStatus(MSG.CHAIN_CANCELLED, {
            stoppedAt: this.currentIndex,
          });
        } else {
          this.state = STATES.COMPLETED;
          const totalDuration = Date.now() - this._startTime;

          const successCount = this.stepResults.filter(
            (r) => r.status === STEP_STATES.COMPLETED
          ).length;
          const failCount = this.stepResults.filter(
            (r) => r.status === STEP_STATES.FAILED
          ).length;

          PC.Logger.chainComplete({
            total: this.queue.length,
            success: successCount,
            failed: failCount,
            duration: totalDuration,
          });

          this._reportStatus(MSG.CHAIN_COMPLETED, {
            total: this.queue.length,
            success: successCount,
            failed: failCount,
            duration: totalDuration,
          });
        }

        return {
          success: this.state === STATES.COMPLETED,
          state: this.state,
          steps: this.stepResults,
          duration: Date.now() - this._startTime,
        };

      } catch (err) {
        this.state = STATES.FAILED;
        PC.Logger.chainFail({ error: err.message });
        this._reportStatus(MSG.CHAIN_FAILED, { error: err.message });
        return { success: false, error: err.message };

      } finally {
        this._cleanup();
        PC.Logger.clearContext();
      }
    }


    // ══════════════════════════════════════════════════════════════
    //  EXECUTE A SINGLE STEP (with retry logic)
    // ══════════════════════════════════════════════════════════════

    async _executeStep(prompt, index) {
      const maxRetries = this.settings.retryAttempts;
      const signal = this._abortController.signal;
      let lastError = null;
      const stepStart = Date.now();

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (signal.aborted) throw new Error('Chain cancelled');

          // Retry delay (exponential backoff)
          if (attempt > 0) {
            const retryDelay = 1000 * Math.pow(2, attempt - 1);
            console.log(`[ChainRunner] Retry ${attempt}/${maxRetries} for prompt ${index} — waiting ${retryDelay}ms`);

            PC.Logger.retry({
              promptIndex: index,
              attempt,
              maxRetries,
            });

            this._reportStatus(MSG.STEP_RETRYING, {
              step: index,
              attempt,
              maxRetries,
            });

            await PC.Utils.jitteredSleep(retryDelay, this.settings.jitterMs, signal);
          }

          // ── A. Pre-injection delay ──────────────────────
          await PC.Utils.jitteredSleep(
            this.settings.delayBeforeInject,
            this.settings.jitterMs,
            signal
          );

           // ── B. INJECT TEXT (with verification) ─────────
          const injectResult = await PC.Replayer.injectAndVerify(
            this.recipe.elements.targetInput,
            prompt,
            { verifyDelay: 200, verifyAttempts: 3 }
          );

          if (!injectResult.success) {
            throw new Error(`Inject failed: ${injectResult.error}`);
          }

          PC.Logger.inject(PC.Constants.LOG_STATUSES.SUCCESS, {
            promptIndex: index,
            attempt,
            confidence: injectResult.confidence,
            method: injectResult.method,
            verified: injectResult.verified,
            verifyAttempt: injectResult.verifyAttempt,
          });

          // ── C. Post-inject delay (framework sync) ──────
          // Shorter now since injectAndVerify already waited for verify
          await PC.Utils.jitteredSleep(
            Math.max(100, this.settings.delayAfterInject - 200),
            this.settings.jitterMs,
            signal
          );

          // ── C2. Final check: is text still there? ──────
          const textCheck = await PC.Replayer.getInputText(this.recipe.elements.targetInput);
          if (textCheck.length === 0) {
            throw new Error('Input was cleared before send — page may be interfering');
          }

          // ── D. CLICK SEND ──────────────────────────────
          const sendResult = await PC.Replayer.clickSend(
            this.recipe.elements.sendTrigger,
            this.recipe.elements.targetInput
          );

          if (!sendResult.success) {
            throw new Error(`Send failed: ${sendResult.error}`);
          }

          PC.Logger.send(PC.Constants.LOG_STATUSES.SUCCESS, {
            promptIndex: index,
            attempt,
            confidence: sendResult.confidence,
            method: sendResult.method,
            usedFallback: sendResult.usedFallback,
          });

          // ── E. Post-send delay (AI startup time) ───────
          await PC.Utils.jitteredSleep(
            this.settings.delayAfterSend,
            this.settings.jitterMs,
            signal
          );

          // ── F. WAIT FOR COMPLETION ─────────────────────
          PC.Logger.waitStart({ promptIndex: index });

          const completionResult = await PC.CompletionDetector.waitForCompletion(
            this.recipe.elements.completionSignal,
            {
              maxWaitTime: this.settings.maxWaitTime,
              pollInterval: this.settings.pollInterval,
              domQuietPeriod: this.settings.domQuietPeriod,
              domMinMutations: this.settings.domMinMutations,
              signal,
            }
          );

          if (!completionResult.completed) {
            if (completionResult.timedOut) {
              throw new Error(`Response timeout — AI took longer than ${PC.Utils.formatDuration(this.settings.maxWaitTime)}`);
            }
            if (signal.aborted) throw new Error('Chain cancelled');
            throw new Error('Completion detection failed');
          }

          PC.Logger.waitComplete({
            promptIndex: index,
            duration: completionResult.duration,
            method: completionResult.method,
          });

          // ── G. Post-response delay ─────────────────────
          await PC.Utils.jitteredSleep(
            this.settings.delayAfterResponse,
            this.settings.jitterMs,
            signal
          );

          // ── H. EXTRA ACTION (optional) ─────────────────
          if (this.recipe.elements.extraAction) {
            const extraResult = await PC.ExtraAction.execute(
              this.recipe.elements.extraAction
            );

            PC.Logger.extraAction(
              extraResult.success
                ? PC.Constants.LOG_STATUSES.SUCCESS
                : PC.Constants.LOG_STATUSES.FAILED,
              {
                promptIndex: index,
                actionType: extraResult.actionType,
                error: extraResult.error,
              }
            );

            // Extra action failure is non-fatal — log and continue
            if (!extraResult.success) {
              console.warn(`[ChainRunner] Extra action failed: ${extraResult.error}`);
            }

            // Small delay after extra action
            await PC.Utils.sleep(500);
          }

          // ── I. Scroll to bottom ────────────────────────
          this._scrollToBottom();

          // ── SUCCESS ────────────────────────────────────
          return {
            status: STEP_STATES.COMPLETED,
            promptIndex: index,
            attempt,
            duration: Date.now() - stepStart,
          };

        } catch (err) {
          lastError = err;

          if (err.message === 'Chain cancelled' || err.message === 'Sleep aborted') {
            return {
              status: STEP_STATES.FAILED,
              promptIndex: index,
              attempt,
              duration: Date.now() - stepStart,
              error: 'Cancelled',
            };
          }

          console.warn(
            `[ChainRunner] Step ${index} attempt ${attempt} failed: ${err.message}`
          );
        }
      }

      // ── ALL RETRIES EXHAUSTED — Log and auto-continue ──────
      const errorMsg = `Step ${index} failed after ${maxRetries + 1} attempts: ${lastError?.message}`;
      console.error(`[ChainRunner] ${errorMsg}`);

      PC.Logger.skip({
        promptIndex: index,
        error: errorMsg,
        attempts: maxRetries + 1,
      });

      return {
        status: STEP_STATES.FAILED,
        promptIndex: index,
        attempt: maxRetries,
        duration: Date.now() - stepStart,
        error: lastError?.message,
      };
    }


    // ══════════════════════════════════════════════════════════════
    //  CONTROLS: Pause / Resume / Cancel / Skip
    // ══════════════════════════════════════════════════════════════

    pause() {
      if (this.state !== STATES.RUNNING) return;
      this.state = STATES.PAUSED;
      this._pausePromise = new Promise((resolve) => {
        this._pauseResolver = resolve;
      });
      PC.Logger.chainPause({ step: this.currentIndex });
      this._reportStatus(MSG.CHAIN_PAUSED, { step: this.currentIndex });
      console.log(`[ChainRunner] ⏸ Paused at step ${this.currentIndex}`);
    }

    resume() {
      if (this.state !== STATES.PAUSED) return;
      this.state = STATES.RUNNING;
      if (this._pauseResolver) {
        this._pauseResolver();
        this._pauseResolver = null;
        this._pausePromise = null;
      }
      PC.Logger.chainResume({ step: this.currentIndex });
      this._reportStatus(MSG.CHAIN_RESUMED, { step: this.currentIndex });
      console.log(`[ChainRunner] ▶ Resumed at step ${this.currentIndex}`);
    }

    cancel() {
      if (this.state !== STATES.RUNNING && this.state !== STATES.PAUSED) return;
      this.state = STATES.CANCELLED;
      if (this._abortController) this._abortController.abort();
      if (this._pauseResolver) {
        this._pauseResolver();
        this._pauseResolver = null;
      }
      console.log('[ChainRunner] ⏹ Cancelled');
    }

    _waitForResume() {
      return this._pausePromise || Promise.resolve();
    }


    // ══════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════

    /**
     * Send status to background (which forwards to popup/sidepanel).
     */
    _reportStatus(type, data = {}) {
      PC.Messages.send(type, {
        ...data,
        sessionId: this.sessionId,
        chainId: this.chainId,
        currentIndex: this.currentIndex,
        state: this.state,
      });
    }

    /**
     * Detect if user starts typing manually — auto-pause.
     */
    _setupInterferenceDetection() {
      const inputMatch = PC.SelectorEngine.find(this.recipe.elements.targetInput);
      if (!inputMatch) return;

      const el = inputMatch.element;

      this._interferenceHandler = (e) => {
        if (e.isTrusted && this.state === STATES.RUNNING) {
          console.log('[ChainRunner] ⚠️ User interference detected — auto-pausing');
          PC.Logger.log(
            PC.Constants.LOG_ACTIONS.ERROR,
            PC.Constants.LOG_STATUSES.INFO,
            { message: 'User interference — auto-paused', step: this.currentIndex }
          );
          this._reportStatus(MSG.USER_INTERFERENCE, {
            step: this.currentIndex,
          });
          this.pause();
        }
      };

      el.addEventListener('keydown', this._interferenceHandler);
    }

    _scrollToBottom() {
      // Try to find and scroll the chat container
      const containers = [
        '#chatMessages',  // demo site
        'main',
        '[role="main"]',
        '[role="presentation"]',
        '.chat-messages',
      ];

      for (const sel of containers) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            return;
          }
        } catch { /* skip */ }
      }

      // Fallback: scroll the whole page
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }

    _cleanup() {
      this.state = STATES.IDLE;
      this._abortController = null;
      this._pausePromise = null;
      this._pauseResolver = null;

      // Remove interference handler
      if (this._interferenceHandler) {
        const inputMatch = PC.SelectorEngine.find(this.recipe?.elements?.targetInput);
        if (inputMatch) {
          inputMatch.element.removeEventListener('keydown', this._interferenceHandler);
        }
        this._interferenceHandler = null;
      }
    }

    /**
     * Get current status snapshot (for sidepanel reconnection).
     */
    getStatus() {
      return {
        state: this.state,
        currentIndex: this.currentIndex,
        total: this.queue.length,
        chainId: this.chainId,
        sessionId: this.sessionId,
        stepResults: this.stepResults,
        duration: this.state === STATES.IDLE ? 0 : Date.now() - this._startTime,
      };
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  SINGLETON + PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  const runner = new ChainRunner();

  root.PC.ChainRunner = {
    run(opts)   { return runner.run(opts); },
    pause()     { runner.pause(); },
    resume()    { runner.resume(); },
    cancel()    { runner.cancel(); },
    getStatus() { return runner.getStatus(); },

    get state()        { return runner.state; },
    get currentIndex() { return runner.currentIndex; },
    get isRunning()    { return runner.state === STATES.RUNNING || runner.state === STATES.PAUSED; },

    /**
     * Message handlers registered by main.js
     */
    _messageHandlers: {
      [MSG.RUN_CHAIN]: async (message) => {
        if (runner.state === STATES.RUNNING || runner.state === STATES.PAUSED) {
          return { success: false, error: 'Chain already running' };
        }

        const { recipeId, chainId } = message;

        // Load recipe and chain from storage
        const recipe = recipeId
          ? await PC.Storage.recipes.getById(recipeId)
          : await PC.Storage.recipes.getByDomain(window.location.hostname);

        if (!recipe) {
          return { success: false, error: 'Recipe not found' };
        }

        const chain = await PC.Storage.chains.getById(chainId);
        if (!chain) {
          return { success: false, error: 'Chain not found' };
        }

        // Run async — don't block the message response
        runner.run({ recipe, chain, settings: message.settings || {} })
          .then((result) => {
            console.log('[ChainRunner] Chain execution finished:', result);
          })
          .catch((err) => {
            console.error('[ChainRunner] Chain execution error:', err);
          });

        return { success: true, message: 'Chain started' };
      },

      [MSG.PAUSE_CHAIN]: () => {
        runner.pause();
        return { success: true };
      },

      [MSG.RESUME_CHAIN]: () => {
        runner.resume();
        return { success: true };
      },

      [MSG.CANCEL_CHAIN]: () => {
        runner.cancel();
        return { success: true };
      },

      [MSG.GET_CHAIN_STATUS]: () => {
        return runner.getStatus();
      },
    },
  };

  console.log('[PC ChainRunner] ✅ Module loaded');

})();