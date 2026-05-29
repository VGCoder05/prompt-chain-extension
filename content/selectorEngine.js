/**
 * content/selectorEngine.js
 * ────────────────────────────────────────────
 * Two core capabilities:
 *
 * 1. FINGERPRINTING — Generate a rich, multi-strategy fingerprint
 *    for any DOM element the user clicks during recording.
 *
 * 2. RE-FINDING — Given a stored fingerprint, locate the element
 *    on the current page using all strategies with confidence scoring.
 *
 * This module is the foundation for both the Recorder (Phase 3)
 * and the Replayer (Phase 4). It has no dependencies on other
 * content scripts — only on lib/constants.js and lib/utils.js.
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  // ══════════════════════════════════════════════════════════════════
  //  PART 1: FINGERPRINT GENERATOR
  //  Takes a DOM element → produces a serializable fingerprint object
  // ══════════════════════════════════════════════════════════════════

  const FingerprintGenerator = {

    /**
     * Generate a full fingerprint for a DOM element.
     * This is the main entry point called by the Recorder
     * when the user clicks an element during the setup wizard.
     *
     * @param {HTMLElement} element
     * @returns {object} serializable fingerprint with all 6 strategies
     */
    generate(element) {
      if (!element || !(element instanceof HTMLElement)) {
        throw new Error('Cannot fingerprint: not a valid HTML element');
      }

      return {
        // Strategy 1: CSS selector path from root to element
        cssPath: this.getCSSPath(element),

        // Strategy 2: Element attributes (id, classes, aria-*, data-*, etc.)
        attributes: this.getAttributes(element),

        // Strategy 3: XPath from document root
        xpath: this.getXPath(element),

        // Strategy 4: Text/content clues (useful for buttons)
        textClues: this.getTextClues(element),

        // Strategy 5: DOM tree position (parent, siblings)
        domPosition: this.getDOMPosition(element),

        // Strategy 6: Computed best single selector
        //   (the most reliable one-liner we can construct)
        bestSelector: this.getBestSelector(element),

        // Metadata
        meta: {
          tagName: element.tagName.toLowerCase(),
          recordedAt: PC.Utils.timestamp(),
          recordedOnURL: window.location.hostname,
          recordedOnPath: window.location.pathname,
        },
      };
    },

    // ── Strategy 1: CSS Path ──────────────────────────────────────

    getCSSPath(element) {
      const parts = [];
      let current = element;

      while (current && current !== document.body && current !== document.documentElement) {
        let selector = current.tagName.toLowerCase();

        if (current.id && this._isStableId(current.id)) {
          selector = `#${CSS.escape(current.id)}`;
          parts.unshift(selector);
          break;
        }

        const meaningful = this._getMeaningfulClasses(current);
        if (meaningful.length > 0) {
          selector += '.' + meaningful.slice(0, 3).map(c => CSS.escape(c)).join('.');
        }

        const siblings = current.parentElement
          ? [...current.parentElement.children].filter(
              (s) => s.tagName === current.tagName
            )
          : [];

        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }

        parts.unshift(selector);
        current = current.parentElement;
      }

      return parts.join(' > ');
    },

    // ── Strategy 2: Attributes ────────────────────────────────────

    getAttributes(element) {
      return {
        id:               element.id || null,
        classes:          [...element.classList],
        tagName:          element.tagName.toLowerCase(),
        type:             element.getAttribute('type'),
        role:             element.getAttribute('role'),
        ariaLabel:        element.getAttribute('aria-label'),
        ariaDescription:  element.getAttribute('aria-description'),
        placeholder:      element.getAttribute('placeholder'),
        contentEditable:  element.getAttribute('contenteditable'),
        name:             element.getAttribute('name'),
        title:            element.getAttribute('title'),
        dataAttributes:   this._getDataAttributes(element),
        disabled:         element.disabled || false,
      };
    },

    // ── Strategy 3: XPath ─────────────────────────────────────────

    getXPath(element) {
      const parts = [];
      let current = element;

      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        let sibling = current.previousElementSibling;

        while (sibling) {
          if (sibling.tagName === current.tagName) index++;
          sibling = sibling.previousElementSibling;
        }

        const tag = current.tagName.toLowerCase();
        parts.unshift(`${tag}[${index}]`);
        current = current.parentElement;
      }

      return '/' + parts.join('/');
    },

    // ── Strategy 4: Text Clues ────────────────────────────────────

    getTextClues(element) {
      return {
        textContent:  PC.Utils.truncate((element.textContent || '').trim(), 80),
        innerText:    PC.Utils.truncate((element.innerText || '').trim(), 80),
        value:        element.value ? PC.Utils.truncate(element.value, 80) : null,
      };
    },

    // ── Strategy 5: DOM Position ──────────────────────────────────

    getDOMPosition(element) {
      const parent = element.parentElement;
      let siblingIndex = 0;
      let sameSiblingIndex = 0;

      if (parent) {
        const children = [...parent.children];
        siblingIndex = children.indexOf(element);
        const sameTag = children.filter((c) => c.tagName === element.tagName);
        sameSiblingIndex = sameTag.indexOf(element);
      }

      return {
        parentTagName:    parent ? parent.tagName.toLowerCase() : null,
        parentId:         parent?.id || null,
        parentClasses:    parent ? [...parent.classList].slice(0, 5) : [],
        siblingIndex,
        sameSiblingIndex,
        totalSiblings:    parent ? parent.children.length : 0,
        totalSameSiblings: parent
          ? [...parent.children].filter((c) => c.tagName === element.tagName).length
          : 0,
        depth:            this._getDepth(element),
      };
    },

    // ── Strategy 6: Best Single Selector ──────────────────────────

    getBestSelector(element) {
      if (element.id && this._isStableId(element.id)) {
        return `#${CSS.escape(element.id)}`;
      }

      const tag = element.tagName.toLowerCase();

      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) {
        const candidate = `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
        if (this._isUnique(candidate)) return candidate;
      }

      const testId =
        element.getAttribute('data-testid') ||
        element.getAttribute('data-test') ||
        element.getAttribute('data-cy');
      if (testId) {
        const attrName = element.hasAttribute('data-testid')
          ? 'data-testid'
          : element.hasAttribute('data-test')
          ? 'data-test'
          : 'data-cy';
        const candidate = `${tag}[${attrName}="${CSS.escape(testId)}"]`;
        if (this._isUnique(candidate)) return candidate;
      }

      // Check for data-mat-icon-name (Material icons)
      const matIconName = element.getAttribute('data-mat-icon-name');
      if (matIconName) {
        const candidate = `${tag}[data-mat-icon-name="${CSS.escape(matIconName)}"]`;
        if (this._isUnique(candidate)) return candidate;
      }

      const placeholder = element.getAttribute('placeholder');
      if (placeholder) {
        const candidate = `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
        if (this._isUnique(candidate)) return candidate;
      }

      const role = element.getAttribute('role');
      const meaningful = this._getMeaningfulClasses(element);
      if (role && meaningful.length > 0) {
        const candidate = `${tag}[role="${role}"].${CSS.escape(meaningful[0])}`;
        if (this._isUnique(candidate)) return candidate;
      }

      if (element.getAttribute('contenteditable') === 'true') {
        const candidate = `${tag}[contenteditable="true"]`;
        const matches = document.querySelectorAll(candidate);
        if (matches.length === 1) return candidate;
        if (meaningful.length > 0) {
          const refined = `${candidate}.${CSS.escape(meaningful[0])}`;
          if (this._isUnique(refined)) return refined;
        }
      }

      return this.getCSSPath(element);
    },


    // ── Private Helpers ───────────────────────────────────────────

    _isStableId(id) {
      if (!id) return false;

      const unstablePatterns = [
        /^:r\d+:$/,
        /^[a-f0-9]{8,}$/i,
        /^[a-z]{1,3}-[a-f0-9]+/i,
        /^\d+$/,
        /^ember\d+/,
        /^__next/,
      ];

      return !unstablePatterns.some((pattern) => pattern.test(id));
    },

    _getMeaningfulClasses(element) {
      return [...element.classList].filter((cls) => {
        if (!cls || cls.length < 2) return false;

        const hashPatterns = [
          /^css-/,
          /^sc-[a-zA-Z]/,
          /^_[a-zA-Z0-9]{5,}$/,
          /^[a-z]{5,8}$/,
          /^[A-Z][a-z]{4,}[A-Z]/,
          /^jsx-[a-f0-9]+/,
          /^svelte-[a-z0-9]+/,
          /^ng-tns-c\d+-\d+$/,
          /^ng-star-inserted$/,
          /^ng-trigger/,
        ];

        return !hashPatterns.some((pattern) => pattern.test(cls));
      });
    },

    _getDataAttributes(element) {
      const data = {};
      for (const attr of element.attributes) {
        if (attr.name.startsWith('data-')) {
          data[attr.name] = attr.value;
        }
      }
      return data;
    },

    _getDepth(element) {
      let depth = 0;
      let current = element;
      while (current && current !== document.documentElement) {
        depth++;
        current = current.parentElement;
      }
      return depth;
    },

    _isUnique(selector) {
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    },
  };


  // ══════════════════════════════════════════════════════════════════
  //  PART 2: ELEMENT RE-FINDER
  //  Takes a stored fingerprint → finds the matching element on page
  //  Returns the best match with a confidence score
  // ══════════════════════════════════════════════════════════════════

  const ElementReFinder = {

    /**
     * Find an element on the current page matching a stored fingerprint.
     * Tries all strategies, scores each candidate, returns the best.
     *
     * @param {object} fingerprint - Previously generated fingerprint
     * @returns {object|null} { element, confidence, method } or null
     */
    find(fingerprint) {
      if (!fingerprint) return null;

      const elementType = this._detectElementType(fingerprint);

      console.log('[SelectorEngine] 🔍 Attempting to find element:', {
        type: elementType,
        tagName: fingerprint.meta?.tagName,
        dataAttrs: fingerprint.attributes?.dataAttributes,
        classes: fingerprint.attributes?.classes?.filter(c => !c.startsWith('ng-')).slice(0, 5),
      });

      const candidates = [];

      // Core strategies
      this._tryBestSelector(fingerprint, candidates);
      this._tryId(fingerprint, candidates);
      this._tryCSSPath(fingerprint, candidates);
      this._tryXPath(fingerprint, candidates);
      this._tryAttributes(fingerprint, candidates);
      this._tryTextClues(fingerprint, candidates);
      this._trySemanticMatch(fingerprint, candidates);
      this._tryDataAttributes(fingerprint, candidates);

      // Specialized fallbacks based on element type
      if (elementType === 'input' || elementType === 'unknown') {
        this._tryRichEditorFallback(fingerprint, candidates);
      }

      if (elementType === 'sendButton') {
        this._trySendButtonFallback(fingerprint, candidates);
      }

      if (elementType === 'completionIndicator') {
        this._tryCompletionIndicatorFallback(fingerprint, candidates);
      }

      if (elementType === 'streamingIndicator') {
        this._tryStreamingIndicatorFallback(fingerprint, candidates);
      }

      // Deduplicate
      const deduped = this._deduplicateCandidates(candidates);

      if (deduped.length === 0) {
        console.warn('[SelectorEngine] ❌ No candidates found for fingerprint');
        return null;
      }

      deduped.sort((a, b) => b.confidence - a.confidence);

      console.log(
        `[SelectorEngine] Re-find: ${deduped.length} candidate(s) —`,
        deduped.map((c) => `${c.method}(${c.confidence.toFixed(2)})`).join(', ')
      );

      return deduped[0];
    },

    /**
     * Detect what type of element we're trying to find.
     */
    _detectElementType(fp) {
      const dataAttrs = fp.attributes?.dataAttributes || {};
      const classes = fp.attributes?.classes || [];
      const parentClasses = fp.domPosition?.parentClasses || [];
      const tagName = fp.meta?.tagName || fp.attributes?.tagName;

      // Check for send button
      if (
        dataAttrs['data-mat-icon-name'] === 'send' ||
        classes.some(c => c.includes('send-button')) ||
        parentClasses.some(c => c.includes('send-button'))
      ) {
        return 'sendButton';
      }

      // Check for stop/streaming indicator
      if (
        dataAttrs['data-mat-icon-name'] === 'stop' ||
        classes.some(c => c.includes('stop'))
      ) {
        return 'streamingIndicator';
      }

      // Check for completion indicator (mic button)
      if (
        dataAttrs['data-mat-icon-name'] === 'mic' ||
        classes.some(c => c.includes('mic') || c.includes('speech') || c.includes('dictation')) ||
        parentClasses.some(c => c.includes('mic') || c.includes('speech'))
      ) {
        return 'completionIndicator';
      }

      // Check for input/editor
      if (
        fp.attributes?.contentEditable === 'true' ||
        tagName === 'textarea' ||
        tagName === 'input' ||
        parentClasses.some(c => c.includes('ql-editor') || c.includes('editor')) ||
        classes.some(c => c.includes('ql-') || c.includes('editor'))
      ) {
        return 'input';
      }

      if (tagName === 'button' || fp.attributes?.role === 'button') {
        return 'button';
      }

      return 'unknown';
    },

    /**
     * Find an element, waiting for it to appear if not immediately present.
     */
    findWithWait(fingerprint, timeout = 10000) {
      return new Promise((resolve) => {
        const immediate = this.find(fingerprint);
        if (immediate && immediate.confidence >= PC.Constants.CONFIDENCE.MINIMUM) {
          resolve(immediate);
          return;
        }

        let resolved = false;

        const observer = new MutationObserver(() => {
          if (resolved) return;

          const match = this.find(fingerprint);
          if (match && match.confidence >= PC.Constants.CONFIDENCE.MINIMUM) {
            resolved = true;
            observer.disconnect();
            resolve(match);
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'aria-disabled', 'disabled', 'style'],
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            const last = this.find(fingerprint);
            resolve(last && last.confidence >= PC.Constants.CONFIDENCE.MINIMUM ? last : null);
          }
        }, timeout);
      });
    },


    // ══════════════════════════════════════════════════════════════
    //  Individual Strategy Implementations
    // ══════════════════════════════════════════════════════════════

    _tryBestSelector(fp, candidates) {
      if (!fp.bestSelector) return;
      try {
        let el = document.querySelector(fp.bestSelector);

        if (!el) {
          const cleaned = this._stripDynamicClasses(fp.bestSelector);
          if (cleaned && cleaned !== fp.bestSelector) {
            try {
              el = document.querySelector(cleaned);
            } catch { /* invalid */ }
          }
        }

        if (el && this._isVisible(el)) {
          let confidence = 0.90;
          if (fp.bestSelector.startsWith('#')) confidence = 0.98;
          if (fp.bestSelector.includes('aria-label')) confidence = 0.92;
          if (fp.bestSelector.includes('data-testid')) confidence = 0.95;
          if (fp.bestSelector.includes('data-mat-icon-name')) confidence = 0.93;

          candidates.push({ element: el, confidence, method: 'bestSelector' });
        }
      } catch { /* invalid selector */ }
    },

    _tryId(fp, candidates) {
      const id = fp.attributes?.id;
      if (!id) return;

      const el = document.getElementById(id);
      if (el && this._isVisible(el)) {
        candidates.push({ element: el, confidence: 0.99, method: 'id' });
      }
    },

    _tryCSSPath(fp, candidates) {
      if (!fp.cssPath) return;
      try {
        let el = document.querySelector(fp.cssPath);

        if (!el) {
          const cleaned = this._stripDynamicClasses(fp.cssPath);
          if (cleaned && cleaned !== fp.cssPath) {
            try {
              el = document.querySelector(cleaned);
            } catch { /* invalid */ }
          }
        }

        if (el && this._isVisible(el)) {
          candidates.push({ element: el, confidence: 0.85, method: 'cssPath' });
        }
      } catch { /* invalid */ }
    },

    _tryXPath(fp, candidates) {
      if (!fp.xpath) return;
      try {
        const result = document.evaluate(
          fp.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        const el = result.singleNodeValue;

        if (el && el instanceof HTMLElement && this._isVisible(el)) {
          candidates.push({ element: el, confidence: 0.82, method: 'xpath' });
        }
      } catch (e) {
        console.error('[SelectorEngine] XPath error:', e.message);
      }
    },

    _tryAttributes(fp, candidates) {
      if (!fp.attributes) return;
      const attrs = fp.attributes;
      const tag = attrs.tagName;
      if (!tag) return;

      let query = tag;
      if (attrs.role) query += `[role="${CSS.escape(attrs.role)}"]`;
      if (attrs.type) query += `[type="${CSS.escape(attrs.type)}"]`;
      if (attrs.name) query += `[name="${CSS.escape(attrs.name)}"]`;

      let elements;
      try {
        elements = document.querySelectorAll(query);
      } catch {
        return;
      }

      for (const el of elements) {
        if (!this._isVisible(el)) continue;

        const score = this._attributeSimilarity(el, attrs);
        if (score > 0.4) {
          candidates.push({
            element: el,
            confidence: Math.min(score, 0.90),
            method: 'attributes',
          });
        }
      }
    },

    _tryTextClues(fp, candidates) {
      if (!fp.textClues) return;
      const clues = fp.textClues;
      const tag = fp.meta?.tagName || fp.attributes?.tagName;
      if (!tag || !clues.textContent) return;
      if (clues.textContent.length > 50) return;

      const elements = document.querySelectorAll(tag);
      for (const el of elements) {
        if (!this._isVisible(el)) continue;

        const elText = (el.textContent || '').trim();
        if (!elText) continue;

        if (elText === clues.textContent) {
          candidates.push({ element: el, confidence: 0.85, method: 'textExact' });
          continue;
        }

        if (elText.includes(clues.textContent) || clues.textContent.includes(elText)) {
          candidates.push({ element: el, confidence: 0.65, method: 'textFuzzy' });
        }
      }
    },

    _trySemanticMatch(fp, candidates) {
      if (!fp.attributes) return;
      const attrs = fp.attributes;

      if (attrs.ariaLabel) {
        try {
          const selector = `[aria-label="${CSS.escape(attrs.ariaLabel)}"]`;
          const els = document.querySelectorAll(selector);
          for (const el of els) {
            if (!this._isVisible(el)) continue;
            const tagMatch = el.tagName.toLowerCase() === attrs.tagName;
            candidates.push({
              element: el,
              confidence: tagMatch ? 0.90 : 0.78,
              method: 'ariaLabel',
            });
          }
        } catch { /* invalid */ }
      }

      if (attrs.placeholder) {
        try {
          const selector = `${attrs.tagName}[placeholder="${CSS.escape(attrs.placeholder)}"]`;
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            candidates.push({ element: el, confidence: 0.87, method: 'placeholder' });
          }
        } catch { /* invalid */ }
      }

      if (attrs.contentEditable === 'true') {
        const editables = document.querySelectorAll('[contenteditable="true"]');
        for (const el of editables) {
          if (!this._isVisible(el)) continue;
          const score = this._attributeSimilarity(el, attrs);
          if (score > 0.3) {
            candidates.push({
              element: el,
              confidence: Math.min(0.55 + score * 0.3, 0.85),
              method: 'contentEditable',
            });
          }
        }
      }
    },

    /**
     * Strategy 8: Try matching by data-* attributes (Material icons)
     */
    _tryDataAttributes(fp, candidates) {
      const dataAttrs = fp.attributes?.dataAttributes || {};
      const dataKeys = Object.keys(dataAttrs);

      if (dataKeys.length === 0) return;

      // Prioritize data-mat-icon-name as it's very stable
      const matIconName = dataAttrs['data-mat-icon-name'];
      if (matIconName) {
        try {
          const selector = `[data-mat-icon-name="${CSS.escape(matIconName)}"]`;
          const els = document.querySelectorAll(selector);

          for (const el of els) {
            if (!this._isVisible(el)) continue;

            const tagMatch = el.tagName.toLowerCase() === fp.attributes?.tagName;

            console.log(`[SelectorEngine] Found mat-icon with name="${matIconName}", visible: true`);

            candidates.push({
              element: el,
              confidence: tagMatch ? 0.92 : 0.85,
              method: 'dataMatIconName',
            });
          }
        } catch { /* invalid selector */ }
      }

      // Try other data attributes
      for (const key of dataKeys) {
        if (key === 'data-mat-icon-name') continue; // Already handled
        const value = dataAttrs[key];
        if (!value) continue;

        try {
          const selector = `[${key}="${CSS.escape(value)}"]`;
          const els = document.querySelectorAll(selector);

          for (const el of els) {
            if (!this._isVisible(el)) continue;

            const tagMatch = el.tagName.toLowerCase() === fp.attributes?.tagName;

            candidates.push({
              element: el,
              confidence: tagMatch ? 0.85 : 0.72,
              method: 'dataAttribute',
            });
          }
        } catch { /* invalid selector */ }
      }
    },

    /**
     * Strategy 9: Rich text editor fallback
     */
    _tryRichEditorFallback(fp, candidates) {
      const parentClasses = fp.domPosition?.parentClasses || [];
      const allClasses = fp.attributes?.classes || [];
      const tagName = fp.meta?.tagName || fp.attributes?.tagName;

      const editorIndicators = [
        'ql-editor', 'ql-container', 'ql-blank', 'ql-bubble',
        'ProseMirror', 'tiptap', 'textarea', 'text-input',
        'rich-textarea', 'contenteditable'
      ];

      const isLikelyEditor =
        parentClasses.some(c => editorIndicators.some(ind => c.includes(ind))) ||
        allClasses.some(c => editorIndicators.some(ind => c.includes(ind))) ||
        tagName === 'p' ||
        tagName === 'div';

      if (!isLikelyEditor) return;

      console.log('[SelectorEngine] Trying rich editor fallback...');

      const quillSelectors = [
        '.ql-editor[contenteditable="true"]',
        'rich-textarea .ql-editor',
        '[contenteditable="true"].ql-editor',
        'div.ql-editor.textarea',
        '.ql-editor',
      ];

      for (const selector of quillSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            console.log(`[SelectorEngine] ✅ Found Quill editor: ${selector}`);
            candidates.push({
              element: el,
              confidence: 0.75,
              method: 'richEditorFallback',
            });
            return;
          }
        } catch { /* invalid */ }
      }

      const editables = document.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (!this._isVisible(el)) continue;

        const isMainInput = el.closest(
          'input-area-v2, input-area, .input-area, .chat-input, ' +
          'input-container, .input-container, .composer'
        );

        if (isMainInput) {
          console.log('[SelectorEngine] ✅ Found contenteditable in input area');
          candidates.push({
            element: el,
            confidence: 0.70,
            method: 'contenteditableFallback',
          });
          return;
        }
      }
    },

    /**
     * Strategy 10: Send button fallback
     */
    _trySendButtonFallback(fp, candidates) {
      console.log('[SelectorEngine] Trying send button fallback...');

      // Method 1: data-mat-icon-name="send" (most reliable for Gemini)
      const sendIcon = document.querySelector('mat-icon[data-mat-icon-name="send"]');
      if (sendIcon && this._isVisible(sendIcon)) {
        // Check if the icon's parent button has class "submit" (not "stop")
        const button = sendIcon.closest('button');
        if (button && button.classList.contains('submit')) {
          console.log('[SelectorEngine] ✅ Found send button via mat-icon[data-mat-icon-name="send"]');
          candidates.push({
            element: button,
            confidence: 0.92,
            method: 'sendButtonMatIcon',
          });
          return;
        }
      }

      // Method 2: Button with .send-button.submit class (Gemini specific)
      const submitButton = document.querySelector('button.send-button.submit');
      if (submitButton && this._isVisible(submitButton)) {
        console.log('[SelectorEngine] ✅ Found send button via button.send-button.submit');
        candidates.push({
          element: submitButton,
          confidence: 0.90,
          method: 'sendButtonSubmitClass',
        });
        return;
      }

      // Method 3: aria-label="Send message"
      const ariaLabelButton = document.querySelector('button[aria-label="Send message"]');
      if (ariaLabelButton && this._isVisible(ariaLabelButton)) {
        console.log('[SelectorEngine] ✅ Found send button via aria-label');
        candidates.push({
          element: ariaLabelButton,
          confidence: 0.88,
          method: 'sendButtonAriaLabel',
        });
        return;
      }

      // Method 4: .send-button-container.visible button
      const visibleContainer = document.querySelector('.send-button-container.visible button');
      if (visibleContainer && this._isVisible(visibleContainer)) {
        console.log('[SelectorEngine] ✅ Found send button via .send-button-container.visible');
        candidates.push({
          element: visibleContainer,
          confidence: 0.85,
          method: 'sendButtonVisibleContainer',
        });
        return;
      }

      // Method 5: Generic send-related selectors
      const genericSelectors = [
        'button.send-button',
        '.send-button-container button',
        '[class*="send-button"]',
      ];

      for (const selector of genericSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            const button = el.closest('button') || el;
            console.log(`[SelectorEngine] ✅ Found send button via: ${selector}`);
            candidates.push({
              element: button,
              confidence: 0.75,
              method: 'sendButtonGeneric',
            });
            return;
          }
        } catch { /* invalid */ }
      }

      console.log('[SelectorEngine] Send button fallback found nothing');
    },

    /**
     * Strategy 11: Completion indicator fallback (mic button appears when done)
     */
    _tryCompletionIndicatorFallback(fp, candidates) {
      console.log('[SelectorEngine] Trying completion indicator fallback...');

      // Method 1: data-mat-icon-name="mic" (most reliable for Gemini)
      const micIcon = document.querySelector('mat-icon[data-mat-icon-name="mic"]');
      if (micIcon && this._isVisible(micIcon)) {
        console.log('[SelectorEngine] ✅ Found mic icon via mat-icon[data-mat-icon-name="mic"]');
        candidates.push({
          element: micIcon,
          confidence: 0.92,
          method: 'completionMicMatIcon',
        });
        return;
      }

      // Method 2: speech-dictation-mic-button element
      const speechButton = document.querySelector('speech-dictation-mic-button');
      if (speechButton && this._isVisible(speechButton)) {
        console.log('[SelectorEngine] ✅ Found speech-dictation-mic-button');
        candidates.push({
          element: speechButton,
          confidence: 0.88,
          method: 'completionSpeechButton',
        });
        return;
      }

      // Method 3: .mic-button-container
      const micContainer = document.querySelector('.mic-button-container');
      if (micContainer && this._isVisible(micContainer)) {
        console.log('[SelectorEngine] ✅ Found .mic-button-container');
        candidates.push({
          element: micContainer,
          confidence: 0.85,
          method: 'completionMicContainer',
        });
        return;
      }

      // Method 4: aria-label containing "Microphone"
      const ariaLabelButton = document.querySelector('button[aria-label*="Microphone"]');
      if (ariaLabelButton && this._isVisible(ariaLabelButton)) {
        console.log('[SelectorEngine] ✅ Found mic button via aria-label');
        candidates.push({
          element: ariaLabelButton,
          confidence: 0.82,
          method: 'completionAriaLabel',
        });
        return;
      }

      // Method 5: Check if stop button is NOT visible (means generation complete)
      const stopIcon = document.querySelector('mat-icon[data-mat-icon-name="stop"]');
      const stopButton = document.querySelector('button.send-button.stop');

      if ((!stopIcon || !this._isVisible(stopIcon)) && (!stopButton || !this._isVisible(stopButton))) {
        // No stop button means generation is complete
        // Return the send button container as the "completion" signal
        const sendContainer = document.querySelector('.send-button-container');
        if (sendContainer && this._isVisible(sendContainer)) {
          console.log('[SelectorEngine] ✅ No stop button visible = generation complete');
          candidates.push({
            element: sendContainer,
            confidence: 0.75,
            method: 'completionNoStopButton',
          });
          return;
        }
      }

      console.log('[SelectorEngine] Completion indicator fallback found nothing');
    },

    /**
     * Strategy 12: Streaming indicator fallback (stop button visible during generation)
     */
    _tryStreamingIndicatorFallback(fp, candidates) {
      console.log('[SelectorEngine] Trying streaming indicator fallback...');

      // Method 1: data-mat-icon-name="stop"
      const stopIcon = document.querySelector('mat-icon[data-mat-icon-name="stop"]');
      if (stopIcon && this._isVisible(stopIcon)) {
        console.log('[SelectorEngine] ✅ Found stop icon via mat-icon[data-mat-icon-name="stop"]');
        candidates.push({
          element: stopIcon,
          confidence: 0.92,
          method: 'streamingStopMatIcon',
        });
        return;
      }

      // Method 2: Button with .send-button.stop class
      const stopButton = document.querySelector('button.send-button.stop');
      if (stopButton && this._isVisible(stopButton)) {
        console.log('[SelectorEngine] ✅ Found stop button via button.send-button.stop');
        candidates.push({
          element: stopButton,
          confidence: 0.90,
          method: 'streamingStopClass',
        });
        return;
      }

      // Method 3: aria-label="Stop response"
      const ariaLabelButton = document.querySelector('button[aria-label="Stop response"]');
      if (ariaLabelButton && this._isVisible(ariaLabelButton)) {
        console.log('[SelectorEngine] ✅ Found stop button via aria-label');
        candidates.push({
          element: ariaLabelButton,
          confidence: 0.88,
          method: 'streamingAriaLabel',
        });
        return;
      }

      // Method 4: .stop-icon element
      const stopIconElement = document.querySelector('.stop-icon');
      if (stopIconElement && this._isVisible(stopIconElement)) {
        console.log('[SelectorEngine] ✅ Found .stop-icon');
        candidates.push({
          element: stopIconElement,
          confidence: 0.85,
          method: 'streamingStopIcon',
        });
        return;
      }

      console.log('[SelectorEngine] Streaming indicator fallback found nothing');
    },


    // ══════════════════════════════════════════════════════════════
    //  Scoring & Helper Methods
    // ══════════════════════════════════════════════════════════════

    _stripDynamicClasses(selector) {
      if (!selector) return selector;

      try {
        let cleaned = selector
          .replace(/\.ng-tns-c\d+-\d+/g, '')
          .replace(/\.ng-star-inserted/g, '')
          .replace(/\.ng-trigger[^\s.\[:>]*/g, '')
          .replace(/\.ng-animating/g, '')
          .replace(/\.+/g, '.')
          .replace(/\.\s*>/g, ' >')
          .replace(/\.\s*:/g, ':')
          .replace(/\.\s*\[/g, '[')
          .replace(/\s+/g, ' ')
          .replace(/\.\s*$/g, '')
          .trim();

        document.querySelector(cleaned);
        return cleaned;
      } catch {
        return null;
      }
    },

    _attributeSimilarity(element, storedAttrs) {
      let score = 0;
      let maxScore = 0;

      maxScore += 0.15;
      if (element.tagName.toLowerCase() === storedAttrs.tagName) {
        score += 0.15;
      } else {
        return 0;
      }

      if (storedAttrs.classes && storedAttrs.classes.length > 0) {
        maxScore += 0.25;
        const stableStoredClasses = storedAttrs.classes.filter(
          c => !c.startsWith('ng-tns-') && c !== 'ng-star-inserted' && !c.startsWith('ng-trigger')
        );
        const stableElementClasses = [...element.classList].filter(
          c => !c.startsWith('ng-tns-') && c !== 'ng-star-inserted' && !c.startsWith('ng-trigger')
        );

        if (stableStoredClasses.length > 0) {
          const matched = stableStoredClasses.filter(c => stableElementClasses.includes(c));
          score += 0.25 * (matched.length / stableStoredClasses.length);
        }
      }

      if (storedAttrs.ariaLabel) {
        maxScore += 0.25;
        if (element.getAttribute('aria-label') === storedAttrs.ariaLabel) {
          score += 0.25;
        }
      }

      if (storedAttrs.role) {
        maxScore += 0.10;
        if (element.getAttribute('role') === storedAttrs.role) {
          score += 0.10;
        }
      }

      if (storedAttrs.placeholder) {
        maxScore += 0.15;
        if (element.getAttribute('placeholder') === storedAttrs.placeholder) {
          score += 0.15;
        }
      }

      const storedData = storedAttrs.dataAttributes || {};
      const dataKeys = Object.keys(storedData);
      if (dataKeys.length > 0) {
        maxScore += 0.15;
        let dataMatch = 0;
        for (const key of dataKeys) {
          if (element.getAttribute(key) === storedData[key]) dataMatch++;
        }
        score += 0.15 * (dataMatch / dataKeys.length);
      }

      if (storedAttrs.contentEditable === 'true') {
        maxScore += 0.10;
        if (element.getAttribute('contenteditable') === 'true') score += 0.10;
      }

      return maxScore > 0 ? score / maxScore : 0;
    },

    _deduplicateCandidates(candidates) {
      const map = new Map();

      for (const candidate of candidates) {
        const existing = map.get(candidate.element);

        if (!existing) {
          map.set(candidate.element, {
            ...candidate,
            methods: [candidate.method],
            corroborations: 1,
          });
        } else {
          existing.methods.push(candidate.method);
          existing.corroborations++;

          if (candidate.confidence > existing.confidence) {
            existing.confidence = candidate.confidence;
            existing.method = candidate.method;
          }

          existing.confidence = Math.min(
            existing.confidence + 0.02 * (existing.corroborations - 1),
            0.99
          );
        }
      }

      return [...map.values()];
    },

    _isVisible(element) {
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
  };


  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  root.PC.SelectorEngine = {

    fingerprint(element) {
      return FingerprintGenerator.generate(element);
    },

    find(fingerprint) {
      return ElementReFinder.find(fingerprint);
    },

    findWithWait(fingerprint, timeout) {
      return ElementReFinder.findWithWait(fingerprint, timeout);
    },

    checkHealth(fingerprint) {
      const match = ElementReFinder.find(fingerprint);
      const CONF = PC.Constants.CONFIDENCE;

      if (!match) {
        return {
          found: false,
          confidence: 0,
          method: 'none',
          status: 'broken',
        };
      }

      let status;
      if (match.confidence >= CONF.HEALTHY) {
        status = 'healthy';
      } else if (match.confidence >= CONF.DEGRADED) {
        status = 'degraded';
      } else {
        status = 'unreliable';
      }

      return {
        found: true,
        confidence: match.confidence,
        method: match.method,
        methods: match.methods || [match.method],
        status,
      };
    },

    /**
     * Check if Gemini is currently generating a response.
     * Returns true if the stop button is visible.
     */
    isGenerating() {
      const stopIcon = document.querySelector('mat-icon[data-mat-icon-name="stop"]');
      const stopButton = document.querySelector('button.send-button.stop');

      const isStopVisible = (stopIcon && this._isElementVisible(stopIcon)) ||
                           (stopButton && this._isElementVisible(stopButton));

      return isStopVisible;
    },

    /**
     * Check if Gemini has finished generating.
     * Returns true if the mic button is visible OR stop button is not visible.
     */
    isGenerationComplete() {
      const micIcon = document.querySelector('mat-icon[data-mat-icon-name="mic"]');
      const stopIcon = document.querySelector('mat-icon[data-mat-icon-name="stop"]');
      const stopButton = document.querySelector('button.send-button.stop');

      const isMicVisible = micIcon && this._isElementVisible(micIcon);
      const isStopVisible = (stopIcon && this._isElementVisible(stopIcon)) ||
                           (stopButton && this._isElementVisible(stopButton));

      return isMicVisible || !isStopVisible;
    },

    /**
     * Check if element is visible (exposed for external use).
     */
    _isElementVisible(element) {
      return ElementReFinder._isVisible(element);
    },
  };

  console.log('[PC SelectorEngine] ✅ Module loaded');
})();