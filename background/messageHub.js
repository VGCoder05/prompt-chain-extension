/**
 * background/messageHub.js
 * ────────────────────────────────────────────
 * Central message router for the extension.
 * Routes messages between:
 *   - Popup / SidePanel / Dashboard → Content Script
 *   - Content Script → Popup / SidePanel / Dashboard
 *
 * Also persists chain state on every status update
 * and sends browser notifications on chain completion/failure.
 *
 * Dependencies:
 *   - PC.Constants
 *   - PC.Messages (for MessageTypes)
 *   - PC.ChainStateManager
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const MSG = PC.MessageTypes;
  const STATES = PC.Constants.CHAIN_STATES;

  // Track which tab is running a chain
  let _activeTabId = null;

  root.PC.MessageHub = {

    /**
     * Initialize the message hub.
     * Call this once from service-worker.js.
     */
    init() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Route based on message type
        const handler = this._getHandler(message, sender);

        if (!handler) return; // Not a message we handle

        const result = handler(message, sender, sendResponse);

        // If handler returns a Promise, keep the channel open
        if (result instanceof Promise) {
          result
            .then((res) => sendResponse(res))
            .catch((err) => sendResponse({ error: err.message }));
          return true;
        }

        if (result !== undefined) {
          sendResponse(result);
        }
      });

      console.log('[MessageHub] ✅ Initialized');
    },

    /**
     * Determine the correct handler for a message.
     */
    _getHandler(message, sender) {
      switch (message.type) {

        // ── Commands FROM popup/sidepanel/dashboard → content script ──

        case MSG.START_RECORDING:
        case MSG.CANCEL_RECORDING:
        case MSG.GET_RECORDING_STATUS:
        case MSG.CHECK_HEALTH:
          return (msg, snd, respond) => this._forwardToActiveTab(msg, respond);

        case MSG.RUN_CHAIN:
          return (msg, snd, respond) => this._handleRunChain(msg, respond);

        case MSG.PAUSE_CHAIN:
        case MSG.RESUME_CHAIN:
        case MSG.CANCEL_CHAIN:
        case MSG.SKIP_STEP:
        case MSG.GET_CHAIN_STATUS:
          return (msg, snd, respond) => this._forwardToChainTab(msg, respond);

        // ── Status updates FROM content script → background + UI ──

        case MSG.CHAIN_STARTED:
        case MSG.CHAIN_COMPLETED:
        case MSG.CHAIN_FAILED:
        case MSG.CHAIN_PAUSED:
        case MSG.CHAIN_RESUMED:
        case MSG.CHAIN_CANCELLED:
        case MSG.STEP_STARTED:
        case MSG.STEP_COMPLETED:
        case MSG.STEP_FAILED:
        case MSG.STEP_RETRYING:
        case MSG.STEP_SKIPPED:
        case MSG.RESPONSE_TIMEOUT:
        case MSG.USER_INTERFERENCE:
          return (msg, snd) => this._handleChainStatus(msg, snd);

        // ── Recording status FROM content script ──

        case MSG.RECORDING_STEP:
        case MSG.RECORDING_COMPLETE:
        case MSG.RECORDING_CANCELLED:
          return (msg, snd) => this._handleRecordingStatus(msg, snd);

        // ── Navigation commands ──

        case MSG.OPEN_DASHBOARD:
          return () => this._openDashboard();

        case MSG.OPEN_SIDEPANEL:
          return () => this._openSidePanel();

        default:
          return null;
      }
    },


    // ══════════════════════════════════════════════════════════════
    //  FORWARDING TO CONTENT SCRIPTS
    // ══════════════════════════════════════════════════════════════

    /**
     * Forward a message to the currently active tab's content script.
     */
    async _forwardToActiveTab(message, sendResponse) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          sendResponse({ error: 'No active tab' });
          return;
        }

        const response = await chrome.tabs.sendMessage(tab.id, message);
        sendResponse(response);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    },

    /**
     * Forward a chain control message to the tab running the chain.
     */
    async _forwardToChainTab(message, sendResponse) {
      const tabId = _activeTabId;

      if (!tabId) {
        // Try to get from stored state
        const state = await PC.ChainStateManager.get();
        if (state?.tabId) {
          _activeTabId = state.tabId;
        } else {
          sendResponse({ error: 'No active chain tab' });
          return;
        }
      }

      try {
        const response = await chrome.tabs.sendMessage(_activeTabId, message);
        sendResponse(response);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    },


    // ══════════════════════════════════════════════════════════════
    //  CHAIN COMMANDS
    // ══════════════════════════════════════════════════════════════

    /**
     * Handle RUN_CHAIN: find the active tab, save state, forward.
     */
    async _handleRunChain(message, sendResponse) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          sendResponse({ error: 'No active tab' });
          return;
        }

        _activeTabId = tab.id;

        // Save initial chain state
        await PC.ChainStateManager.save({
          tabId: tab.id,
          tabUrl: tab.url,
          chainId: message.chainId,
          recipeId: message.recipeId,
          status: 'starting',
          currentStep: 0,
          startedAt: new Date().toISOString(),
        });

        // Forward to content script
        const response = await chrome.tabs.sendMessage(tab.id, message);
        sendResponse(response);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    },


    // ══════════════════════════════════════════════════════════════
    //  STATUS UPDATES (from content script)
    // ══════════════════════════════════════════════════════════════

    /**
     * Handle chain status updates from the content script.
     * Persists state + sends notifications + broadcasts to all extension UIs.
     */
    async _handleChainStatus(message, sender) {
      // Track which tab is running
      if (sender.tab) {
        _activeTabId = sender.tab.id;
      }

      // Persist state
      await PC.ChainStateManager.update({
        tabId: sender.tab?.id,
        status: message.state,
        currentStep: message.currentIndex,
        lastUpdate: message.type,
        updatedAt: new Date().toISOString(),
      });

      // Handle terminal states
      if (message.type === MSG.CHAIN_COMPLETED) {
        this._showNotification(
          '🎉 Chain Complete!',
          `All ${message.total} prompts executed. ` +
          `${message.success} succeeded, ${message.failed} failed. ` +
          `Duration: ${PC.Utils.formatDuration(message.duration)}`
        );
        _activeTabId = null;
        await PC.ChainStateManager.clear();
      }

      if (message.type === MSG.CHAIN_FAILED) {
        this._showNotification(
          '❌ Chain Failed',
          `Error: ${message.error}`
        );
        _activeTabId = null;
        await PC.ChainStateManager.clear();
      }

      if (message.type === MSG.CHAIN_CANCELLED) {
        _activeTabId = null;
        await PC.ChainStateManager.clear();
      }

      // Broadcast to all extension UIs (popup, sidepanel, dashboard)
      // They may or may not be open — errors are caught silently by PC.Messages.send
      this._broadcastToExtensionUIs(message);
    },

    /**
     * Handle recording status updates from content script.
     * Just broadcast to popup/sidepanel.
     */
    _handleRecordingStatus(message, sender) {
      this._broadcastToExtensionUIs(message);
    },


    // ══════════════════════════════════════════════════════════════
    //  BROADCASTING & NOTIFICATIONS
    // ══════════════════════════════════════════════════════════════

    /**
     * Broadcast a message to all extension contexts (popup, sidepanel, dashboard tabs).
     * Uses chrome.runtime.sendMessage which reaches all extension pages.
     */
    _broadcastToExtensionUIs(message) {
      // chrome.runtime.sendMessage sends to all extension contexts
      // EXCEPT the sender (which is the content script).
      // This reaches popup, sidepanel, and dashboard tabs.
      chrome.runtime.sendMessage(message).catch(() => {
        // No extension UI is open — that's fine
      });
    },

    /**
     * Show a browser notification.
     */
    _showNotification(title, body) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icon-128.png'),
        title,
        message: body,
      }).catch(() => {
        // Notification permission might not be granted
        console.log(`[MessageHub] Notification: ${title} — ${body}`);
      });
    },


    // ══════════════════════════════════════════════════════════════
    //  NAVIGATION
    // ══════════════════════════════════════════════════════════════

    _openDashboard() {
      const url = chrome.runtime.getURL('dashboard/dashboard.html');
      chrome.tabs.create({ url });
    },

    async _openSidePanel() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.sidePanel.open({ tabId: tab.id });
        }
      } catch (err) {
        console.warn('[MessageHub] Failed to open side panel:', err.message);
      }
    },
  };
})();