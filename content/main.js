/**
 * content/main.js
 * ────────────────────────────────────────────
 * Entry point for all content script modules.
 *
 * Modules loaded via manifest.json "js" array (in order):
 *   1. lib/constants.js
 *   2. lib/utils.js
 *   3. lib/messages.js
 *   4. lib/storage.js
 *   5. lib/logger.js
 *   6. content/selectorEngine.js
 *   7. content/recorder.js
 *   8. content/main.js  ← this file (loaded last)
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  // ── Verify all required modules loaded ──────────────────────────
  const requiredModules = [
    'Constants',
    'Utils',
    'Messages',
    'Storage',
    'Logger',
    'SelectorEngine',
    'Recorder',
  ];

  const missing = requiredModules.filter((m) => !root.PC[m]);
  if (missing.length > 0) {
    console.error(
      `[PC Content] Missing required modules: ${missing.join(', ')}. ` +
      'Check manifest.json content_scripts order.'
    );
    return;
  }

  console.log(
    `[PC Content] ✅ Initialized on ${window.location.hostname} — ` +
    `Modules loaded: ${requiredModules.join(', ')}`
  );


  // ══════════════════════════════════════════════════════════════════
  //  DEBUG BRIDGE
  //
  //  USAGE FROM DEVTOOLS CONSOLE:
  //
  //    // Fingerprint an element:
  //    window.postMessage({ type: 'PC_DEBUG', action: 'fingerprint', selector: '#promptTextarea' }, '*')
  //
  //    // Re-find using a fingerprint:
  //    window.postMessage({ type: 'PC_DEBUG', action: 'find', fingerprint: { ...fp } }, '*')
  //
  //    // Health check:
  //    window.postMessage({ type: 'PC_DEBUG', action: 'healthCheck', fingerprint: { ...fp } }, '*')
  //
  //    // Self-test:
  //    window.postMessage({ type: 'PC_DEBUG', action: 'selfTest' }, '*')
  //
  //    // ── NEW: Start recording wizard ──
  //    window.postMessage({ type: 'PC_DEBUG', action: 'startRecording' }, '*')
  //
  //    // ── NEW: Cancel recording ──
  //    window.postMessage({ type: 'PC_DEBUG', action: 'cancelRecording' }, '*')
  //
  //    // ── NEW: List all saved recipes ──
  //    window.postMessage({ type: 'PC_DEBUG', action: 'listRecipes' }, '*')
  //
  //    // ── NEW: Clear all data ──
  //    window.postMessage({ type: 'PC_DEBUG', action: 'clearAll' }, '*')
  //
  // ══════════════════════════════════════════════════════════════════

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'PC_DEBUG') return;

    const { action, selector, fingerprint } = event.data;

    switch (action) {

      case 'fingerprint': {
        if (!selector) {
          console.warn('[PC Debug] Provide a "selector" string');
          return;
        }
        const el = document.querySelector(selector);
        if (!el) {
          console.warn(`[PC Debug] No element found for: ${selector}`);
          return;
        }
        const fp = PC.SelectorEngine.fingerprint(el);
        console.log('[PC Debug] Fingerprint generated:');
        console.log(JSON.stringify(fp, null, 2));
        break;
      }

      case 'find': {
        if (!fingerprint) {
          console.warn('[PC Debug] Provide a "fingerprint" object');
          return;
        }
        const match = PC.SelectorEngine.find(fingerprint);
        if (match) {
          console.log(
            `[PC Debug] ✅ Found — confidence: ${match.confidence.toFixed(2)}, ` +
            `method: ${match.method}`
          );
          console.log('[PC Debug] Element:', match.element);
        } else {
          console.log('[PC Debug] ❌ NOT FOUND');
        }
        break;
      }

      case 'healthCheck': {
        if (!fingerprint) {
          console.warn('[PC Debug] Provide a "fingerprint" object');
          return;
        }
        const health = PC.SelectorEngine.checkHealth(fingerprint);
        const icon = health.status === 'healthy' ? '✅' :
                     health.status === 'degraded' ? '⚠️' : '❌';
        console.log(`[PC Debug] Health: ${icon} ${health.status} (${health.confidence.toFixed(2)})`);
        break;
      }

      case 'selfTest': {
        console.log('[PC Debug] ── Running Self-Test ──');
        _runSelfTest();
        break;
      }

      // ── Recorder Commands ─────────────────────────────────────

      case 'startRecording': {
        if (PC.Recorder.isActive) {
          console.warn('[PC Debug] Recording already in progress');
          return;
        }
        console.log('[PC Debug] 🎬 Starting recording wizard...');
        PC.Recorder.start(event.data.name).then((recipe) => {
          if (recipe) {
            console.log('[PC Debug] ✅ Recipe saved:', JSON.stringify(recipe, null, 2));
          } else {
            console.log('[PC Debug] Recording cancelled or failed');
          }
        });
        break;
      }

      case 'cancelRecording': {
        PC.Recorder.cancel();
        console.log('[PC Debug] Recording cancelled');
        break;
      }

      case 'listRecipes': {
        PC.Storage.recipes.getAll().then((recipes) => {
          if (recipes.length === 0) {
            console.log('[PC Debug] No recipes saved yet');
          } else {
            console.log(`[PC Debug] ${recipes.length} recipe(s):`);
            recipes.forEach((r, i) => {
              console.log(
                `  ${i + 1}. "${r.name}" — ${r.domain} — ` +
                `${Object.values(r.elements).filter(Boolean).length}/4 elements — ` +
                `health: ${r.healthStatus || 'unknown'}`
              );
            });
            console.log('[PC Debug] Full data:', JSON.stringify(recipes, null, 2));
          }
        });
        break;
      }

      case 'listChains': {
        PC.Storage.chains.getAll().then((chains) => {
          if (chains.length === 0) {
            console.log('[PC Debug] No chains saved yet');
          } else {
            console.log(`[PC Debug] ${chains.length} chain(s):`);
            chains.forEach((c, i) => {
              console.log(
                `  ${i + 1}. "${c.name}" — ${c.prompts?.length || 0} prompts — ` +
                `recipe: ${c.recipeId || 'none'}`
              );
            });
            console.log('[PC Debug] Full data:', JSON.stringify(chains, null, 2));
          }
        });
        break;
      }

      case 'listLogs': {
        const limit = event.data.limit || 20;
        PC.Storage.logs.getFiltered({ limit }).then((logs) => {
          if (logs.length === 0) {
            console.log('[PC Debug] No logs yet');
          } else {
            console.log(`[PC Debug] Last ${logs.length} log(s):`);
            logs.forEach((l) => {
              const icon = l.status === 'success' ? '✅' :
                           l.status === 'failed'  ? '❌' :
                           l.status === 'retrying' ? '🔄' : 'ℹ️';
              console.log(
                `  ${icon} [${l.timestamp}] ${l.action} (${l.status})`,
                l.details || ''
              );
            });
          }
        });
        break;
      }

      case 'clearAll': {
        Promise.all([
          chrome.storage.local.clear(),
          chrome.storage.session.clear(),
        ]).then(() => {
          console.log('[PC Debug] ✅ All data cleared');
        });
        break;
      }

      default:
        console.warn(`[PC Debug] Unknown action: "${action}". Available: ` +
          'fingerprint, find, healthCheck, selfTest, startRecording, ' +
          'cancelRecording, listRecipes, listChains, listLogs, clearAll');
    }
  });


  // ── Self-Test ───────────────────────────────────────────────────

  function _runSelfTest() {
    const testSelectors = [
      '#promptTextarea',
      '#sendButton',
      '#stopButton',
      'textarea',
      '[contenteditable="true"]',
      'button[aria-label]',
      '[role="textbox"]',
    ];

    let found = 0;
    let tested = 0;

    for (const sel of testSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      tested++;
      console.log(`\n[PC SelfTest] ── Testing: ${sel} ──`);

      const fp = PC.SelectorEngine.fingerprint(el);
      console.log(`  bestSelector: "${fp.bestSelector}"`);
      console.log(`  cssPath: "${fp.cssPath}"`);

      const match = PC.SelectorEngine.find(fp);
      if (match) {
        const same = match.element === el;
        console.log(
          `  Re-find: ${same ? '✅' : '⚠️'} confidence=${match.confidence.toFixed(2)}, ` +
          `method=${match.method}, sameElement=${same}`
        );
        if (same) found++;
      } else {
        console.log('  Re-find: ❌ NOT FOUND');
      }
    }

    console.log(
      `\n[PC SelfTest] ══ ${found}/${tested} elements round-tripped ══`
    );
  }

  // Auto self-test on demo site
  if (
    document.getElementById('promptTextarea') &&
    document.getElementById('sendButton')
  ) {
    console.log('[PC Content] Demo site detected — running self-test...');
    setTimeout(_runSelfTest, 500);
  }


  // ══════════════════════════════════════════════════════════════════
  //  MESSAGE ROUTER
  // ══════════════════════════════════════════════════════════════════

  const MSG = PC.MessageTypes;
  const _handlers = {};

  function registerHandlers(handlers) {
    Object.assign(_handlers, handlers);
    console.log(
      `[PC Content] Registered handlers: ${Object.keys(handlers).join(', ')}`
    );
  }

  PC.Messages.listen(
    new Proxy(_handlers, {
      get(target, prop) {
        return target[prop];
      },
    })
  );


  // ── Expose Content Script API ───────────────────────────────────

  root.PC.Content = {
    registerHandlers,

    getPageInfo() {
      return {
        hostname: window.location.hostname,
        pathname: window.location.pathname,
        url: window.location.href,
        title: document.title,
      };
    },
  };

  // ── Built-in handlers ───────────────────────────────────────────

  registerHandlers({
    [MSG.CHECK_HEALTH]: (message) => {
      const { fingerprints } = message;
      if (!fingerprints || typeof fingerprints !== 'object') {
        return { error: 'No fingerprints provided' };
      }
      const report = {};
      for (const [name, fp] of Object.entries(fingerprints)) {
        report[name] = PC.SelectorEngine.checkHealth(fp);
      }
      return { success: true, report };
    },
  });

})();