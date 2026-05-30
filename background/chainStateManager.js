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
 * Save a snapshot of the active macro/workflow execution state.
 * Called whenever a status update arrives from the content script.
 *
 * State Schema:
 *   - workflowId: string
 *   - workflowName: string
 *   - steps: array of step objects
 *   - currentStepIndex: number (0-based)
 *   - variables: object (e.g. { USER_PROMPT: "..." })
 *   - status: 'starting' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed'
 *   - tabId: number
 *   - tabUrl: string
 *   - startedAt: ISO timestamp
 *   - savedAt: ISO timestamp (auto-added)
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

    /**
 * Get the current step being executed.
 * Returns null if no chain is active or index is invalid.
 */
    async getCurrentStep() {
      const state = await this.get();
      if (!state || !state.steps) return null;

      const index = state.currentStepIndex || 0;
      return state.steps[index] || null;
    },

    /**
     * Get the next step to execute.
     * Returns null if we're at the end.
     */
    async getNextStep() {
      const state = await this.get();
      if (!state || !state.steps) return null;

      const nextIndex = (state.currentStepIndex || 0) + 1;
      return state.steps[nextIndex] || null;
    },

    /**
     * Increment the step index.
     * Returns the new index, or null if we're at the end.
     */
    async incrementStep() {
      const state = await this.get();
      if (!state || !state.steps) return null;

      const newIndex = (state.currentStepIndex || 0) + 1;

      if (newIndex >= state.steps.length) {
        return null; // End of workflow
      }

      await this.update({ currentStepIndex: newIndex });
      return newIndex;
    },

    /**
     * Interpolate variables in a step's value field.
     * Replaces {{VARIABLE_NAME}} with actual values.
     */
    interpolateStep(step, variables) {
      if (!step || !step.value || !variables) return step;

      const interpolated = { ...step };

      // Replace variables in the value field
      interpolated.value = step.value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        if (variables.hasOwnProperty(varName)) {
          return variables[varName];
        }
        console.warn(`[ChainStateManager] Variable {{${varName}}} not found in:`, variables);
        return match; // Leave unreplaced if not found
      });

      return interpolated;
    },
  };
})();