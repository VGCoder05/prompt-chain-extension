/**
 * content/main.js
 * ────────────────────────────────────────────
 * Entry point for all content script modules.
 * Loaded LAST in the manifest.json content_scripts "js" array.
 *
 * Responsibilities:
 *   1. Verify all modules loaded
 *   2. Collect _messageHandlers from each module and register them
 *   3. Provide debug bridge for DevTools Console testing
 *   4. Run self-test on demo site
 *
 * Load order (manifest.json):
 *   1. lib/constants.js
 *   2. lib/utils.js
 *   3. lib/messages.js
 *   4. lib/storage.js
 *   5. lib/logger.js
 *   6. content/selectorEngine.js
 *   7. content/recorder.js
 *   8. content/replayer.js
 *   9. content/completionDetector.js
 *  10. content/healthChecker.js
 *  11. content/main.js  ← this file
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
    'Replayer',
    'CompletionDetector',
    'HealthChecker',
    'ExtraAction',
    'ChainRunner',
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
    `Modules: ${requiredModules.join(', ')}`
  );


  // ══════════════════════════════════════════════════════════════════
  //  MESSAGE ROUTER
  //  Collects _messageHandlers from all modules, plus any handlers
  //  registered dynamically via registerHandlers().
  // ══════════════════════════════════════════════════════════════════

  const MSG = PC.MessageTypes;
  const _handlers = {};

  function registerHandlers(handlers) {
    Object.assign(_handlers, handlers);
    console.log(
      `[PC Content] Registered handlers: ${Object.keys(handlers).join(', ')}`
    );
  }

  // Collect handlers from all modules that expose _messageHandlers
  const modulesWithHandlers = [
    PC.Recorder,
    PC.ChainRunner,
  ];

  for (const mod of modulesWithHandlers) {
    if (mod && mod._messageHandlers) {
      registerHandlers(mod._messageHandlers);
    }
  }

  // Set up the Chrome message listener
  PC.Messages.listen(
    new Proxy(_handlers, {
      get(target, prop) {
        return target[prop];
      },
    })
  );

  // Register built-in handlers (health check via message)
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


  // ══════════════════════════════════════════════════════════════════
  //  CONTENT API — exposed for other modules and debug bridge
  // ══════════════════════════════════════════════════════════════════

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


  // ══════════════════════════════════════════════════════════════════
  //  DEBUG BRIDGE
  //
  //  Usage from DevTools Console:
  //    window.postMessage({ type:'PC_DEBUG', action:'<cmd>', ...opts }, '*')
  //
  //  Commands:
  //    fingerprint       — { selector: '#foo' }
  //    find              — { fingerprint: {...} }
  //    healthCheck       — { fingerprint: {...} }
  //    selfTest
  //    startRecording    — { name: 'optional name' }
  //    cancelRecording
  //    listRecipes
  //    listChains
  //    listLogs          — { limit: 20 }
  //    clearAll
  //    inject            — { text: 'hello' }
  //    send
  //    injectAndSend     — { text: 'hello' }
  //    waitForCompletion
  //    healthCheckRecipe
  //    fullReplayTest    — { text: 'test prompt' }
  // ══════════════════════════════════════════════════════════════════

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'PC_DEBUG') return;

    const { action, selector, fingerprint } = event.data;

    switch (action) {

      // ── Selector Engine ───────────────────────────────────────

      case 'fingerprint': {
        if (!selector) { console.warn('[PC Debug] Provide "selector"'); return; }
        const el = document.querySelector(selector);
        if (!el) { console.warn(`[PC Debug] Not found: ${selector}`); return; }
        const fp = PC.SelectorEngine.fingerprint(el);
        console.log('[PC Debug] Fingerprint:');
        console.log(JSON.stringify(fp, null, 2));
        break;
      }

      case 'find': {
        if (!fingerprint) { console.warn('[PC Debug] Provide "fingerprint"'); return; }
        const match = PC.SelectorEngine.find(fingerprint);
        if (match) {
          console.log(
            `[PC Debug] ✅ Found — confidence: ${match.confidence.toFixed(2)}, method: ${match.method}`
          );
          console.log('[PC Debug] Element:', match.element);
        } else {
          console.log('[PC Debug] ❌ NOT FOUND');
        }
        break;
      }

      case 'healthCheck': {
        if (!fingerprint) { console.warn('[PC Debug] Provide "fingerprint"'); return; }
        const h = PC.SelectorEngine.checkHealth(fingerprint);
        const ic = h.status === 'healthy' ? '✅' : h.status === 'degraded' ? '⚠️' : '❌';
        console.log(`[PC Debug] Health: ${ic} ${h.status} (${h.confidence.toFixed(2)})`);
        break;
      }

      case 'selfTest': {
        _runSelfTest();
        break;
      }

      // ── Recorder ──────────────────────────────────────────────

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

      // ── Data Listing ──────────────────────────────────────────

      case 'listRecipes': {
        PC.Storage.recipes.getAll().then((recipes) => {
          if (recipes.length === 0) {
            console.log('[PC Debug] No recipes saved');
          } else {
            console.log(`[PC Debug] ${recipes.length} recipe(s):`);
            recipes.forEach((r, i) => {
              const elCount = Object.values(r.elements || {}).filter(Boolean).length;
              console.log(
                `  ${i + 1}. "${r.name}" — ${r.domain} — ${elCount}/4 elements — health: ${r.healthStatus || '?'}`
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
            console.log('[PC Debug] No chains saved');
          } else {
            console.log(`[PC Debug] ${chains.length} chain(s):`);
            chains.forEach((c, i) => {
              console.log(
                `  ${i + 1}. "${c.name}" — ${c.prompts?.length || 0} prompts — recipe: ${c.recipeId || 'none'}`
              );
            });
            console.log('[PC Debug] Full data:', JSON.stringify(chains, null, 2));
          }
        });
        break;
      }

      case 'listLogs': {
        PC.Storage.logs.getFiltered({ limit: event.data.limit || 20 }).then((logs) => {
          if (logs.length === 0) {
            console.log('[PC Debug] No logs');
          } else {
            console.log(`[PC Debug] Last ${logs.length} log(s):`);
            logs.forEach((l) => {
              const ic = l.status === 'success' ? '✅' :
                l.status === 'failed' ? '❌' :
                  l.status === 'retrying' ? '🔄' : 'ℹ️';
              console.log(`  ${ic} [${l.timestamp}] ${l.action} (${l.status})`, l.details || '');
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

      // ── Replayer ──────────────────────────────────────────────

      case 'inject': {
        const txt = event.data.text || 'Hello, this is a test injection!';
        _withRecipe(async (recipe) => {
          const result = await PC.Replayer.injectText(recipe.elements.targetInput, txt);
          console.log('[PC Debug] Inject result:', result);
        });
        break;
      }

      case 'send': {
        _withRecipe(async (recipe) => {
          const result = await PC.Replayer.clickSend(
            recipe.elements.sendTrigger,
            recipe.elements.targetInput
          );
          console.log('[PC Debug] Send result:', result);
        });
        break;
      }

      case 'injectAndSend': {
        const txt = event.data.text || 'Hello, this is a test message!';
        _withRecipe(async (recipe) => {
          const inj = await PC.Replayer.injectText(recipe.elements.targetInput, txt);
          console.log('[PC Debug] Inject:', inj);
          if (inj.success) {
            await PC.Utils.sleep(300);
            const snd = await PC.Replayer.clickSend(recipe.elements.sendTrigger, recipe.elements.targetInput);
            console.log('[PC Debug] Send:', snd);
          }
        });
        break;
      }

      case 'waitForCompletion': {
        _withRecipe(async (recipe) => {
          console.log('[PC Debug] ⏳ Waiting for completion...');
          const result = await PC.CompletionDetector.waitForCompletion(
            recipe.elements.completionSignal,
            { maxWaitTime: 60000 }
          );
          console.log('[PC Debug] Completion:', result);
        });
        break;
      }

      case 'healthCheckRecipe': {
        _withRecipe((recipe) => {
          console.log(`[PC Debug] Health check for "${recipe.name}"...`);
          const report = PC.HealthChecker.check(recipe);
          console.log('[PC Debug] Report:', JSON.stringify(report, null, 2));
        });
        break;
      }

      case 'fullReplayTest': {
        const txt = event.data.text || 'This is a full replay test. Please respond briefly.';
        _withRecipe(async (recipe) => {
          console.log('[PC Debug] 🚀 Full replay test...');

          console.log('  Step 1: Health check');
          const health = PC.HealthChecker.check(recipe);
          if (!health.canRun) {
            console.error('  ❌ Health check failed — re-record the recipe');
            return;
          }

          console.log('  Step 2: Inject');
          const inj = await PC.Replayer.injectText(recipe.elements.targetInput, txt);
          if (!inj.success) { console.error('  ❌ Inject failed:', inj.error); return; }

          console.log('  Step 3: Send');
          await PC.Utils.sleep(300);
          const snd = await PC.Replayer.clickSend(recipe.elements.sendTrigger, recipe.elements.targetInput);
          if (!snd.success) { console.error('  ❌ Send failed:', snd.error); return; }

          console.log('  Step 4: Wait for completion');
          await PC.Utils.sleep(1000);
          const comp = await PC.CompletionDetector.waitForCompletion(
            recipe.elements.completionSignal,
            { maxWaitTime: 120000 }
          );
          if (comp.completed) {
            console.log(
              `  ✅ PASSED — ${comp.method} in ${PC.Utils.formatDuration(comp.duration)}`
            );
          } else {
            console.warn(`  ⚠️ Completion ${comp.timedOut ? 'timed out' : 'failed'}`);
          }
        });
        break;
      }

        // ── Chain Runner Commands ────────────────────────────────

      case 'runChain': {
        // Quick-run: create a temporary chain and execute
        const prompts = event.data.prompts;
        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
          console.warn('[PC Debug] Provide "prompts" array, e.g., ["prompt 1", "prompt 2"]');
          return;
        }

        _withRecipe(async (recipe) => {
          // Create a temporary chain
          const chain = await PC.Storage.chains.add({
            name: event.data.name || `Debug Chain ${new Date().toLocaleTimeString()}`,
            recipeId: recipe.id,
            prompts: prompts,
          });

          console.log(`[PC Debug] 🚀 Running chain "${chain.name}" (${prompts.length} prompts)...`);

          const result = await PC.ChainRunner.run({ recipe, chain });
          console.log('[PC Debug] Chain result:', JSON.stringify(result, null, 2));
        });
        break;
      }

      case 'pauseChain': {
        PC.ChainRunner.pause();
        console.log('[PC Debug] Chain paused');
        break;
      }

      case 'resumeChain': {
        PC.ChainRunner.resume();
        console.log('[PC Debug] Chain resumed');
        break;
      }

      case 'cancelChain': {
        PC.ChainRunner.cancel();
        console.log('[PC Debug] Chain cancelled');
        break;
      }

      case 'chainStatus': {
        const status = PC.ChainRunner.getStatus();
        console.log('[PC Debug] Chain status:', JSON.stringify(status, null, 2));
        break;
      }

     default:
        console.warn(
          `[PC Debug] Unknown: "${action}". Available:\n` +
          '  Selector: fingerprint, find, healthCheck, selfTest\n' +
          '  Recorder: startRecording, cancelRecording\n' +
          '  Data: listRecipes, listChains, listLogs, clearAll\n' +
          '  Replayer: inject, send, injectAndSend, waitForCompletion\n' +
          '  Health: healthCheckRecipe\n' +
          '  Chain: runChain, pauseChain, resumeChain, cancelChain, chainStatus\n' +
          '  Full: fullReplayTest'
        );
    }
  });

  /**
   * Helper: get the recipe for the current domain, then call fn.
   */
  async function _withRecipe(fn) {
    const recipe = await PC.Storage.recipes.getByDomain(window.location.hostname);
    if (!recipe) {
      console.warn('[PC Debug] No recipe for this domain. Record one first: startRecording');
      return;
    }
    return fn(recipe);
  }


  // ── Self-Test ───────────────────────────────────────────────────

  function _runSelfTest() {
    const selectors = [
      '#promptTextarea', '#sendButton', '#stopButton',
      'textarea', '[contenteditable="true"]', 'button[aria-label]',
    ];

    let found = 0;
    let tested = 0;

    console.log('[PC SelfTest] ── Running ──');

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      tested++;
      const fp = PC.SelectorEngine.fingerprint(el);
      const match = PC.SelectorEngine.find(fp);
      const same = match && match.element === el;

      console.log(
        `  ${sel}: ${same ? '✅' : match ? '⚠️' : '❌'} ` +
        `best="${fp.bestSelector}" → ` +
        (match
          ? `conf=${match.confidence.toFixed(2)}, method=${match.method}, same=${same}`
          : 'NOT FOUND')
      );

      if (same) found++;
    }

    console.log(`[PC SelfTest] ══ ${found}/${tested} passed ══`);
  }

  // Auto self-test on demo site
  if (document.getElementById('promptTextarea') && document.getElementById('sendButton')) {
    console.log('[PC Content] Demo site detected — self-test...');
    setTimeout(_runSelfTest, 500);
  }

})();