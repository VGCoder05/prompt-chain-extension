/**
 * lib/utils.js
 * ────────────────────────────────────────────
 * Shared utility functions used across the extension.
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  root.PC.Utils = {

    /**
     * Generate a UUID v4 string.
     * Used for recipe IDs, chain IDs, log IDs, session IDs.
     */
    uuid() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },

    /**
     * Return current ISO timestamp string.
     */
    timestamp() {
      return new Date().toISOString();
    },

    /**
     * Sleep for a given number of milliseconds.
     * Returns a Promise that resolves after the delay.
     * Supports optional AbortSignal for cancellation.
     *
     * @param {number} ms - milliseconds to sleep
     * @param {AbortSignal} [signal] - optional abort signal
     */
    sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Sleep aborted'));
          }, { once: true });
        }
      });
    },

    /**
     * Sleep with random jitter applied.
     * Makes delays look more human/natural.
     *
     * @param {number} ms - base milliseconds
     * @param {number} [jitter] - max jitter in ms (applied as ±jitter)
     * @param {AbortSignal} [signal] - optional abort signal
     */
    jitteredSleep(ms, jitter, signal) {
      const j = jitter || PC.Constants.DEFAULT_SETTINGS.jitterMs;
      const actual = Math.max(50, ms + (Math.random() * j * 2 - j));
      return PC.Utils.sleep(actual, signal);
    },

    /**
     * Format a duration in ms to a human-readable string.
     * e.g., 65000 → "1m 5s", 800 → "0.8s"
     */
    formatDuration(ms) {
      if (ms < 1000) return `${ms}ms`;

      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;

      if (minutes === 0) return `${seconds}s`;
      return `${minutes}m ${remainingSeconds}s`;
    },

    /**
     * Deep clone a plain object/array using structuredClone or JSON fallback.
     */
    deepClone(obj) {
      if (typeof structuredClone === 'function') {
        return structuredClone(obj);
      }
      return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Safely get a nested property from an object.
     * e.g., safeGet(obj, 'a.b.c') returns obj.a.b.c or undefined
     */
    safeGet(obj, path) {
      return path.split('.').reduce((acc, key) => acc?.[key], obj);
    },

    /**
     * Truncate a string to maxLen chars, adding "..." if truncated.
     */
    truncate(str, maxLen = 50) {
      if (!str) return '';
      if (str.length <= maxLen) return str;
      return str.substring(0, maxLen) + '...';
    },
  };
})();