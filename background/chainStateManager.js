/**
 * background/chainStateManager.js
 * ────────────────────────────────────────────
 * Persists active chain execution state in chrome.storage.session.
 * This allows recovery if the service worker restarts mid-chain.
 *
 * The content script is the actual executor — it continues running
 * regardless of the service worker state. This module tracks
 * the chain status so the popup/sidepanel can reconnect.
 *
 * Dependencies:
 *   - PC.Constants
 *   - PC.Utils
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const KEY = PC.Constants.STORAGE_KEYS.ACTIVE_CHAIN_STATE;

  root.PC.ChainStateManager = {

    /**
     * Save a snapshot of the active chain state.
     * Called whenever a status update arrives from the content script.
     */
    async save(state) {
      try {
        await chrome.storage.session.set({
          [KEY]: {
            ...state,
            savedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        console.warn('[ChainStateManager] Failed to save state:', err.message);
      }
    },

    /**
     * Get the current active chain state.
     * Returns null if no chain is active.
     */
    async get() {
      try {
        const result = await chrome.storage.session.get(KEY);
        return result[KEY] || null;
      } catch (err) {
        console.warn('[ChainStateManager] Failed to get state:', err.message);
        return null;
      }
    },

    /**
     * Clear the active chain state (chain completed/cancelled/failed).
     */
    async clear() {
      try {
        await chrome.storage.session.remove(KEY);
      } catch (err) {
        console.warn('[ChainStateManager] Failed to clear state:', err.message);
      }
    },

    /**
     * Update specific fields in the current state without overwriting all.
     */
    async update(updates) {
      const current = await this.get();
      if (!current) return;
      await this.save({ ...current, ...updates });
    },
  };
})();