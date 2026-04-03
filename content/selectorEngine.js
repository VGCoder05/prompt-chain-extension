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
    // Walks up the DOM tree, building a CSS selector for each node.
    // Stops early if an ID is found (IDs should be unique).

    getCSSPath(element) {
      const parts = [];
      let current = element;

      while (current && current !== document.body && current !== document.documentElement) {
        let selector = current.tagName.toLowerCase();

        // If element has an ID, use it and stop (IDs are unique)
        if (current.id && this._isStableId(current.id)) {
          selector = `#${CSS.escape(current.id)}`;
          parts.unshift(selector);
          break;
        }

        // Add meaningful (non-hashed) classes for specificity
        const meaningful = this._getMeaningfulClasses(current);
        if (meaningful.length > 0) {
          selector += '.' + meaningful.slice(0, 3).map(c => CSS.escape(c)).join('.');
        }

        // Add nth-of-type if siblings share the same tag
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
    // Especially useful for buttons ("Send", "Stop Generating", etc.)

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
    // Attempts to construct the most reliable one-line CSS selector.
    // Priority: ID > aria-label > unique attribute combo > cssPath

    getBestSelector(element) {
      // Priority 1: ID
      if (element.id && this._isStableId(element.id)) {
        return `#${CSS.escape(element.id)}`;
      }

      const tag = element.tagName.toLowerCase();

      // Priority 2: aria-label (semantic, usually stable)
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) {
        const candidate = `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
        if (this._isUnique(candidate)) return candidate;
      }

      // Priority 3: data-testid or similar test attributes
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

      // Priority 4: placeholder (for inputs/textareas)
      const placeholder = element.getAttribute('placeholder');
      if (placeholder) {
        const candidate = `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
        if (this._isUnique(candidate)) return candidate;
      }

      // Priority 5: role + meaningful class combo
      const role = element.getAttribute('role');
      const meaningful = this._getMeaningfulClasses(element);
      if (role && meaningful.length > 0) {
        const candidate = `${tag}[role="${role}"].${CSS.escape(meaningful[0])}`;
        if (this._isUnique(candidate)) return candidate;
      }

      // Priority 6: Unique contenteditable
      if (element.getAttribute('contenteditable') === 'true') {
        const candidate = `${tag}[contenteditable="true"]`;
        const matches = document.querySelectorAll(candidate);
        if (matches.length === 1) return candidate;
        // If multiple, add a distinguishing class
        if (meaningful.length > 0) {
          const refined = `${candidate}.${CSS.escape(meaningful[0])}`;
          if (this._isUnique(refined)) return refined;
        }
      }

      // Priority 7: Fall back to CSS path
      return this.getCSSPath(element);
    },


    // ── Private Helpers ───────────────────────────────────────────

    /**
     * Check if an ID looks stable (not auto-generated/hashed).
     * Hashed IDs like "r-1a2b3c" or ":r0:" change across page loads.
     */
    _isStableId(id) {
      if (!id) return false;

      // Skip IDs that look auto-generated
      const unstablePatterns = [
        /^:r\d+:$/,               // React auto IDs like :r0:, :r1:
        /^[a-f0-9]{8,}$/i,        // long hex strings
        /^[a-z]{1,3}-[a-f0-9]+/i, // prefix-hash patterns like "r-1a2b"
        /^\d+$/,                   // pure numeric
        /^ember\d+/,               // Ember.js auto IDs
        /^__next/,                 // Next.js internal IDs
      ];

      return !unstablePatterns.some((pattern) => pattern.test(id));
    },

    /**
     * Filter element classes to only meaningful (non-hashed) ones.
     * CSS-in-JS tools generate random class names like "sc-AxjAm" or "css-1a2b3c".
     */
    _getMeaningfulClasses(element) {
      return [...element.classList].filter((cls) => {
        // Skip empty
        if (!cls || cls.length < 2) return false;

        // Skip common auto-generated patterns
        const hashPatterns = [
          /^css-/,                 // emotion/styled-components
          /^sc-[a-zA-Z]/,          // styled-components
          /^_[a-zA-Z0-9]{5,}$/,    // CSS modules
          /^[a-z]{5,8}$/,          // short random strings (e.g., "dkWjRe")
          /^[A-Z][a-z]{4,}[A-Z]/, // camelCase hashes (e.g., "aBcDeF")
          /^jsx-[a-f0-9]+/,        // Next.js JSX styles
          /^svelte-[a-z0-9]+/,     // Svelte scoped styles
          /^ng-tns-c\d+-\d+$/,     // Angular dynamic classes
          /^ng-star-inserted$/,    // Angular structural directive
          /^ng-trigger/,           // Angular animation triggers
        ];

        return !hashPatterns.some((pattern) => pattern.test(cls));
      });
    },

    /**
     * Get all data-* attributes as a plain object.
     */
    _getDataAttributes(element) {
      const data = {};
      for (const attr of element.attributes) {
        if (attr.name.startsWith('data-')) {
          data[attr.name] = attr.value;
        }
      }
      return data;
    },

    /**
     * Get the depth of an element in the DOM tree.
     */
    _getDepth(element) {
      let depth = 0;
      let current = element;
      while (current && current !== document.documentElement) {
        depth++;
        current = current.parentElement;
      }
      return depth;
    },

    /**
     * Check if a CSS selector matches exactly one element on the page.
     */
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

      // Detect what type of element we're looking for (for specialized fallbacks)
      const elementType = this._detectElementType(fingerprint);

      // ══════════════════════════════════════════════════════════════
      // DEBUG: Log what we're searching for
      // ══════════════════════════════════════════════════════════════
      console.log('[SelectorEngine] 🔍 Attempting to find element:', {
        type: elementType,
        tagName: fingerprint.meta?.tagName,
        dataAttrs: fingerprint.attributes?.dataAttributes,
        classes: fingerprint.attributes?.classes?.filter(c => !c.startsWith('ng-')).slice(0, 5),
      });

      const candidates = [];

      // Strategy 1: Try bestSelector (the single best CSS selector)
      this._tryBestSelector(fingerprint, candidates);

      // Strategy 2: Try ID
      this._tryId(fingerprint, candidates);

      // Strategy 3: Try CSS path
      this._tryCSSPath(fingerprint, candidates);

      // Strategy 4: Try XPath
      this._tryXPath(fingerprint, candidates);

      // Strategy 5: Try attribute-based matching
      this._tryAttributes(fingerprint, candidates);

      // Strategy 6: Try text clue matching (for buttons)
      this._tryTextClues(fingerprint, candidates);

      // Strategy 7: Try contenteditable + role matching
      this._trySemanticMatch(fingerprint, candidates);

      // Strategy 8: Try data-* attribute matching (for Material icons)
      this._tryDataAttributes(fingerprint, candidates);

      // ══════════════════════════════════════════════════════════════
      // SPECIALIZED FALLBACKS based on element type
      // ══════════════════════════════════════════════════════════════

      // Strategy 9: Rich text editor fallback
      if (elementType === 'input' || elementType === 'unknown') {
        this._tryRichEditorFallback(fingerprint, candidates);
      }

      // Strategy 10: Send button fallback
      if (elementType === 'sendButton') {
        this._trySendButtonFallback(fingerprint, candidates);
      }

      // Strategy 11: Completion indicator fallback (mic button, etc.)
      if (elementType === 'completionIndicator') {
        this._tryCompletionIndicatorFallback(fingerprint, candidates);
      }

      // ── Deduplicate candidates (same element found by multiple methods) ──
      const deduped = this._deduplicateCandidates(candidates);

      if (deduped.length === 0) {
        console.warn('[SelectorEngine] ❌ No candidates found for fingerprint');
        return null;
      }

      // Sort by confidence descending
      deduped.sort((a, b) => b.confidence - a.confidence);

      // Log all candidates for debugging
      console.log(
        `[SelectorEngine] Re-find: ${deduped.length} candidate(s) —`,
        deduped.map((c) => `${c.method}(${c.confidence.toFixed(2)})`).join(', ')
      );

      return deduped[0];
    },

    /**
     * Detect what type of element we're trying to find.
     * This helps us choose the right fallback strategies.
     */
    _detectElementType(fp) {
      const dataAttrs = fp.attributes?.dataAttributes || {};
      const classes = fp.attributes?.classes || [];
      const parentClasses = fp.domPosition?.parentClasses || [];
      const tagName = fp.meta?.tagName || fp.attributes?.tagName;

      // Check for send button indicators
      if (
        dataAttrs['data-mat-icon-name'] === 'send' ||
        classes.some(c => c.includes('send')) ||
        parentClasses.some(c => c.includes('send'))
      ) {
        return 'sendButton';
      }

      // Check for completion indicator (mic button, etc.)
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

      // Check for generic button
      if (tagName === 'button' || fp.attributes?.role === 'button') {
        return 'button';
      }

      return 'unknown';
    },

    /**
     * Find an element, waiting for it to appear if not immediately present.
     * Uses MutationObserver to watch for DOM changes.
     *
     * @param {object} fingerprint
     * @param {number} [timeout=10000] - max wait in ms
     * @returns {Promise<object|null>} { element, confidence, method } or null
     */
    findWithWait(fingerprint, timeout = 10000) {
      return new Promise((resolve) => {
        // Try immediately first
        const immediate = this.find(fingerprint);
        if (immediate && immediate.confidence >= PC.Constants.CONFIDENCE.MINIMUM) {
          resolve(immediate);
          return;
        }

        // Not found yet — watch for DOM changes
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
        });

        // Timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            // One final attempt
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
        // Try original first
        let el = document.querySelector(fp.bestSelector);

        // If not found, try with dynamic classes stripped
        if (!el) {
          const cleaned = this._stripDynamicClasses(fp.bestSelector);
          if (cleaned && cleaned !== fp.bestSelector) {
            console.log('[SelectorEngine] Trying cleaned bestSelector:', cleaned.substring(0, 80));
            try {
              el = document.querySelector(cleaned);
            } catch { /* invalid selector after cleaning */ }
          }
        }

        if (el && this._isVisible(el)) {
          // Confidence depends on what kind of selector it is
          let confidence = 0.90;
          if (fp.bestSelector.startsWith('#')) confidence = 0.98; // ID match
          if (fp.bestSelector.includes('aria-label')) confidence = 0.92;
          if (fp.bestSelector.includes('data-testid')) confidence = 0.95;

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
        // Try original
        let el = document.querySelector(fp.cssPath);

        // If not found, try cleaned version
        if (!el) {
          const cleaned = this._stripDynamicClasses(fp.cssPath);
          if (cleaned && cleaned !== fp.cssPath) {
            console.log('[SelectorEngine] Trying cleaned cssPath:', cleaned.substring(0, 80));
            try {
              el = document.querySelector(cleaned);
            } catch { /* invalid selector after cleaning */ }
          }
        }

        if (el && this._isVisible(el)) {
          candidates.push({ element: el, confidence: 0.85, method: 'cssPath' });
        }
      } catch { /* cssPath might be invalid if DOM restructured */ }
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

        console.log('[SelectorEngine] XPath result:', {
          xpath: fp.xpath.substring(0, 80),
          found: !!el,
          isVisible: el ? this._isVisible(el) : false,
          tagName: el?.tagName,
        });

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

      // Build a base query from stable attributes
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

      // Only useful for short-text elements like buttons
      if (clues.textContent.length > 50) return;

      const elements = document.querySelectorAll(tag);
      for (const el of elements) {
        if (!this._isVisible(el)) continue;

        const elText = (el.textContent || '').trim();
        if (!elText) continue;

        // Exact text match
        if (elText === clues.textContent) {
          candidates.push({ element: el, confidence: 0.85, method: 'textExact' });
          continue;
        }

        // Fuzzy: text contains or is contained
        if (
          elText.includes(clues.textContent) ||
          clues.textContent.includes(elText)
        ) {
          candidates.push({ element: el, confidence: 0.65, method: 'textFuzzy' });
        }
      }
    },

    _trySemanticMatch(fp, candidates) {
      if (!fp.attributes) return;
      const attrs = fp.attributes;

      // Try aria-label on its own (very stable across UI updates)
      if (attrs.ariaLabel) {
        try {
          const selector = `[aria-label="${CSS.escape(attrs.ariaLabel)}"]`;
          const els = document.querySelectorAll(selector);
          for (const el of els) {
            if (!this._isVisible(el)) continue;
            // Boost confidence if tag also matches
            const tagMatch = el.tagName.toLowerCase() === attrs.tagName;
            candidates.push({
              element: el,
              confidence: tagMatch ? 0.90 : 0.78,
              method: 'ariaLabel',
            });
          }
        } catch { /* invalid selector */ }
      }

      // Try placeholder (for inputs/textareas)
      if (attrs.placeholder) {
        try {
          const selector = `${attrs.tagName}[placeholder="${CSS.escape(attrs.placeholder)}"]`;
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            candidates.push({ element: el, confidence: 0.87, method: 'placeholder' });
          }
        } catch { /* invalid selector */ }
      }

      // Try contenteditable
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
     * Strategy 8: Try matching by data-* attributes
     * Very useful for Material Design icons (data-mat-icon-name, etc.)
     */
    _tryDataAttributes(fp, candidates) {
      const dataAttrs = fp.attributes?.dataAttributes || {};
      const dataKeys = Object.keys(dataAttrs);

      if (dataKeys.length === 0) return;

      // Build selector from data attributes
      for (const key of dataKeys) {
        const value = dataAttrs[key];
        if (!value) continue;

        try {
          const selector = `[${key}="${CSS.escape(value)}"]`;
          const els = document.querySelectorAll(selector);

          for (const el of els) {
            if (!this._isVisible(el)) continue;

            // Check if tag matches for higher confidence
            const tagMatch = el.tagName.toLowerCase() === fp.attributes?.tagName;

            candidates.push({
              element: el,
              confidence: tagMatch ? 0.88 : 0.75,
              method: 'dataAttribute',
            });
          }
        } catch { /* invalid selector */ }
      }
    },

    /**
     * Strategy 9: Rich text editor fallback (Quill, ProseMirror, etc.)
     */
    _tryRichEditorFallback(fp, candidates) {
      const parentClasses = fp.domPosition?.parentClasses || [];
      const allClasses = fp.attributes?.classes || [];
      const tagName = fp.meta?.tagName || fp.attributes?.tagName;

      const editorIndicators = [
        'ql-editor', 'ql-container', 'ql-blank', 'ql-bubble',
        'ProseMirror', 'tiptap',
        'textarea', 'text-input',
        'rich-textarea', 'contenteditable'
      ];

      const isLikelyEditor =
        parentClasses.some(c => editorIndicators.some(ind => c.includes(ind))) ||
        allClasses.some(c => editorIndicators.some(ind => c.includes(ind))) ||
        tagName === 'p' ||
        tagName === 'div';

      if (!isLikelyEditor) return;

      console.log('[SelectorEngine] Trying rich editor fallback...');

      // Quill selectors
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
        } catch { /* invalid selector */ }
      }

      // ProseMirror
      const proseMirrorSelectors = [
        '.ProseMirror[contenteditable="true"]',
        '.ProseMirror',
      ];

      for (const selector of proseMirrorSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            console.log(`[SelectorEngine] ✅ Found ProseMirror: ${selector}`);
            candidates.push({
              element: el,
              confidence: 0.75,
              method: 'richEditorFallback',
            });
            return;
          }
        } catch { /* invalid selector */ }
      }

      // Generic contenteditable in input area
      const editables = document.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (!this._isVisible(el)) continue;

        const isMainInput = el.closest(
          'input-area-v2, input-area, .input-area, .chat-input, .message-input, ' +
          'input-container, .input-container, .composer, .chat-composer'
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
     * Looks for common send button patterns (Material icons, aria-labels, classes)
     */
    _trySendButtonFallback(fp, candidates) {
      console.log('[SelectorEngine] Trying send button fallback...');

      // Method 1: Material icon with data-mat-icon-name="send"
      const matIconSend = document.querySelector('mat-icon[data-mat-icon-name="send"]');
      if (matIconSend && this._isVisible(matIconSend)) {
        // Return the icon itself or the parent button
        const button = matIconSend.closest('button') || matIconSend;
        console.log('[SelectorEngine] ✅ Found send button via mat-icon[data-mat-icon-name="send"]');
        candidates.push({
          element: button,
          confidence: 0.85,
          method: 'sendButtonMatIcon',
        });
        return;
      }

      // Method 2: Button/icon with send-related classes
      const sendClassSelectors = [
        'button.send-button',
        '.send-button button',
        '.send-button-container button',
        '[class*="send-button"]',
        'button[class*="send"]',
        'mat-icon.send-button-icon',
        '.send-button-icon',
      ];

      for (const selector of sendClassSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            const button = el.closest('button') || el;
            console.log(`[SelectorEngine] ✅ Found send button via: ${selector}`);
            candidates.push({
              element: button,
              confidence: 0.80,
              method: 'sendButtonClass',
            });
            return;
          }
        } catch { /* invalid selector */ }
      }

      // Method 3: aria-label containing "send"
      const ariaLabelSelectors = [
        'button[aria-label*="Send" i]',
        'button[aria-label*="send" i]',
        '[role="button"][aria-label*="send" i]',
      ];

      for (const selector of ariaLabelSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            console.log(`[SelectorEngine] ✅ Found send button via: ${selector}`);
            candidates.push({
              element: el,
              confidence: 0.78,
              method: 'sendButtonAriaLabel',
            });
            return;
          }
        } catch { /* invalid selector */ }
      }

      // Method 4: Button inside send-button-container
      const containerSelectors = [
        '.send-button-container button',
        'div[class*="send"] button',
        '.input-buttons-wrapper-bottom button:last-child',
      ];

      for (const selector of containerSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            console.log(`[SelectorEngine] ✅ Found send button via container: ${selector}`);
            candidates.push({
              element: el,
              confidence: 0.70,
              method: 'sendButtonContainer',
            });
            return;
          }
        } catch { /* invalid selector */ }
      }

      // Method 5: Look for icon with "send" text content (Google Symbols font)
      const allMatIcons = document.querySelectorAll('mat-icon');
      for (const icon of allMatIcons) {
        if (!this._isVisible(icon)) continue;
        const text = (icon.textContent || '').trim().toLowerCase();
        if (text === 'send' || text === 'arrow_upward') {
          const button = icon.closest('button') || icon;
          console.log('[SelectorEngine] ✅ Found send button via icon text content');
          candidates.push({
            element: button,
            confidence: 0.75,
            method: 'sendButtonIconText',
          });
          return;
        }
      }

      console.log('[SelectorEngine] Send button fallback found nothing');
    },

    /**
     * Strategy 11: Completion indicator fallback
     * Looks for mic button or other indicators that response is complete
     */
    _tryCompletionIndicatorFallback(fp, candidates) {
      console.log('[SelectorEngine] Trying completion indicator fallback...');

      // Method 1: Material icon with data-mat-icon-name="mic"
      const matIconMic = document.querySelector('mat-icon[data-mat-icon-name="mic"]');
      if (matIconMic && this._isVisible(matIconMic)) {
        console.log('[SelectorEngine] ✅ Found completion indicator via mat-icon[data-mat-icon-name="mic"]');
        candidates.push({
          element: matIconMic,
          confidence: 0.85,
          method: 'completionMicIcon',
        });
        return;
      }

      // Method 2: Speech/mic button classes
      const micClassSelectors = [
        'speech-dictation-mic-button',
        '.speech-dictation-mic-button',
        '[class*="mic-button"]',
        '[class*="speech-dictation"]',
        '.mic-button-container button',
        '.mic-button-container mat-icon',
        'button[class*="mic"]',
      ];

      for (const selector of micClassSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            console.log(`[SelectorEngine] ✅ Found completion indicator via: ${selector}`);
            candidates.push({
              element: el,
              confidence: 0.80,
              method: 'completionMicClass',
            });
            return;
          }
        } catch { /* invalid selector */ }
      }

      // Method 3: aria-label containing "mic" or "voice"
      const ariaLabelSelectors = [
        'button[aria-label*="mic" i]',
        'button[aria-label*="voice" i]',
        'button[aria-label*="speech" i]',
        '[aria-label*="microphone" i]',
      ];

      for (const selector of ariaLabelSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            console.log(`[SelectorEngine] ✅ Found completion indicator via: ${selector}`);
            candidates.push({
              element: el,
              confidence: 0.75,
              method: 'completionAriaLabel',
            });
            return;
          }
        } catch { /* invalid selector */ }
      }

      // Method 4: Look for mat-icon with "mic" text content
      const allMatIcons = document.querySelectorAll('mat-icon');
      for (const icon of allMatIcons) {
        if (!this._isVisible(icon)) continue;
        const text = (icon.textContent || '').trim().toLowerCase();
        if (text === 'mic' || text === 'mic_none' || text === 'keyboard_voice') {
          console.log('[SelectorEngine] ✅ Found completion indicator via icon text content');
          candidates.push({
            element: icon,
            confidence: 0.75,
            method: 'completionIconText',
          });
          return;
        }
      }

      // Method 5: Alternative completion indicators (stop button disappearing, etc.)
      // Look for the input area being enabled/ready
      const inputAreaSelectors = [
        'input-area-v2:not(.disabled)',
        '.input-area:not(.disabled)',
        'rich-textarea:not([disabled])',
      ];

      for (const selector of inputAreaSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && this._isVisible(el)) {
            // Check if there's no "stop" button visible (indicating generation stopped)
            const stopButton = document.querySelector('[aria-label*="Stop" i], [data-mat-icon-name="stop"]');
            if (!stopButton || !this._isVisible(stopButton)) {
              console.log('[SelectorEngine] ✅ Found completion indicator via input area ready + no stop button');
              candidates.push({
                element: el,
                confidence: 0.65,
                method: 'completionInputReady',
              });
              return;
            }
          }
        } catch { /* invalid selector */ }
      }

      console.log('[SelectorEngine] Completion indicator fallback found nothing');
    },


    // ══════════════════════════════════════════════════════════════
    //  Scoring & Helper Methods
    // ══════════════════════════════════════════════════════════════

    /**
     * Remove Angular dynamic class indices from a selector.
     * ng-tns-c1234567-89 → removed entirely
     */
    _stripDynamicClasses(selector) {
      if (!selector) return selector;

      try {
        let cleaned = selector
          // Angular dynamic classes
          .replace(/\.ng-tns-c\d+-\d+/g, '')
          .replace(/\.ng-star-inserted/g, '')
          .replace(/\.ng-trigger[^\s.\[:>]*/g, '')
          .replace(/\.ng-animating/g, '')
          // Clean up any resulting issues
          .replace(/\.+/g, '.')           // multiple dots → single dot
          .replace(/\.\s*>/g, ' >')        // ". >" → " >"
          .replace(/\.\s*:/g, ':')         // ".:" → ":"
          .replace(/\.\s*\[/g, '[')        // ".[" → "["
          .replace(/\s+/g, ' ')            // multiple spaces → single space
          .replace(/\.\s*$/g, '')          // trailing dot
          .trim();

        // Validate the cleaned selector works
        document.querySelector(cleaned);
        return cleaned;
      } catch {
        return null;
      }
    },

    /**
     * Score how similar an element's attributes are to a stored fingerprint.
     * Returns a number between 0 and 1.
     */
    _attributeSimilarity(element, storedAttrs) {
      let score = 0;
      let maxScore = 0;

      // Tag name (must match for any reasonable score)
      maxScore += 0.15;
      if (element.tagName.toLowerCase() === storedAttrs.tagName) {
        score += 0.15;
      } else {
        return 0; // Wrong tag = not a match
      }

      // Classes overlap (filter out dynamic Angular classes)
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

      // aria-label
      if (storedAttrs.ariaLabel) {
        maxScore += 0.25;
        if (element.getAttribute('aria-label') === storedAttrs.ariaLabel) {
          score += 0.25;
        }
      }

      // role
      if (storedAttrs.role) {
        maxScore += 0.10;
        if (element.getAttribute('role') === storedAttrs.role) {
          score += 0.10;
        }
      }

      // placeholder
      if (storedAttrs.placeholder) {
        maxScore += 0.15;
        if (element.getAttribute('placeholder') === storedAttrs.placeholder) {
          score += 0.15;
        }
      }

      // data attributes
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

      // contentEditable
      if (storedAttrs.contentEditable === 'true') {
        maxScore += 0.10;
        if (element.getAttribute('contenteditable') === 'true') score += 0.10;
      }

      return maxScore > 0 ? score / maxScore : 0;
    },

    /**
     * Deduplicate candidates that point to the same DOM element.
     * Keep the entry with highest confidence, but boost confidence
     * when multiple strategies agree (corroboration bonus).
     */
    _deduplicateCandidates(candidates) {
      const map = new Map(); // element → best candidate info

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

          // Use the highest confidence from any single method
          if (candidate.confidence > existing.confidence) {
            existing.confidence = candidate.confidence;
            existing.method = candidate.method;
          }

          // Corroboration bonus: each additional strategy that agrees
          // adds a small confidence boost (capped at 0.99)
          existing.confidence = Math.min(
            existing.confidence + 0.02 * (existing.corroborations - 1),
            0.99
          );
        }
      }

      return [...map.values()];
    },

    /**
     * Check if an element is visible on the page.
     * Hidden elements are usually not what the user recorded.
     */
    _isVisible(element) {
      if (!element) return false;

      // Quick check: is it in the DOM?
      if (!element.isConnected) return false;

      // Check computed style
      const style = window.getComputedStyle(element);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;

      // Check if element has dimensions
      // (some elements are technically visible but have 0x0 size)
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;

      return true;
    },
  };


  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  root.PC.SelectorEngine = {

    /**
     * Generate a fingerprint for a DOM element.
     * Called by the Recorder when user clicks an element.
     *
     * @param {HTMLElement} element
     * @returns {object} fingerprint
     */
    fingerprint(element) {
      return FingerprintGenerator.generate(element);
    },

    /**
     * Find a DOM element matching a previously stored fingerprint.
     * Returns immediately with the best match found.
     *
     * @param {object} fingerprint
     * @returns {object|null} { element, confidence, method, methods, corroborations }
     */
    find(fingerprint) {
      return ElementReFinder.find(fingerprint);
    },

    /**
     * Find a DOM element, waiting up to timeout ms for it to appear.
     * Useful for elements that load dynamically (SPA transitions).
     *
     * @param {object} fingerprint
     * @param {number} [timeout=10000]
     * @returns {Promise<object|null>}
     */
    findWithWait(fingerprint, timeout) {
      return ElementReFinder.findWithWait(fingerprint, timeout);
    },

    /**
     * Quick health check: can we still find this fingerprint?
     * Returns a status object.
     *
     * @param {object} fingerprint
     * @returns {object} { found, confidence, method, status }
     */
    checkHealth(fingerprint) {
      const match = ElementReFinder.find(fingerprint);
      const CONF = PC.Constants.CONFIDENCE;

      if (!match) {
        return {
          found: false,
          confidence: 0,
          method: 'none',
          status: 'broken',    // ❌
        };
      }

      let status;
      if (match.confidence >= CONF.HEALTHY) {
        status = 'healthy';    // ✅
      } else if (match.confidence >= CONF.DEGRADED) {
        status = 'degraded';   // ⚠️
      } else {
        status = 'unreliable'; // ❌
      }

      return {
        found: true,
        confidence: match.confidence,
        method: match.method,
        methods: match.methods || [match.method],
        status,
      };
    },
  };

  console.log('[PC SelectorEngine] ✅ Module loaded');
})();