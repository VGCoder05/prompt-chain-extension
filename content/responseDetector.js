/**
 * content/responseDetector.js
 * ────────────────────────────────────────────
 * Detects AI response state on chat interfaces.
 *
 * Key capabilities:
 *   - Detect when AI is generating (streaming)
 *   - Detect when AI response is complete
 *   - Find the latest response container
 *   - Site-specific configurations for major AI platforms
 *
 * Works alongside SelectorEngine but provides higher-level
 * semantics for AI chat interactions.
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  // ══════════════════════════════════════════════════════════════════
  //  SITE CONFIGURATIONS
  //  Each config defines how to detect responses on that platform
  // ══════════════════════════════════════════════════════════════════

  const SITE_CONFIGS = {

    // ── Google Gemini ─────────────────────────────────────────────
    'gemini.google.com': {
      name: 'Gemini',

      // Selector for all response message containers
      responseContainerSelector: [
        'message-content.model-response-text',
        '.model-response-text',
        '.response-content',
        'model-response message-content',
        '.conversation-container .model-response',
      ],

      // Selector for the input/prompt area
      inputSelector: [
        '.ql-editor[contenteditable="true"]',
        'rich-textarea [contenteditable="true"]',
        '.input-area [contenteditable="true"]',
        '[aria-label*="prompt" i][contenteditable="true"]',
        'textarea[aria-label*="prompt" i]',
      ],

      // Selector for the submit/send button
      submitSelector: [
        'button[aria-label*="Send" i]',
        'button[aria-label*="Submit" i]',
        '.send-button',
        'button.send-button',
        '[data-test-id="send-button"]',
      ],

      // How to detect if AI is currently streaming/generating
      streamingIndicators: [
        // Loading spinners
        () => !!document.querySelector('.loading-indicator:not([hidden])'),
        () => !!document.querySelector('.response-loading'),
        () => !!document.querySelector('[aria-label*="loading" i]'),
        // Cursor/typing indicators
        () => !!document.querySelector('.typing-indicator'),
        () => !!document.querySelector('.cursor-blink'),
        // Stop button visible = still generating
        () => !!document.querySelector('button[aria-label*="Stop" i]:not([disabled])'),
        // Check for streaming class on response
        () => !!document.querySelector('.streaming, .is-streaming, [data-streaming="true"]'),
      ],

      // How to detect response is complete
      completionIndicators: [
        // Copy/share buttons appear when done
        () => {
          const responses = document.querySelectorAll('message-content.model-response-text, .model-response-text');
          if (responses.length === 0) return false;
          const last = responses[responses.length - 1];
          return !!last.querySelector('button[aria-label*="Copy" i], button[aria-label*="Share" i], .copy-button');
        },
        // Thumbs up/down feedback buttons
        () => {
          const responses = document.querySelectorAll('message-content.model-response-text, .model-response-text');
          if (responses.length === 0) return false;
          const last = responses[responses.length - 1];
          return !!last.closest('.message-container, .response-container')?.querySelector('[aria-label*="Good" i], [aria-label*="Bad" i], .feedback-buttons');
        },
      ],

      // Get the latest response element
      getLatestResponse: () => {
        const selectors = [
          'message-content.model-response-text',
          '.model-response-text',
          '.response-content',
          '.model-response',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            return elements[elements.length - 1];
          }
        }
        return null;
      },

      // Minimum time to wait after last DOM change before considering response "complete"
      stabilityDelay: 1500,
    },


    // ── OpenAI ChatGPT ────────────────────────────────────────────
    'chat.openai.com': {
      name: 'ChatGPT',
      aliases: ['chatgpt.com'],

      responseContainerSelector: [
        '[data-message-author-role="assistant"]',
        '.agent-turn .markdown',
        '.assistant-message',
        '[data-testid="conversation-turn-"] .markdown',
      ],

      inputSelector: [
        '#prompt-textarea',
        'textarea[data-id="root"]',
        '[contenteditable="true"][data-id]',
        'form textarea',
      ],

      submitSelector: [
        'button[data-testid="send-button"]',
        'form button[type="submit"]',
        'button[aria-label*="Send" i]',
      ],

      streamingIndicators: [
        () => !!document.querySelector('button[aria-label*="Stop" i]:not([disabled])'),
        () => !!document.querySelector('.result-streaming'),
        () => !!document.querySelector('[data-testid="stop-button"]'),
        () => {
          // Check if the last message has the streaming class
          const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
          if (messages.length === 0) return false;
          const last = messages[messages.length - 1];
          return last.closest('[data-testid]')?.querySelector('.result-streaming') !== null;
        },
      ],

      completionIndicators: [
        () => {
          const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
          if (messages.length === 0) return false;
          const last = messages[messages.length - 1];
          // Copy button appears when done
          return !!last.closest('.group')?.querySelector('button[aria-label*="Copy" i]');
        },
      ],

      getLatestResponse: () => {
        const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
        return messages.length > 0 ? messages[messages.length - 1] : null;
      },

      stabilityDelay: 1000,
    },


    // ── Anthropic Claude ──────────────────────────────────────────
    'claude.ai': {
      name: 'Claude',

      responseContainerSelector: [
        '[data-testid="assistant-message"]',
        '.assistant-message',
        '.claude-response',
        '[class*="AssistantMessage"]',
      ],

      inputSelector: [
        '[contenteditable="true"][aria-label*="Message" i]',
        '.ProseMirror[contenteditable="true"]',
        'textarea[placeholder*="Message" i]',
        '[data-testid="composer-input"]',
      ],

      submitSelector: [
        'button[aria-label*="Send" i]',
        'button[data-testid="composer-send-button"]',
        'form button[type="submit"]',
      ],

      streamingIndicators: [
        () => !!document.querySelector('button[aria-label*="Stop" i]:not([disabled])'),
        () => !!document.querySelector('[data-is-streaming="true"]'),
        () => !!document.querySelector('.is-streaming'),
      ],

      completionIndicators: [
        () => {
          const messages = document.querySelectorAll('[data-testid="assistant-message"], .assistant-message');
          if (messages.length === 0) return false;
          const last = messages[messages.length - 1];
          return !!last.querySelector('button[aria-label*="Copy" i]');
        },
      ],

      getLatestResponse: () => {
        const selectors = [
          '[data-testid="assistant-message"]',
          '.assistant-message',
          '[class*="AssistantMessage"]',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) return els[els.length - 1];
        }
        return null;
      },

      stabilityDelay: 1000,
    },


    // ── Microsoft Copilot ─────────────────────────────────────────
    'copilot.microsoft.com': {
      name: 'Copilot',
      aliases: ['www.bing.com/chat'],

      responseContainerSelector: [
        '[data-content="ai-message"]',
        '.response-message-group',
        'cib-message[type="bot"]',
      ],

      inputSelector: [
        '#searchbox',
        'textarea[name="q"]',
        '[aria-label*="Ask" i]',
      ],

      submitSelector: [
        'button[aria-label*="Submit" i]',
        'button[type="submit"]',
      ],

      streamingIndicators: [
        () => !!document.querySelector('.typing-indicator'),
        () => !!document.querySelector('[data-streaming]'),
      ],

      completionIndicators: [
        () => !!document.querySelector('.response-complete'),
      ],

      getLatestResponse: () => {
        const els = document.querySelectorAll('[data-content="ai-message"], cib-message[type="bot"]');
        return els.length > 0 ? els[els.length - 1] : null;
      },

      stabilityDelay: 1500,
    },


    // ── Perplexity ────────────────────────────────────────────────
    'www.perplexity.ai': {
      name: 'Perplexity',

      responseContainerSelector: [
        '[data-testid="answer-content"]',
        '.prose.max-w-full',
        '.answer-text',
      ],

      inputSelector: [
        'textarea[placeholder*="Ask" i]',
        '[contenteditable="true"]',
      ],

      submitSelector: [
        'button[aria-label*="Submit" i]',
        'button[type="submit"]',
      ],

      streamingIndicators: [
        () => !!document.querySelector('.animate-pulse'),
        () => !!document.querySelector('[data-loading="true"]'),
      ],

      completionIndicators: [],

      getLatestResponse: () => {
        const els = document.querySelectorAll('[data-testid="answer-content"], .prose.max-w-full');
        return els.length > 0 ? els[els.length - 1] : null;
      },

      stabilityDelay: 2000,
    },
  };


  // ══════════════════════════════════════════════════════════════════
  //  RESPONSE DETECTOR
  // ══════════════════════════════════════════════════════════════════

  const ResponseDetector = {
    _currentConfig: null,
    _observer: null,
    _lastResponseText: '',
    _lastChangeTime: 0,
    _stabilityTimer: null,

    /**
     * Initialize detector for the current site.
     * Call this once when content script loads.
     */
    init() {
      this._currentConfig = this._getConfigForCurrentSite();

      if (this._currentConfig) {
        console.log(`[ResponseDetector] Initialized for ${this._currentConfig.name}`);
      } else {
        console.log('[ResponseDetector] No site config found, using generic detection');
      }

      return this._currentConfig;
    },

    /**
     * Get the configuration for the current site.
     */
    _getConfigForCurrentSite() {
      const hostname = window.location.hostname;

      // Direct match
      if (SITE_CONFIGS[hostname]) {
        return SITE_CONFIGS[hostname];
      }

      // Check aliases
      for (const [key, config] of Object.entries(SITE_CONFIGS)) {
        if (config.aliases?.includes(hostname)) {
          return config;
        }
      }

      // Partial match (subdomain)
      for (const [key, config] of Object.entries(SITE_CONFIGS)) {
        if (hostname.includes(key.replace('www.', ''))) {
          return config;
        }
      }

      return null;
    },

    /**
     * Get site-specific configuration.
     * Returns config object or null if site not recognized.
     */
    getConfig() {
      return this._currentConfig;
    },

    /**
     * Check if AI is currently generating a response.
     * @returns {boolean}
     */
    isStreaming() {
      const config = this._currentConfig;

      if (!config) {
        return this._genericStreamingCheck();
      }

      // Check all streaming indicators for this site
      for (const indicator of config.streamingIndicators || []) {
        try {
          if (typeof indicator === 'function' && indicator()) {
            return true;
          }
        } catch (e) {
          // Indicator failed, continue checking others
        }
      }

      return false;
    },

    /**
     * Check if the latest response appears complete.
     * @returns {boolean}
     */
    isComplete() {
      const config = this._currentConfig;

      if (!config) {
        return this._genericCompletionCheck();
      }

      // Not complete if still streaming
      if (this.isStreaming()) {
        return false;
      }

      // Check completion indicators
      for (const indicator of config.completionIndicators || []) {
        try {
          if (typeof indicator === 'function' && indicator()) {
            return true;
          }
        } catch (e) {
          // Indicator failed, continue
        }
      }

      // Fallback: assume complete if not streaming and response exists
      return this.getLatestResponse() !== null;
    },

    /**
     * Get the latest AI response element.
     * @returns {HTMLElement|null}
     */
    getLatestResponse() {
      const config = this._currentConfig;

      if (config?.getLatestResponse) {
        try {
          return config.getLatestResponse();
        } catch (e) {
          console.warn('[ResponseDetector] getLatestResponse failed:', e);
        }
      }

      // Generic fallback: try common selectors
      return this._genericFindLatestResponse();
    },

    /**
     * Get the response text content.
     * @returns {string}
     */
    getLatestResponseText() {
      const el = this.getLatestResponse();
      if (!el) return '';

      // Try to get just the text, excluding UI elements
      const clone = el.cloneNode(true);

      // Remove buttons, toolbars, etc.
      clone.querySelectorAll('button, [role="toolbar"], .toolbar, .actions').forEach((n) => n.remove());

      return (clone.textContent || '').trim();
    },

    /**
     * Find an element using site-specific selectors.
     * @param {string} selectorType - 'input', 'submit', or 'response'
     * @returns {HTMLElement|null}
     */
    findElement(selectorType) {
      const config = this._currentConfig;
      if (!config) return null;

      let selectors;
      switch (selectorType) {
        case 'input':
          selectors = config.inputSelector;
          break;
        case 'submit':
          selectors = config.submitSelector;
          break;
        case 'response':
          selectors = config.responseContainerSelector;
          break;
        default:
          return null;
      }

      if (!selectors) return null;

      // Try each selector
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && this._isVisible(el)) {
            return el;
          }
        } catch (e) {
          // Invalid selector, try next
        }
      }

      return null;
    },

    /**
     * Wait for AI response to complete.
     * Resolves when response is done streaming.
     *
     * @param {object} options
     * @param {number} options.timeout - Max wait time in ms (default 120000)
     * @param {number} options.pollInterval - Check interval in ms (default 500)
     * @param {function} options.onProgress - Called with response text during streaming
     * @returns {Promise<{element: HTMLElement, text: string, duration: number}>}
     */
    waitForResponse(options = {}) {
      const {
        timeout = 120000,
        pollInterval = 500,
        onProgress = null,
      } = options;

      const config = this._currentConfig;
      const stabilityDelay = config?.stabilityDelay || 1500;

      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let lastText = '';
        let lastChangeTime = Date.now();
        let resolved = false;

        const cleanup = () => {
          resolved = true;
          if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
          }
        };

        const checkComplete = () => {
          if (resolved) return;

          const now = Date.now();
          const elapsed = now - startTime;

          // Timeout check
          if (elapsed > timeout) {
            cleanup();
            reject(new Error(`Response timeout after ${timeout}ms`));
            return;
          }

          const responseEl = this.getLatestResponse();
          const currentText = this.getLatestResponseText();
          const streaming = this.isStreaming();

          // Progress callback
          if (onProgress && currentText !== lastText) {
            onProgress(currentText);
          }

          // Track text changes
          if (currentText !== lastText) {
            lastText = currentText;
            lastChangeTime = now;
          }

          // Check if complete
          const timeSinceChange = now - lastChangeTime;
          const isStable = timeSinceChange >= stabilityDelay;

          if (!streaming && responseEl && currentText && isStable) {
            cleanup();
            resolve({
              element: responseEl,
              text: currentText,
              duration: elapsed,
            });
            return;
          }

          // Continue polling
          setTimeout(checkComplete, pollInterval);
        };

        // Also watch DOM changes for faster detection
        this._observer = new MutationObserver(() => {
          // Reset stability timer on any DOM change in response area
          lastChangeTime = Date.now();
        });

        const responseContainer = this.getLatestResponse()?.parentElement || document.body;
        this._observer.observe(responseContainer, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        // Start polling
        checkComplete();
      });
    },


    // ── Generic Fallbacks (for unsupported sites) ─────────────────

    _genericStreamingCheck() {
      // Look for common streaming indicators
      const indicators = [
        '.loading', '.spinner', '.typing', '[aria-busy="true"]',
        'button[aria-label*="Stop" i]:not([disabled])',
        '.streaming', '.generating', '[data-loading]',
      ];

      for (const sel of indicators) {
        try {
          if (document.querySelector(sel)) return true;
        } catch {}
      }

      return false;
    },

    _genericCompletionCheck() {
      return !this._genericStreamingCheck();
    },

    _genericFindLatestResponse() {
      // Try common response container selectors
      const selectors = [
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '.assistant-message',
        '.ai-response',
        '.bot-message',
        '.response-content',
        '.markdown-body',
      ];

      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            return els[els.length - 1];
          }
        } catch {}
      }

      return null;
    },

    _isVisible(element) {
      if (!element || !element.isConnected) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' &&
             style.visibility !== 'hidden' &&
             style.opacity !== '0';
    },
  };


  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  root.PC.ResponseDetector = {
    /**
     * Initialize for current site.
     */
    init() {
      return ResponseDetector.init();
    },

    /**
     * Get site configuration (or null).
     */
    getConfig() {
      return ResponseDetector.getConfig();
    },

    /**
     * Get site name or 'Unknown'.
     */
    getSiteName() {
      return ResponseDetector.getConfig()?.name || 'Unknown';
    },

    /**
     * Check if AI is currently streaming.
     */
    isStreaming() {
      return ResponseDetector.isStreaming();
    },

    /**
     * Check if response is complete.
     */
    isComplete() {
      return ResponseDetector.isComplete();
    },

    /**
     * Get latest response element.
     */
    getLatestResponse() {
      return ResponseDetector.getLatestResponse();
    },

    /**
     * Get latest response text.
     */
    getLatestResponseText() {
      return ResponseDetector.getLatestResponseText();
    },

    /**
     * Find site-specific element.
     * @param {'input'|'submit'|'response'} type
     */
    findElement(type) {
      return ResponseDetector.findElement(type);
    },

    /**
     * Wait for response to complete.
     * @param {object} options - { timeout, pollInterval, onProgress }
     * @returns {Promise<{element, text, duration}>}
     */
    waitForResponse(options) {
      return ResponseDetector.waitForResponse(options);
    },

    /**
     * Get all supported site hostnames.
     */
    getSupportedSites() {
      const sites = [];
      for (const [hostname, config] of Object.entries(SITE_CONFIGS)) {
        sites.push({
          hostname,
          name: config.name,
          aliases: config.aliases || [],
        });
      }
      return sites;
    },

    /**
     * Check if current site is supported.
     */
    isSupportedSite() {
      return ResponseDetector.getConfig() !== null;
    },
  };

})();