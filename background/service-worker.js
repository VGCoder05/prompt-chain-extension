/**
 * background/service-worker.js
 * ────────────────────────────────────────────
 * Entry point for the Manifest V3 background service worker.
 *
 * This is the coordinator — it routes messages, persists state,
 * and sends notifications. It does NOT touch any page DOM.
 *
 * Chrome may kill this worker at any time to save resources.
 * All important state is persisted in chrome.storage.session
 * so it can be recovered on restart.
 *
 * Import order matters — dependencies first, then modules that use them.
 */

// ── Load shared libraries ─────────────────────────────────────────
importScripts(
  '../lib/constants.js',
  '../lib/utils.js',
  '../lib/messages.js',
  '../lib/storage.js',
  '../lib/logger.js'
);

// ── Load background modules ───────────────────────────────────────
importScripts(
  './chainStateManager.js',
  './messageHub.js'
);

// ── Initialize ────────────────────────────────────────────────────
PC.MessageHub.init();

// ── Service Worker Lifecycle Events ───────────────────────────────

/**
 * Fires when the extension is first installed, updated,
 * or Chrome is updated.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[ServiceWorker] Installed — reason: ${details.reason}`);

  if (details.reason === 'install') {
    // First install: set default settings
    PC.Storage.settings.get().then((settings) => {
      console.log('[ServiceWorker] Default settings loaded:', settings);
    });
  }

  if (details.reason === 'update') {
    console.log(
      `[ServiceWorker] Updated from ${details.previousVersion} to ${chrome.runtime.getManifest().version}`
    );
  }
});

/**
 * Fires when the service worker starts up (after being killed).
 * Check if there was an active chain running.
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('[ServiceWorker] Browser started');

  // Check for abandoned chain state
  PC.ChainStateManager.get().then((state) => {
    if (state) {
      console.log(
        `[ServiceWorker] Found abandoned chain state: ` +
        `chain=${state.chainId}, tab=${state.tabId}, status=${state.status}`
      );
      // The content script in the tab may still be running.
      // We don't interfere — just log it.
      // The next status update from the content script will re-sync us.
    }
  });
});

/**
 * Detect when the tab running a chain is closed.
 * If so, clean up the chain state.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await PC.ChainStateManager.get();
  if (state && state.tabId === tabId) {
    console.log(`[ServiceWorker] Chain tab ${tabId} was closed — clearing state`);
    await PC.ChainStateManager.clear();
  }
});

/**
 * Keep-alive: Chrome may kill the service worker after ~30s of inactivity.
 * When a chain is running, the content script sends periodic status updates
 * which naturally keep the service worker alive.
 *
 * For extra safety, we check if a chain is active on wake-up.
 */

console.log('[ServiceWorker] ✅ Ready');