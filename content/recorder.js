/**
 * content/recorder.js
 * ────────────────────────────────────────────
 * Element Picker + Setup Wizard for recording action recipes.
 *
 * Recording flow (5 steps):
 *   Step 1: User clicks the TEXT INPUT where prompts go
 *   Step 2: User clicks the SEND BUTTON
 *   Step 3: User sends test message, clicks STOP button (or skips)
 *   Step 4: User clicks COMPLETION INDICATOR (element that appears when AI is done)
 *   Step 5: (Optional) User clicks an EXTRA ACTION element
 *
 * Completion detection works by:
 *   - Waiting for the "completion indicator" element to APPEAR or become ENABLED
 *   - This is more reliable than waiting for stop button to disappear
 *
 * Dependencies:
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

    stop() {
      if (!this._active) return;

      this._active = false;
      this._removeHighlight();

      document.removeEventListener('mousemove', this._handleMouseMove, true);
      document.removeEventListener('click', this._handleClick, true);
      document.removeEventListener('keydown', this._handleKeyDown, true);

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

      target.classList.add('pc-picked-flash');
      setTimeout(() => target.classList.remove('pc-picked-flash'), 600);

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
        this.stop();
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

      // ✅ NEW: "Done" / "Message Sent" button
      if (opts.showDone && opts.onDone) {
        const doneBtn = document.createElement('button');
        doneBtn.className = 'pc-banner-btn pc-banner-btn--done';
        doneBtn.textContent = opts.doneLabel || '✔ Message Sent';
        doneBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onDone();
        });
        actions.appendChild(doneBtn);
      }

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
          targetInput: null,       // Step 1: Where to type
          sendTrigger: null,       // Step 2: How to send
          streamingIndicator: null, // Step 3: Stop button (optional)
          completionIndicator: null, // Step 4: Element that appears when done
          extraAction: null,       // Step 5: Optional post-response action
        },
        settings: { ...PC.Constants.DEFAULT_SETTINGS },
      };

      PC.Logger.recordStart({
        domain: pageInfo.hostname,
        url: pageInfo.url,
      });

      PC.Messages.send(MSG.RECORDING_STEP, {
        step: 'started',
        domain: pageInfo.hostname,
      });

      try {
        // Step 1: Record input element
        await this._step1_targetInput();
        this._checkCancelled();

        // Step 2: Record send button
        await this._step2_sendTrigger();
        this._checkCancelled();

        // Step 3: Send test message & record stop button (optional)
        await this._step3_streamingIndicator();
        this._checkCancelled();

        // Step 4: Record completion indicator (required)
        await this._step4_completionIndicator();
        this._checkCancelled();

        // Step 5: Record extra action (optional)
        await this._step5_extraAction();

        // Save the recipe
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
      this._picker.stop();
      this._cleanup();
    }

    _checkCancelled() {
      if (this._cancelled) {
        throw new Error('Recording cancelled');
      }
    }


    // ══════════════════════════════════════════════════════════════
    //  STEP 1: TARGET INPUT
    // ══════════════════════════════════════════════════════════════

    async _step1_targetInput() {
      this._overlay.showBanner({
        stepLabel: '1/5',
        text: '📝 Click on the TEXT INPUT AREA where you type prompts',
        totalSteps: 5,
        currentStep: 0,
        onCancel: () => this.cancel(),
      });

      const element = await this._picker.start();

      const tag = element.tagName.toLowerCase();
      const isEditable = element.getAttribute('contenteditable') === 'true';
      const isInput = ['textarea', 'input'].includes(tag);
      const isTextbox = element.getAttribute('role') === 'textbox';

      if (!isInput && !isEditable && !isTextbox) {
        console.warn(`[Recorder] Selected element may not be a typical input (tag: ${tag}). Recording anyway.`);
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


    // ══════════════════════════════════════════════════════════════
    //  STEP 2: SEND TRIGGER
    // ══════════════════════════════════════════════════════════════

    async _step2_sendTrigger() {
      this._overlay.showBanner({
        stepLabel: '2/5',
        text: '📨 Click on the SEND BUTTON that submits your message',
        totalSteps: 5,
        currentStep: 1,
        onCancel: () => this.cancel(),
      });

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


    // ══════════════════════════════════════════════════════════════
    //  STEP 3: STREAMING INDICATOR (Optional Stop Button)
    // ══════════════════════════════════════════════════════════════
    async _step3_streamingIndicator() {
      // ─── Phase A: Let user send a test message (picker OFF) ───
      const userAction = await this._step3_waitForUserToSend();

      // User skipped or cancelled — exit early
      if (userAction === 'skip') {
        console.log('[Recorder] Step 3 skipped — no streaming indicator');
        PC.Logger.recordStep({ step: 'STREAMING_INDICATOR', skipped: true });
        return;
      }

      if (userAction === 'cancel' || this._cancelled) {
        throw new Error('Recording cancelled');
      }

      // ─── Phase B: Pick the stop/cancel button (picker ON) ───
      await this._step3_pickStopButton();
    }

    /**
     * Phase A: Instructs user to send a test message.
     * Picker is OFF so the user can freely interact with the page.
     * Returns 'done' | 'skip' | 'cancel'.
     */
    _step3_waitForUserToSend() {
      return new Promise((resolve) => {
        this._overlay.showBanner({
          stepLabel: '3/5',
          text: '⏳ Type a SHORT test message and SEND IT. Click "Message Sent" once done.',
          totalSteps: 5,
          currentStep: 2,
          showDone: true,
          doneLabel: '✔ Message Sent',
          onDone: () => resolve('done'),
          showSkip: true,
          onSkip: () => resolve('skip'),
          onCancel: () => {
            resolve('cancel');
            this.cancel();
          },
        });
      });
    }

    /**
     * Phase B: Activates the picker so the user can select the stop button.
     * Also waits for the stop button to disappear after selection.
     */
    async _step3_pickStopButton() {
      this._overlay.showBanner({
        stepLabel: '3/5',
        text: '🛑 Now click the STOP / CANCEL button that appeared while AI is responding (or Skip if none)',
        totalSteps: 5,
        currentStep: 2,
        showSkip: true,
        onSkip: () => {
          this._picker.stop();
        },
        onCancel: () => this.cancel(),
      });

      try {
        const element = await this._picker.start();

        // User picked a stop button — fingerprint it
        const fingerprint = PC.SelectorEngine.fingerprint(element);
        fingerprint._indicatorType = 'streaming';
        fingerprint._signalType = PC.Constants.SIGNAL_TYPES.ELEMENT_DISAPPEARS;

        this._recipe.elements.streamingIndicator = fingerprint;

        PC.Logger.recordStep({
          step: 'STREAMING_INDICATOR',
          tagName: element.tagName.toLowerCase(),
          text: PC.Utils.truncate(element.textContent, 30),
        });

        console.log('[Recorder] ✅ Step 3 complete — recorded stop button');

        // ─── Phase C: Wait for the stop button to disappear ───
         await this._step3_waitForResponseEnd(fingerprint);

  } catch (err) {
    if (this._cancelled) {
      throw new Error('Recording cancelled');
    }
    // Picker cancelled = user clicked "Skip"
    console.log('[Recorder] Step 3 skipped — no streaming indicator');
    PC.Logger.recordStep({ step: 'STREAMING_INDICATOR', skipped: true });
  }

  await PC.Utils.sleep(500);
}

/**
 * Phase C: Races auto-detection (element disappears) against
 * a manual "Response Finished" button. Whichever fires first wins.
 */
_step3_waitForResponseEnd(fingerprint) {
  return new Promise((resolve) => {
    let settled = false;

    const settle = (method) => {
      if (settled) return;
      settled = true;
      console.log(`[Recorder] AI response ended (detected via: ${method})`);
      resolve();
    };

    // ── Show banner with manual override button ──
    this._overlay.showBanner({
      stepLabel: '3/5',
      text: '⏳ Waiting for AI to finish responding…',
      totalSteps: 5,
      currentStep: 2,
      showDone: true,
      doneLabel: '✔ Response Finished',
      onDone: () => settle('manual'),
      onCancel: () => {
        if (!settled) {
          settled = true;
          this.cancel();
          resolve();
        }
      },
    });

    // ── Auto-detection runs in parallel ──
    this._waitForElementToDisappear(fingerprint, 180000).then((disappeared) => {
      if (disappeared) {
        settle('auto-detect');
      } else {
        // Timed out — update banner to nudge the user
        if (!settled) {
          this._overlay.updateBannerText(
            '⚠️ Could not detect response end automatically. Click "Response Finished" when ready.'
          );
        }
      }
    });
  });
}

    // ══════════════════════════════════════════════════════════════
    //  STEP 4: COMPLETION INDICATOR (Required)
    // ══════════════════════════════════════════════════════════════

    async _step4_completionIndicator() {
      this._overlay.showBanner({
        stepLabel: '4/5',
        text: '✅ Now click an element that APPEARED when the AI FINISHED (send button, copy button, thumbs up, etc.)',
        totalSteps: 5,
        currentStep: 3,
        onCancel: () => this.cancel(),
      });

      // Show helpful examples
      this._overlay.showWaiting(
        'Click ANY element that indicates the response is complete:\n' +
        '• The send button (if it came back)\n' +
        '• Copy/Share button\n' +
        '• Thumbs up/down buttons\n' +
        '• "Regenerate" button\n' +
        '• Any element that only appears when done'
      );

      const element = await this._picker.start();

      this._overlay.removeWaiting();

      // Fingerprint the completion indicator
      const fingerprint = PC.SelectorEngine.fingerprint(element);
      fingerprint._indicatorType = 'completion';
      fingerprint._signalType = PC.Constants.SIGNAL_TYPES.ELEMENT_APPEARS;

      // Record additional info about the element's current state
      fingerprint._recordedState = {
        wasDisabled: element.disabled || element.getAttribute('aria-disabled') === 'true',
        wasHidden: window.getComputedStyle(element).display === 'none',
        hadText: (element.textContent || '').trim().slice(0, 50),
        tagName: element.tagName.toLowerCase(),
      };

      this._recipe.elements.completionIndicator = fingerprint;

      // Determine what type of completion signal this is
      const completionType = this._guessCompletionType(element);
      fingerprint._completionType = completionType;

      PC.Logger.recordStep({
        step: 'COMPLETION_INDICATOR',
        tagName: element.tagName.toLowerCase(),
        text: PC.Utils.truncate(element.textContent, 30),
        completionType,
      });

      PC.Messages.send(MSG.RECORDING_STEP, {
        step: 'COMPLETION_INDICATOR',
        completed: true,
        completionType,
      });

      console.log(`[Recorder] ✅ Step 4 complete — recorded completion indicator (${completionType})`);

      // Brief pause
      await PC.Utils.sleep(500);
    }


    // ══════════════════════════════════════════════════════════════
    //  STEP 5: EXTRA ACTION (Optional)
    // ══════════════════════════════════════════════════════════════

    async _step5_extraAction() {
      return new Promise(async (resolveStep) => {
        this._overlay.showBanner({
          stepLabel: '5/5',
          text: '🎯 (Optional) Click an EXTRA ACTION to run after each response — copy, download, continue, etc.',
          totalSteps: 5,
          currentStep: 4,
          showSkip: true,
          onSkip: () => {
            this._picker.stop();
          },
          onCancel: () => {
            this.cancel();
          },
        });

        try {
          const element = await this._picker.start();

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

          console.log(`[Recorder] ✅ Step 5 complete — recorded extra action (${fingerprint._actionType})`);

        } catch (err) {
          if (this._cancelled) {
            resolveStep();
            throw new Error('Recording cancelled');
          }
          console.log('[Recorder] Step 5 skipped');
          PC.Logger.recordStep({ step: STEPS.EXTRA_ACTION, skipped: true });
        }

        resolveStep();
      });
    }


    // ══════════════════════════════════════════════════════════════
    //  SAVE RECIPE
    // ══════════════════════════════════════════════════════════════

    async _saveRecipe() {
      const recipe = this._recipe;
      const existing = await PC.Storage.recipes.getByDomain(recipe.domain);

      // For backwards compatibility, also set completionSignal
      // (older code might look for this)
      recipe.elements.completionSignal = recipe.elements.completionIndicator;

      if (existing) {
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


    // ══════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════

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

          // Also check if element became invisible
          const el = match.element;
          if (el) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              resolve(true);
              return;
            }
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

    _guessCompletionType(element) {
      const text = (element.textContent || '').toLowerCase().trim();
      const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
      const combined = text + ' ' + ariaLabel;
      const tag = element.tagName.toLowerCase();

      // Send button returned
      if (combined.includes('send') || combined.includes('submit')) {
        return 'sendButton';
      }

      // Copy button
      if (combined.includes('copy') || combined.includes('clipboard')) {
        return 'copyButton';
      }

      // Regenerate
      if (combined.includes('regenerate') || combined.includes('retry') || combined.includes('again')) {
        return 'regenerateButton';
      }

      // Thumbs / Feedback
      if (combined.includes('good') || combined.includes('bad') ||
        combined.includes('thumb') || combined.includes('like') || combined.includes('dislike')) {
        return 'feedbackButton';
      }

      // Share
      if (combined.includes('share')) {
        return 'shareButton';
      }

      // Generic button
      if (tag === 'button' || element.getAttribute('role') === 'button') {
        return 'genericButton';
      }

      return 'otherElement';
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
      if (combined.includes('continue') || combined.includes('more') || combined.includes('expand')) {
        return PC.Constants.EXTRA_ACTION_TYPES.CONTINUE;
      }
      return PC.Constants.EXTRA_ACTION_TYPES.CLICK;
    }

    _cleanup() {
      this._active = false;
      this._overlay.removeAll();
      this._recipe = null;

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