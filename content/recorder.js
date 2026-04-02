/**
 * content/recorder.js
 * ────────────────────────────────────────────
 * Element Picker + Setup Wizard for recording action recipes.
 *
 * The recording flow has 4 steps:
 *   Step 1: User clicks the TEXT INPUT where prompts go → record targetInput
 *   Step 2: User clicks the SEND BUTTON → record sendTrigger
 *   Step 3: User sends a test message, waits for stop button to appear,
 *           then clicks it → record completionSignal
 *   Step 4 (optional): User clicks an EXTRA ACTION element → record extraAction
 *
 * Each step uses the ElementPicker (hover highlight + click capture)
 * and stores a multi-strategy fingerprint via PC.SelectorEngine.
 *
 * The recorded recipe is saved to chrome.storage.local via PC.Storage.
 *
 * Dependencies:
 *   - PC.SelectorEngine (content/selectorEngine.js)
 *   - PC.Storage (lib/storage.js)
 *   - PC.Logger (lib/logger.js)
 *   - PC.Messages (lib/messages.js)
 *   - PC.Constants (lib/constants.js)
 *   - PC.Utils (lib/utils.js)
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const MSG = PC.MessageTypes;
  const STEPS = PC.Constants.RECORDING_STEPS;


  // ══════════════════════════════════════════════════════════════════
  //  ELEMENT PICKER
  //  Activates hover-highlight mode. User moves mouse to see elements
  //  highlighted, then clicks to select one.
  // ══════════════════════════════════════════════════════════════════

  class ElementPicker {
    constructor() {
      this._active = false;
      this._currentTarget = null;
      this._onPick = null;     // callback(element)
      this._onCancel = null;   // callback()

      // Bind handlers so we can add/remove them
      this._handleMouseMove = this._handleMouseMove.bind(this);
      this._handleClick = this._handleClick.bind(this);
      this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    /**
     * Start the element picker.
     * @param {function} onPick - called with the picked HTMLElement
     * @param {function} [onCancel] - called if user presses Escape
     * @returns {Promise<HTMLElement>} resolves with picked element
     */
    start(onPick, onCancel) {
      return new Promise((resolve, reject) => {
        this._active = true;
        this._onPick = (element) => {
          this.stop();
          if (onPick) onPick(element);
          resolve(element);
        };
        this._onCancel = () => {
          this.stop();
          if (onCancel) onCancel();
          reject(new Error('Picker cancelled'));
        };

        // Listen on capture phase so we intercept before the page handles it
        document.addEventListener('mousemove', this._handleMouseMove, true);
        document.addEventListener('click', this._handleClick, true);
        document.addEventListener('keydown', this._handleKeyDown, true);
      });
    }

    /**
     * Stop the element picker and clean up.
     */
    stop() {
      this._active = false;
      this._removeHighlight();

      document.removeEventListener('mousemove', this._handleMouseMove, true);
      document.removeEventListener('click', this._handleClick, true);
      document.removeEventListener('keydown', this._handleKeyDown, true);
    }

    _handleMouseMove(e) {
      if (!this._active) return;

      const target = e.target;

      // Don't highlight our own overlay elements
      if (this._isOwnElement(target)) return;

      // Remove highlight from previous target
      this._removeHighlight();

      // Add highlight to new target
      this._currentTarget = target;
      target.classList.add('pc-highlight-element');
    }

    _handleClick(e) {
      if (!this._active) return;

      const target = e.target;

      // Don't capture clicks on our own overlay elements
      if (this._isOwnElement(target)) return;

      // CRITICAL: prevent the actual page click from firing
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Remove hover highlight
      this._removeHighlight();

      // Flash the picked element briefly
      target.classList.add('pc-picked-flash');
      setTimeout(() => target.classList.remove('pc-picked-flash'), 600);

      // Deliver the picked element
      if (this._onPick) this._onPick(target);
    }

    _handleKeyDown(e) {
      if (!this._active) return;

      // Escape cancels the picker
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (this._onCancel) this._onCancel();
      }
    }

    _removeHighlight() {
      if (this._currentTarget) {
        this._currentTarget.classList.remove('pc-highlight-element');
        this._currentTarget = null;
      }
    }

    /**
     * Check if an element belongs to our recording overlay.
     * We don't want to let the user select our own banner/buttons.
     */
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
  //  Manages the instruction banner and waiting indicators
  //  injected into the page during recording.
  // ══════════════════════════════════════════════════════════════════

  class RecordingOverlay {
    constructor() {
      this._banner = null;
      this._waitingOverlay = null;
    }

    /**
     * Show the instruction banner at the top of the page.
     * @param {object} opts
     * @param {string} opts.stepLabel - e.g., "1/4"
     * @param {string} opts.text - instruction text
     * @param {number} opts.totalSteps - total wizard steps
     * @param {number} opts.currentStep - current step (0-based)
     * @param {boolean} [opts.showSkip] - show skip button
     * @param {function} [opts.onSkip] - skip handler
     * @param {function} [opts.onCancel] - cancel handler
     */
    showBanner(opts) {
      this.removeBanner();

      const banner = document.createElement('div');
      banner.className = 'pc-recording-banner';

      // Left side: step + instruction
      const content = document.createElement('div');
      content.className = 'pc-banner-content';

      const step = document.createElement('span');
      step.className = 'pc-banner-step';
      step.textContent = `Step ${opts.stepLabel}`;

      const text = document.createElement('span');
      text.className = 'pc-banner-text';
      text.textContent = opts.text;

      // Progress dots
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

      // Right side: buttons
      const actions = document.createElement('div');
      actions.className = 'pc-banner-actions';

      if (opts.showSkip && opts.onSkip) {
        const skipBtn = document.createElement('button');
        skipBtn.className = 'pc-banner-btn';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', opts.onSkip);
        actions.appendChild(skipBtn);
      }

      if (opts.onCancel) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'pc-banner-btn pc-banner-btn--cancel';
        cancelBtn.textContent = '✕ Cancel';
        cancelBtn.addEventListener('click', opts.onCancel);
        actions.appendChild(cancelBtn);
      }

      banner.appendChild(content);
      banner.appendChild(actions);

      document.body.appendChild(banner);
      this._banner = banner;
    }

    /**
     * Remove the instruction banner.
     */
    removeBanner() {
      if (this._banner) {
        this._banner.remove();
        this._banner = null;
      }
    }

    /**
     * Show a waiting indicator at the bottom of the page.
     * Used during Step 3 when we need the user to send a
     * test message and wait for the stop button to appear.
     */
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

    /**
     * Remove the waiting indicator.
     */
    removeWaiting() {
      if (this._waitingOverlay) {
        this._waitingOverlay.remove();
        this._waitingOverlay = null;
      }
    }

    /**
     * Remove all overlay elements.
     */
    removeAll() {
      this.removeBanner();
      this.removeWaiting();
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  SETUP WIZARD
  //  Orchestrates the 4-step recording flow.
  // ══════════════════════════════════════════════════════════════════

  class SetupWizard {
    constructor() {
      this._picker = new ElementPicker();
      this._overlay = new RecordingOverlay();
      this._active = false;
      this._recipe = null;  // being built during recording
    }

    get isActive() {
      return this._active;
    }

    /**
     * Start the recording wizard.
     * @param {string} [recipeName] - optional name for the recipe
     * @returns {Promise<object>} the completed recipe, or null if cancelled
     */
    async start(recipeName) {
      if (this._active) {
        console.warn('[Recorder] A recording session is already active');
        return null;
      }

      this._active = true;

      // Initialize recipe skeleton
      const pageInfo = PC.Content.getPageInfo();
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
      };

      PC.Logger.recordStart({
        domain: pageInfo.hostname,
        url: pageInfo.url,
      });

      // Notify popup/background that recording has started
      PC.Messages.send(MSG.RECORDING_STEP, {
        step: 'started',
        domain: pageInfo.hostname,
      });

      try {
        // ── STEP 1: Target Input ──────────────────────
        await this._step1_targetInput();

        // ── STEP 2: Send Trigger ──────────────────────
        await this._step2_sendTrigger();

        // ── STEP 3: Completion Signal ─────────────────
        await this._step3_completionSignal();

        // ── STEP 4: Extra Action (optional) ───────────
        await this._step4_extraAction();

        // ── Save the recipe ───────────────────────────
        const saved = await this._saveRecipe();

        PC.Logger.recordComplete({
          recipeId: saved.id,
          domain: saved.domain,
        });

        PC.Messages.send(MSG.RECORDING_COMPLETE, {
          recipe: saved,
        });

        return saved;

      } catch (err) {
        // Recording was cancelled or errored
        if (err.message === 'Recording cancelled') {
          PC.Logger.recordCancel({ reason: 'user' });
          PC.Messages.send(MSG.RECORDING_CANCELLED, { reason: 'user' });
        } else {
          PC.Logger.error({
            error: err.message,
            context: 'recording',
          });
          PC.Messages.send(MSG.RECORDING_CANCELLED, { reason: err.message });
        }
        return null;

      } finally {
        this._cleanup();
      }
    }

    /**
     * Cancel the current recording session.
     */
    cancel() {
      if (!this._active) return;
      this._picker.stop();
      this._cleanup();
      // The start() promise will be rejected by the picker cancellation
    }


    // ── Step 1: Record Target Input ───────────────────────────────

    async _step1_targetInput() {
      this._overlay.showBanner({
        stepLabel: '1/4',
        text: '📝 Click on the TEXT INPUT AREA where you type prompts',
        totalSteps: 4,
        currentStep: 0,
        onCancel: () => this._cancelFromUI(),
      });

      const element = await this._picker.start(null, () => this._cancelFromUI());

      // Validate: should be an input-like element
      const tag = element.tagName.toLowerCase();
      const isEditable = element.getAttribute('contenteditable') === 'true';
      const isInput = ['textarea', 'input'].includes(tag);
      const isTextbox = element.getAttribute('role') === 'textbox';

      if (!isInput && !isEditable && !isTextbox) {
        console.warn(
          '[Recorder] Selected element is not a typical input. ' +
          `Tag: ${tag}, contentEditable: ${isEditable}. Recording anyway.`
        );
      }

      // Generate and store fingerprint
      const fingerprint = PC.SelectorEngine.fingerprint(element);

      // Add input-specific metadata
      fingerprint._inputType = isEditable ? 'contenteditable' :
                               tag === 'textarea' ? 'textarea' :
                               tag === 'input' ? 'input' : 'unknown';

      this._recipe.elements.targetInput = fingerprint;

      PC.Logger.recordStep({
        step: STEPS.TARGET_INPUT,
        tagName: tag,
        inputType: fingerprint._inputType,
        confidence: 'recorded',
      });

      PC.Messages.send(MSG.RECORDING_STEP, {
        step: STEPS.TARGET_INPUT,
        completed: true,
      });

      console.log(`[Recorder] ✅ Step 1 complete — recorded ${tag} input`);
    }


    // ── Step 2: Record Send Trigger ───────────────────────────────

    async _step2_sendTrigger() {
      this._overlay.showBanner({
        stepLabel: '2/4',
        text: '📨 Click on the SEND BUTTON that submits your message',
        totalSteps: 4,
        currentStep: 1,
        onCancel: () => this._cancelFromUI(),
      });

      const element = await this._picker.start(null, () => this._cancelFromUI());

      const fingerprint = PC.SelectorEngine.fingerprint(element);

      // Store the send trigger type (click-based)
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

      console.log(`[Recorder] ✅ Step 2 complete — recorded send button`);
    }


    // ── Step 3: Record Completion Signal ──────────────────────────
    // This is the most complex step:
    //   1. Tell user to send a test message manually.
    //   2. Wait for a "stop" button to appear (AI started generating).
    //   3. User clicks the stop button to identify it.
    //   4. We record: "watch for this element to DISAPPEAR" = response done.

    async _step3_completionSignal() {
      // Phase A: Tell user to send a test message
      this._overlay.showBanner({
        stepLabel: '3/4',
        text: '⏳ Type a SHORT test message and SEND IT manually. ' +
              'Once the AI starts responding, a stop/cancel button should appear...',
        totalSteps: 4,
        currentStep: 2,
        onCancel: () => this._cancelFromUI(),
      });

      this._overlay.showWaiting(
        'Waiting for you to send a message... ' +
        'When a Stop/Cancel button appears, the banner will update.'
      );

      // Phase B: Watch for any new clickable element to appear
      // (the stop button should appear during AI generation).
      // We don't know what it looks like yet — we wait for the user
      // to send a message and then prompt them to click the stop button.

      // Give user time to type and send (wait for some DOM activity)
      await this._waitForDOMActivity(5);

      // Phase C: Now prompt user to click the stop button
      this._overlay.removeWaiting();
      this._overlay.showBanner({
        stepLabel: '3/4',
        text: '🛑 Great! Now CLICK on the STOP / CANCEL button that appeared while the AI is responding',
        totalSteps: 4,
        currentStep: 2,
        onCancel: () => this._cancelFromUI(),
      });

      const element = await this._picker.start(null, () => this._cancelFromUI());

      const fingerprint = PC.SelectorEngine.fingerprint(element);

      // Mark this as "watch for disappearance" signal type
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

      console.log(`[Recorder] ✅ Step 3 complete — recorded stop/cancel button`);

      // Wait for the AI to finish responding before moving to step 4
      // (so the page is back to idle state)
      this._overlay.showWaiting('Waiting for AI to finish responding...');
      await this._waitForElementToDisappear(fingerprint, 120000);
      this._overlay.removeWaiting();

      // Brief pause to let page settle
      await PC.Utils.sleep(1500);
    }


    // ── Step 4: Record Extra Action (Optional) ────────────────────

    async _step4_extraAction() {
      this._overlay.showBanner({
        stepLabel: '4/4',
        text: '🎯 (Optional) Click on an EXTRA ACTION element — e.g., a copy button, download button, or "Continue" button',
        totalSteps: 4,
        currentStep: 3,
        showSkip: true,
        onSkip: () => {
          // Skip will cause the picker to be stopped and we move on
          this._picker.stop();
          this._step4Skipped = true;
        },
        onCancel: () => this._cancelFromUI(),
      });

      this._step4Skipped = false;

      try {
        const element = await this._picker.start(null, () => {
          // If picker is cancelled (Escape or skip), we just skip step 4
          this._step4Skipped = true;
        });

        if (this._step4Skipped) {
          console.log('[Recorder] Step 4 skipped by user');
          PC.Logger.recordStep({ step: STEPS.EXTRA_ACTION, skipped: true });
          return;
        }

        const fingerprint = PC.SelectorEngine.fingerprint(element);

        // Determine extra action type based on element
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

      } catch {
        // Picker was cancelled / skipped — that's fine for step 4
        console.log('[Recorder] Step 4 skipped');
        PC.Logger.recordStep({ step: STEPS.EXTRA_ACTION, skipped: true });
      }
    }


    // ── Save Recipe ───────────────────────────────────────────────

    async _saveRecipe() {
      const recipe = this._recipe;

      // Check if a recipe already exists for this domain
      const existing = await PC.Storage.recipes.getByDomain(recipe.domain);

      if (existing) {
        // Update existing recipe with new recordings
        const updated = await PC.Storage.recipes.update(existing.id, {
          name: recipe.name,
          elements: recipe.elements,
          settings: recipe.settings,
          lastHealthCheck: PC.Utils.timestamp(),
          healthStatus: 'healthy',
        });
        console.log(`[Recorder] Updated existing recipe for ${recipe.domain} (id: ${existing.id})`);
        return updated;
      } else {
        // Create new recipe
        const saved = await PC.Storage.recipes.add({
          name: recipe.name,
          domain: recipe.domain,
          elements: recipe.elements,
          settings: recipe.settings,
          lastHealthCheck: PC.Utils.timestamp(),
          healthStatus: 'healthy',
        });
        console.log(`[Recorder] Saved new recipe for ${recipe.domain} (id: ${saved.id})`);
        return saved;
      }
    }


    // ── Helpers ────────────────────────────────────────────────────

    /**
     * Wait for meaningful DOM activity (user interacting with the page).
     * We count mutations and resolve after seeing enough.
     * @param {number} minMutations - minimum mutations to wait for
     */
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

        // Don't wait forever — resolve after 60 seconds regardless
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 60000);
      });
    }

    /**
     * Wait for a recorded element to disappear from the page.
     * Used after step 3 to wait for the AI to finish responding.
     * @param {object} fingerprint
     * @param {number} timeout
     */
    _waitForElementToDisappear(fingerprint, timeout = 120000) {
      return new Promise((resolve) => {
        const startTime = Date.now();

        const check = () => {
          const match = PC.SelectorEngine.find(fingerprint);
          // Element is gone (or hidden)
          if (!match || match.confidence < PC.Constants.CONFIDENCE.MINIMUM) {
            resolve(true);
            return;
          }

          // Timeout
          if (Date.now() - startTime > timeout) {
            console.warn('[Recorder] Timed out waiting for element to disappear');
            resolve(false);
            return;
          }

          setTimeout(check, 500);
        };

        // Start checking after a brief delay
        setTimeout(check, 1000);
      });
    }

    /**
     * Guess the type of extra action based on the element's properties.
     */
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
      // Default to click
      return PC.Constants.EXTRA_ACTION_TYPES.CLICK;
    }

    /**
     * Handle cancel from the UI (banner cancel button).
     */
    _cancelFromUI() {
      this._picker.stop();
      this._cleanup();
      throw new Error('Recording cancelled');
    }

    /**
     * Clean up all overlays and state.
     */
    _cleanup() {
      this._active = false;
      this._picker.stop();
      this._overlay.removeAll();
      this._recipe = null;

      // Remove any leftover highlight classes
      document.querySelectorAll('.pc-highlight-element').forEach((el) => {
        el.classList.remove('pc-highlight-element');
      });
      document.querySelectorAll('.pc-picked-flash').forEach((el) => {
        el.classList.remove('pc-picked-flash');
      });
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  SINGLETON INSTANCE + MESSAGE HANDLERS
  // ══════════════════════════════════════════════════════════════════

  const wizard = new SetupWizard();

  // Expose for other content modules
  root.PC.Recorder = {
    /**
     * Start the recording wizard.
     * @param {string} [name] - optional recipe name
     * @returns {Promise<object|null>} saved recipe or null if cancelled
     */
    start(name) {
      return wizard.start(name);
    },

    /**
     * Cancel the current recording session.
     */
    cancel() {
      wizard.cancel();
    },

    /**
     * Check if recording is currently active.
     */
    get isActive() {
      return wizard.isActive;
    },
  };


  // ── Register message handlers ───────────────────────────────────

  PC.Content.registerHandlers({

    [MSG.START_RECORDING]: async (message) => {
      if (wizard.isActive) {
        return { success: false, error: 'Recording already in progress' };
      }

      // Start recording (async — runs the full wizard)
      // Don't await here; let it run in the background.
      // Status updates are sent via PC.Messages during the wizard.
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
      return {
        isActive: wizard.isActive,
      };
    },
  });

  console.log('[PC Recorder] ✅ Module loaded');

})();