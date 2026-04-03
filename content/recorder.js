/**
 * content/recorder.js
 * ────────────────────────────────────────────
 * Element Picker + Setup Wizard for recording action recipes.
 *
 * The recording flow has 4 steps:
 *   Step 1: User clicks the TEXT INPUT where prompts go
 *   Step 2: User clicks the SEND BUTTON
 *   Step 3: User sends a test message, system detects completion
 *   Step 4 (optional): User clicks an EXTRA ACTION element
 *
 * For supported AI sites (Gemini, ChatGPT, Claude, etc.), Step 3 uses
 * site-specific detection. For unknown sites, falls back to manual picking.
 *
 * Dependencies:
 *   - PC.SelectorEngine
 *   - PC.ResponseDetector
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
  const STEPS = PC.Constants.RECORDING_STEPS;


  // ══════════════════════════════════════════════════════════════════
  //  ELEMENT PICKER
  // ══════════════════════════════════════════════════════════════════

  class ElementPicker {
    constructor() {
      this._active = false;
      this._currentTarget = null;
      this._resolve = null;
      this._reject = null;

      this._handleMouseMove = this._handleMouseMove.bind(this);
      this._handleClick = this._handleClick.bind(this);
      this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    /**
     * Start the element picker.
     * Returns a Promise that resolves with the picked element,
     * or rejects if cancelled (Escape key or stop() called).
     *
     * @returns {Promise<HTMLElement>}
     */
    start() {
      return new Promise((resolve, reject) => {
        this._active = true;
        this._resolve = resolve;
        this._reject = reject;

        document.addEventListener('mousemove', this._handleMouseMove, true);
        document.addEventListener('click', this._handleClick, true);
        document.addEventListener('keydown', this._handleKeyDown, true);
      });
    }

    /**
     * Stop the element picker.
     * If a pick is pending, rejects the Promise with 'Picker cancelled'.
     */
    stop() {
      if (!this._active) return;

      this._active = false;
      this._removeHighlight();

      document.removeEventListener('mousemove', this._handleMouseMove, true);
      document.removeEventListener('click', this._handleClick, true);
      document.removeEventListener('keydown', this._handleKeyDown, true);

      // Reject the pending Promise so the caller knows we stopped
      if (this._reject) {
        const rej = this._reject;
        this._resolve = null;
        this._reject = null;
        rej(new Error('Picker cancelled'));
      }
    }

    _handleMouseMove(e) {
      if (!this._active) return;
      const target = e.target;
      if (this._isOwnElement(target)) return;

      this._removeHighlight();
      this._currentTarget = target;
      target.classList.add('pc-highlight-element');
    }

    _handleClick(e) {
      if (!this._active) return;
      const target = e.target;
      if (this._isOwnElement(target)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      this._removeHighlight();

      // Flash animation
      target.classList.add('pc-picked-flash');
      setTimeout(() => target.classList.remove('pc-picked-flash'), 600);

      // Resolve the Promise with the picked element
      this._active = false;
      document.removeEventListener('mousemove', this._handleMouseMove, true);
      document.removeEventListener('click', this._handleClick, true);
      document.removeEventListener('keydown', this._handleKeyDown, true);

      if (this._resolve) {
        const res = this._resolve;
        this._resolve = null;
        this._reject = null;
        res(target);
      }
    }

    _handleKeyDown(e) {
      if (!this._active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.stop(); // This will reject the Promise
      }
    }

    _removeHighlight() {
      if (this._currentTarget) {
        this._currentTarget.classList.remove('pc-highlight-element');
        this._currentTarget = null;
      }
    }

    _isOwnElement(el) {
      if (!el) return false;
      return !!(
        el.closest('.pc-recording-banner') ||
        el.closest('.pc-waiting-overlay')
      );
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  OVERLAY UI
  // ══════════════════════════════════════════════════════════════════

  class RecordingOverlay {
    constructor() {
      this._banner = null;
      this._waitingOverlay = null;
    }

    showBanner(opts) {
      this.removeBanner();

      const banner = document.createElement('div');
      banner.className = 'pc-recording-banner';

      const content = document.createElement('div');
      content.className = 'pc-banner-content';

      const step = document.createElement('span');
      step.className = 'pc-banner-step';
      step.textContent = `Step ${opts.stepLabel}`;

      const text = document.createElement('span');
      text.className = 'pc-banner-text';
      text.textContent = opts.text;

      const progress = document.createElement('div');
      progress.className = 'pc-progress';
      for (let i = 0; i < opts.totalSteps; i++) {
        const dot = document.createElement('div');
        dot.className = 'pc-progress-dot';
        if (i < opts.currentStep) dot.classList.add('pc-progress-dot--done');
        if (i === opts.currentStep) dot.classList.add('pc-progress-dot--active');
        progress.appendChild(dot);
      }

      content.appendChild(step);
      content.appendChild(text);
      content.appendChild(progress);

      const actions = document.createElement('div');
      actions.className = 'pc-banner-actions';

      if (opts.showSkip && opts.onSkip) {
        const skipBtn = document.createElement('button');
        skipBtn.className = 'pc-banner-btn';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onSkip();
        });
        actions.appendChild(skipBtn);
      }

      if (opts.onCancel) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'pc-banner-btn pc-banner-btn--cancel';
        cancelBtn.textContent = '✕ Cancel';
        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onCancel();
        });
        actions.appendChild(cancelBtn);
      }

      banner.appendChild(content);
      banner.appendChild(actions);
      document.body.appendChild(banner);
      this._banner = banner;
    }

    updateBannerText(text) {
      if (this._banner) {
        const textEl = this._banner.querySelector('.pc-banner-text');
        if (textEl) textEl.textContent = text;
      }
    }

    removeBanner() {
      if (this._banner) {
        this._banner.remove();
        this._banner = null;
      }
    }

    showWaiting(text) {
      this.removeWaiting();

      const overlay = document.createElement('div');
      overlay.className = 'pc-waiting-overlay';

      const spinner = document.createElement('span');
      spinner.className = 'pc-waiting-spinner';

      overlay.appendChild(spinner);
      overlay.appendChild(document.createTextNode(text));
      document.body.appendChild(overlay);
      this._waitingOverlay = overlay;
    }

    updateWaitingText(text) {
      if (this._waitingOverlay) {
        // Remove old text nodes, keep spinner
        const spinner = this._waitingOverlay.querySelector('.pc-waiting-spinner');
        this._waitingOverlay.textContent = '';
        if (spinner) this._waitingOverlay.appendChild(spinner);
        this._waitingOverlay.appendChild(document.createTextNode(text));
      }
    }

    removeWaiting() {
      if (this._waitingOverlay) {
        this._waitingOverlay.remove();
        this._waitingOverlay = null;
      }
    }

    removeAll() {
      this.removeBanner();
      this.removeWaiting();
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  SETUP WIZARD
  // ══════════════════════════════════════════════════════════════════

  class SetupWizard {
    constructor() {
      this._picker = new ElementPicker();
      this._overlay = new RecordingOverlay();
      this._active = false;
      this._cancelled = false;
      this._recipe = null;
      this._siteConfig = null;
    }

    get isActive() {
      return this._active;
    }

    async start(recipeName) {
      if (this._active) {
        console.warn('[Recorder] A recording session is already active');
        return null;
      }

      this._active = true;
      this._cancelled = false;

      // Initialize ResponseDetector for site-specific features
      this._siteConfig = null;
      
      if (this._siteConfig) {
        console.log(`[Recorder] Site detected: ${this._siteConfig.name}`);
      } else {
        console.log('[Recorder] Unknown site — using manual detection');
      }

      const pageInfo = PC.Content ? PC.Content.getPageInfo() : {
        hostname: window.location.hostname,
        pathname: window.location.pathname,
        url: window.location.href,
        title: document.title,
      };

      this._recipe = {
        name: recipeName || `Recipe for ${pageInfo.hostname}`,
        domain: pageInfo.hostname,
        elements: {
          targetInput: null,
          sendTrigger: null,
          completionSignal: null,
          extraAction: null,
        },
        settings: { ...PC.Constants.DEFAULT_SETTINGS },
        // Store site info for chain execution
        siteInfo: {
          siteName: this._siteConfig?.name || null,
          isKnownSite: !!this._siteConfig,
          detectionMethod: this._siteConfig ? 'siteConfig' : 'manual',
        },
      };

      PC.Logger.recordStart({
        domain: pageInfo.hostname,
        url: pageInfo.url,
        siteName: this._siteConfig?.name,
      });

      PC.Messages.send(MSG.RECORDING_STEP, {
        step: 'started',
        domain: pageInfo.hostname,
        siteName: this._siteConfig?.name,
      });

      try {
        await this._step1_targetInput();
        this._checkCancelled();

        await this._step2_sendTrigger();
        this._checkCancelled();

        await this._step3_completionSignal();
        this._checkCancelled();

        await this._step4_extraAction();

        const saved = await this._saveRecipe();

        PC.Logger.recordComplete({
          recipeId: saved.id,
          domain: saved.domain,
        });

        PC.Messages.send(MSG.RECORDING_COMPLETE, { recipe: saved });

        return saved;

      } catch (err) {
        if (err.message === 'Recording cancelled' || err.message === 'Picker cancelled') {
          PC.Logger.recordCancel({ reason: 'user' });
          PC.Messages.send(MSG.RECORDING_CANCELLED, { reason: 'user' });
          console.log('[Recorder] Recording cancelled by user');
        } else {
          PC.Logger.error({ error: err.message, context: 'recording' });
          PC.Messages.send(MSG.RECORDING_CANCELLED, { reason: err.message });
          console.error('[Recorder] Recording failed:', err);
        }
        return null;

      } finally {
        this._cleanup();
      }
    }

    cancel() {
      if (!this._active) return;
      this._cancelled = true;
      this._picker.stop(); // This rejects any pending pick
      this._cleanup();
    }

    /**
     * Throws if cancel() was called between steps.
     */
    _checkCancelled() {
      if (this._cancelled) {
        throw new Error('Recording cancelled');
      }
    }


    // ── Step 1: Record Target Input ─────────────────────────────

    async _step1_targetInput() {
      // For supported sites, try auto-detection first
      if (this._siteConfig) {
        const autoInput = PC.ResponseDetector.findElement('input');
        if (autoInput) {
          this._overlay.showBanner({
            stepLabel: '1/4',
            text: `✅ Auto-detected input for ${this._siteConfig.name}. Click it to confirm, or click a different element.`,
            totalSteps: 4,
            currentStep: 0,
            onCancel: () => this.cancel(),
          });

          // Highlight the auto-detected element
          autoInput.classList.add('pc-highlight-element');
        } else {
          this._overlay.showBanner({
            stepLabel: '1/4',
            text: '📝 Click on the TEXT INPUT AREA where you type prompts',
            totalSteps: 4,
            currentStep: 0,
            onCancel: () => this.cancel(),
          });
        }
      } else {
        this._overlay.showBanner({
          stepLabel: '1/4',
          text: '📝 Click on the TEXT INPUT AREA where you type prompts',
          totalSteps: 4,
          currentStep: 0,
          onCancel: () => this.cancel(),
        });
      }

      const element = await this._picker.start();

      const tag = element.tagName.toLowerCase();
      const isEditable = element.getAttribute('contenteditable') === 'true';
      const isInput = ['textarea', 'input'].includes(tag);
      const isTextbox = element.getAttribute('role') === 'textbox';

      if (!isInput && !isEditable && !isTextbox) {
        console.warn(
          `[Recorder] Selected element is not a typical input (tag: ${tag}). Recording anyway.`
        );
      }

      const fingerprint = PC.SelectorEngine.fingerprint(element);
      fingerprint._inputType = isEditable ? 'contenteditable' :
                               tag === 'textarea' ? 'textarea' :
                               tag === 'input' ? 'input' : 'unknown';

      this._recipe.elements.targetInput = fingerprint;

      PC.Logger.recordStep({
        step: STEPS.TARGET_INPUT,
        tagName: tag,
        inputType: fingerprint._inputType,
      });

      PC.Messages.send(MSG.RECORDING_STEP, {
        step: STEPS.TARGET_INPUT,
        completed: true,
      });

      console.log(`[Recorder] ✅ Step 1 complete — recorded ${tag} input`);
    }


    // ── Step 2: Record Send Trigger ─────────────────────────────

    async _step2_sendTrigger() {
      // For supported sites, try auto-detection
      if (this._siteConfig) {
        const autoSubmit = PC.ResponseDetector.findElement('submit');
        if (autoSubmit) {
          this._overlay.showBanner({
            stepLabel: '2/4',
            text: `✅ Auto-detected send button. Click it to confirm, or click a different element.`,
            totalSteps: 4,
            currentStep: 1,
            onCancel: () => this.cancel(),
          });

          autoSubmit.classList.add('pc-highlight-element');
        } else {
          this._overlay.showBanner({
            stepLabel: '2/4',
            text: '📨 Click on the SEND BUTTON that submits your message',
            totalSteps: 4,
            currentStep: 1,
            onCancel: () => this.cancel(),
          });
        }
      } else {
        this._overlay.showBanner({
          stepLabel: '2/4',
          text: '📨 Click on the SEND BUTTON that submits your message',
          totalSteps: 4,
          currentStep: 1,
          onCancel: () => this.cancel(),
        });
      }

      const element = await this._picker.start();

      const fingerprint = PC.SelectorEngine.fingerprint(element);
      fingerprint._triggerType = 'click';

      this._recipe.elements.sendTrigger = fingerprint;

      PC.Logger.recordStep({
        step: STEPS.SEND_TRIGGER,
        tagName: element.tagName.toLowerCase(),
        text: PC.Utils.truncate(element.textContent, 30),
      });

      PC.Messages.send(MSG.RECORDING_STEP, {
        step: STEPS.SEND_TRIGGER,
        completed: true,
      });

      console.log('[Recorder] ✅ Step 2 complete — recorded send button');
    }


    // ── Step 3: Record Completion Signal ─────────────────────────

    async _step3_completionSignal() {
      // For SUPPORTED SITES: use automatic detection
      if (this._siteConfig) {
        await this._step3_automatic();
      } else {
        // For UNKNOWN SITES: fall back to manual stop button detection
        await this._step3_manual();
      }
    }

    /**
     * Step 3 for supported sites (Gemini, ChatGPT, Claude, etc.)
     * Uses ResponseDetector for automatic completion detection.
     */
    async _step3_automatic() {
      const siteName = this._siteConfig.name;

      this._overlay.showBanner({
        stepLabel: '3/4',
        text: `⏳ ${siteName} detected! Send a SHORT test message to verify detection...`,
        totalSteps: 4,
        currentStep: 2,
        onCancel: () => this.cancel(),
      });

      this._overlay.showWaiting(`Waiting for you to send a test message on ${siteName}...`);

      // Wait for user to send a message (DOM activity)
      await this._waitForDOMActivity(5);
      this._checkCancelled();

      // Now wait for AI to start streaming
      this._overlay.updateWaitingText('Detecting AI response...');

      // Wait a moment for streaming to start
      await PC.Utils.sleep(1000);

      // Check if we can detect streaming
      const isStreaming = PC.ResponseDetector.isStreaming();
      console.log(`[Recorder] Streaming detected: ${isStreaming}`);

      if (isStreaming) {
        this._overlay.updateBannerText(`🔄 ${siteName} is generating a response... waiting for completion`);
      }

      // Wait for response to complete using site-specific detection
      this._overlay.updateWaitingText('Waiting for AI response to complete...');

      try {
        const result = await PC.ResponseDetector.waitForResponse({
          timeout: 120000,
          pollInterval: 500,
          onProgress: (text) => {
            const preview = PC.Utils.truncate(text, 50);
            this._overlay.updateWaitingText(`Response: "${preview}..."`);
          },
        });

        console.log(`[Recorder] Response completed in ${result.duration}ms`);

        // Store a special completion signal that indicates site-specific detection
        this._recipe.elements.completionSignal = {
          _signalType: PC.Constants.SIGNAL_TYPES.SITE_SPECIFIC,
          _siteName: siteName,
          _detectionMethod: 'responseDetector',
          // Also store a fingerprint of the response container as fallback
          _responseFingerprint: result.element ? PC.SelectorEngine.fingerprint(result.element) : null,
          meta: {
            tagName: result.element?.tagName?.toLowerCase() || 'unknown',
            recordedAt: PC.Utils.timestamp(),
            recordedOnURL: window.location.hostname,
          },
        };

        this._overlay.removeWaiting();

        PC.Logger.recordStep({
          step: STEPS.COMPLETION_SIGNAL,
          method: 'siteSpecific',
          siteName,
          duration: result.duration,
        });

        PC.Messages.send(MSG.RECORDING_STEP, {
          step: STEPS.COMPLETION_SIGNAL,
          completed: true,
          method: 'siteSpecific',
        });

        console.log(`[Recorder] ✅ Step 3 complete — using ${siteName} auto-detection`);

        // Brief pause before step 4
        await PC.Utils.sleep(1000);

      } catch (err) {
        console.warn(`[Recorder] Site-specific detection failed: ${err.message}`);
        console.log('[Recorder] Falling back to manual detection...');

        // Fall back to manual
        this._overlay.removeWaiting();
        await this._step3_manual();
      }
    }

    /**
     * Step 3 for unknown sites — manual stop button detection.
     */
    async _step3_manual() {
      // Phase A: Tell user to send a test message
      this._overlay.showBanner({
        stepLabel: '3/4',
        text: '⏳ Type a SHORT test message and SEND IT manually. Wait for a Stop/Cancel button to appear...',
        totalSteps: 4,
        currentStep: 2,
        onCancel: () => this.cancel(),
      });

      this._overlay.showWaiting(
        'Waiting for you to send a message... When a Stop/Cancel button appears, the banner will update.'
      );

      // Phase B: Wait for some DOM activity (user interacting)
      await this._waitForDOMActivity(5);
      this._checkCancelled();

      // Phase C: Prompt user to click the stop button
      this._overlay.removeWaiting();
      this._overlay.showBanner({
        stepLabel: '3/4',
        text: '🛑 Great! Now CLICK on the STOP / CANCEL button that appeared while the AI is responding',
        totalSteps: 4,
        currentStep: 2,
        onCancel: () => this.cancel(),
      });

      const element = await this._picker.start();

      const fingerprint = PC.SelectorEngine.fingerprint(element);
      fingerprint._signalType = PC.Constants.SIGNAL_TYPES.ELEMENT_DISAPPEARS;

      this._recipe.elements.completionSignal = fingerprint;

      PC.Logger.recordStep({
        step: STEPS.COMPLETION_SIGNAL,
        tagName: element.tagName.toLowerCase(),
        text: PC.Utils.truncate(element.textContent, 30),
        signalType: 'elementDisappears',
      });

      PC.Messages.send(MSG.RECORDING_STEP, {
        step: STEPS.COMPLETION_SIGNAL,
        completed: true,
      });

      console.log('[Recorder] ✅ Step 3 complete — recorded stop/cancel button');

      // Wait for AI to finish before step 4
      this._overlay.showWaiting('Waiting for AI to finish responding...');
      await this._waitForElementToDisappear(fingerprint, 120000);
      this._overlay.removeWaiting();

      await PC.Utils.sleep(1500);
    }


    // ── Step 4: Record Extra Action (Optional) ───────────────────

    async _step4_extraAction() {
      // Wrap in a Promise so skip and cancel both resolve cleanly
      return new Promise(async (resolveStep) => {

        this._overlay.showBanner({
          stepLabel: '4/4',
          text: '🎯 (Optional) Click an EXTRA ACTION element — copy button, download, "Continue", etc.',
          totalSteps: 4,
          currentStep: 3,
          showSkip: true,
          onSkip: () => {
            // Stop the picker — this rejects its Promise
            this._picker.stop();
          },
          onCancel: () => {
            this.cancel();
          },
        });

        try {
          const element = await this._picker.start();

          // If we get here, user picked an element
          const fingerprint = PC.SelectorEngine.fingerprint(element);
          fingerprint._actionType = this._guessExtraActionType(element);

          this._recipe.elements.extraAction = fingerprint;

          PC.Logger.recordStep({
            step: STEPS.EXTRA_ACTION,
            tagName: element.tagName.toLowerCase(),
            text: PC.Utils.truncate(element.textContent, 30),
            actionType: fingerprint._actionType,
          });

          PC.Messages.send(MSG.RECORDING_STEP, {
            step: STEPS.EXTRA_ACTION,
            completed: true,
          });

          console.log(`[Recorder] ✅ Step 4 complete — recorded extra action (${fingerprint._actionType})`);

        } catch (err) {
          // Picker was cancelled — either skip or escape
          // For step 4 this is fine, we just move on
          // But if the whole wizard was cancelled, re-throw
          if (this._cancelled) {
            resolveStep();
            throw new Error('Recording cancelled');
          }

          console.log('[Recorder] Step 4 skipped');
          PC.Logger.recordStep({ step: STEPS.EXTRA_ACTION, skipped: true });
        }

        resolveStep();
      });
    }


    // ── Save Recipe ──────────────────────────────────────────────

    async _saveRecipe() {
      const recipe = this._recipe;
      const existing = await PC.Storage.recipes.getByDomain(recipe.domain);

      if (existing) {
        const updated = await PC.Storage.recipes.update(existing.id, {
          name: recipe.name,
          elements: recipe.elements,
          settings: recipe.settings,
          siteInfo: recipe.siteInfo,
          lastHealthCheck: PC.Utils.timestamp(),
          healthStatus: 'healthy',
        });
        console.log(`[Recorder] Updated existing recipe for ${recipe.domain} (id: ${existing.id})`);
        return updated;
      } else {
        const saved = await PC.Storage.recipes.add({
          name: recipe.name,
          domain: recipe.domain,
          elements: recipe.elements,
          settings: recipe.settings,
          siteInfo: recipe.siteInfo,
          lastHealthCheck: PC.Utils.timestamp(),
          healthStatus: 'healthy',
        });
        console.log(`[Recorder] Saved new recipe for ${recipe.domain} (id: ${saved.id})`);
        return saved;
      }
    }


    // ── Helpers ───────────────────────────────────────────────────

    _waitForDOMActivity(minMutations) {
      return new Promise((resolve) => {
        let count = 0;

        const observer = new MutationObserver((mutations) => {
          count += mutations.length;
          if (count >= minMutations) {
            observer.disconnect();
            resolve();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 60000);
      });
    }

    _waitForElementToDisappear(fingerprint, timeout = 120000) {
      return new Promise((resolve) => {
        const startTime = Date.now();

        const check = () => {
          const match = PC.SelectorEngine.find(fingerprint);
          if (!match || match.confidence < PC.Constants.CONFIDENCE.MINIMUM) {
            resolve(true);
            return;
          }
          if (Date.now() - startTime > timeout) {
            console.warn('[Recorder] Timed out waiting for element to disappear');
            resolve(false);
            return;
          }
          setTimeout(check, 500);
        };

        setTimeout(check, 1000);
      });
    }

    _guessExtraActionType(element) {
      const text = (element.textContent || '').toLowerCase().trim();
      const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
      const combined = text + ' ' + ariaLabel;

      if (combined.includes('copy') || combined.includes('clipboard')) {
        return PC.Constants.EXTRA_ACTION_TYPES.COPY;
      }
      if (combined.includes('download') || combined.includes('save') || combined.includes('export')) {
        return PC.Constants.EXTRA_ACTION_TYPES.DOWNLOAD;
      }
      return PC.Constants.EXTRA_ACTION_TYPES.CLICK;
    }

    _cleanup() {
      this._active = false;
      this._overlay.removeAll();
      this._recipe = null;
      this._siteConfig = null;

      document.querySelectorAll('.pc-highlight-element').forEach((el) => {
        el.classList.remove('pc-highlight-element');
      });
      document.querySelectorAll('.pc-picked-flash').forEach((el) => {
        el.classList.remove('pc-picked-flash');
      });
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  SINGLETON + PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  const wizard = new SetupWizard();

  root.PC.Recorder = {
    start(name) {
      return wizard.start(name);
    },

    cancel() {
      wizard.cancel();
    },

    get isActive() {
      return wizard.isActive;
    },

    /**
     * Message handlers to be registered by main.js.
     */
    _messageHandlers: {
      [MSG.START_RECORDING]: async (message) => {
        if (wizard.isActive) {
          return { success: false, error: 'Recording already in progress' };
        }

        wizard.start(message.recipeName).then((recipe) => {
          if (recipe) {
            console.log('[Recorder] Recipe saved successfully:', recipe.id);
          }
        }).catch((err) => {
          console.error('[Recorder] Recording failed:', err);
        });

        return { success: true, message: 'Recording started' };
      },

      [MSG.CANCEL_RECORDING]: () => {
        wizard.cancel();
        return { success: true };
      },

      [MSG.GET_RECORDING_STATUS]: () => {
        return { isActive: wizard.isActive };
      },
    },
  };

  console.log('[PC Recorder] ✅ Module loaded');

})();