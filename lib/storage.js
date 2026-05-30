/**
 * lib/storage.js
 * ────────────────────────────────────────────
 * CRUD wrapper around chrome.storage.local.
 * Manages: recipes, prompt chains, activity logs, settings.
 *
 * All data is stored as JSON arrays/objects, structured
 * for direct MongoDB import in the future MERN conversion.
 *
 * Each record has: id, createdAt, updatedAt fields.
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const KEYS = root.PC.Constants.STORAGE_KEYS;

  //  Ensure WORKFLOWS key exists in constants
  if (!KEYS.WORKFLOWS) {
    // Fallback if constants.js hasn't been updated yet
    KEYS.WORKFLOWS = 'workflows';
  }

  // ── Internal Helpers ────────────────────────────────────────────

  /**
   * Read a storage key, returning its value or a default.
   */
  async function _get(key, defaultValue = null) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? defaultValue;
  }

  /**
   * Write a value to a storage key.
   */
  async function _set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }


  // ── Generic Collection CRUD ─────────────────────────────────────
  // Recipes, Chains, and Logs all follow the same pattern:
  //   stored as an array of objects under a single key.

  /**
   * Get all items in a collection.
   */
  async function _getAll(key) {
    return await _get(key, []);
  }

  /**
   * Get a single item by ID.
   */
  async function _getById(key, id) {
    const items = await _getAll(key);
    return items.find((item) => item.id === id) || null;
  }

  /**
   * Add a new item to a collection.
   * Automatically adds id, createdAt, updatedAt if missing.
   */
  async function _add(key, item) {
    const items = await _getAll(key);
    const now = PC.Utils.timestamp();

    const newItem = {
      id: item.id || PC.Utils.uuid(),
      ...item,
      createdAt: item.createdAt || now,
      updatedAt: now,
    };

    items.push(newItem);
    await _set(key, items);
    return newItem;
  }

  /**
   * Update an existing item by ID.
   * Merges the updates into the existing item.
   */
  async function _update(key, id, updates) {
    const items = await _getAll(key);
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) return null;

    items[index] = {
      ...items[index],
      ...updates,
      id,                               // prevent ID overwrite
      createdAt: items[index].createdAt, // prevent createdAt overwrite
      updatedAt: PC.Utils.timestamp(),
    };

    await _set(key, items);
    return items[index];
  }

  /**
   * Delete an item by ID.
   */
  async function _remove(key, id) {
    const items = await _getAll(key);
    const filtered = items.filter((item) => item.id !== id);

    if (filtered.length === items.length) return false; // not found

    await _set(key, filtered);
    return true;
  }


  // ══════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════════

  root.PC.Storage = {

    // ── Recipes ─────────────────────────────────────────────────────

    recipes: {
      getAll() { return _getAll(KEYS.RECIPES); },
      getById(id) { return _getById(KEYS.RECIPES, id); },
      add(recipe) { return _add(KEYS.RECIPES, recipe); },
      update(id, updates) { return _update(KEYS.RECIPES, id, updates); },
      remove(id) { return _remove(KEYS.RECIPES, id); },

      /**
       * Find a recipe by domain name.
       * Users record one recipe per domain (e.g., chat.openai.com).
       */
      async getByDomain(domain) {
        const recipes = await _getAll(KEYS.RECIPES);
        return recipes.find((r) => r.domain === domain) || null;
      },
    },

    // ── Prompt Chains ───────────────────────────────────────────────

    chains: {
      getAll() { return _getAll(KEYS.CHAINS); },
      getById(id) { return _getById(KEYS.CHAINS, id); },
      add(chain) { return _add(KEYS.CHAINS, chain); },
      update(id, updates) { return _update(KEYS.CHAINS, id, updates); },
      remove(id) { return _remove(KEYS.CHAINS, id); },

      /**
       * Get all chains that use a specific recipe.
       */
      async getByRecipeId(recipeId) {
        const chains = await _getAll(KEYS.CHAINS);
        return chains.filter((c) => c.recipeId === recipeId);
      },
    },

    // ── Workflows (JSON-based Macros) ───────────────────────────────

    workflows: {
      getAll() { return _getAll(KEYS.WORKFLOWS); },
      getById(id) { return _getById(KEYS.WORKFLOWS, id); },
      add(workflow) { return _add(KEYS.WORKFLOWS, workflow); },
      update(id, updates) { return _update(KEYS.WORKFLOWS, id, updates); },
      remove(id) { return _remove(KEYS.WORKFLOWS, id); },

      /**
       * Find a workflow by domain name.
       * Like recipes, users typically have one workflow per domain.
       */
      async getByDomain(domain) {
        const workflows = await _getAll(KEYS.WORKFLOWS);
        return workflows.find((w) => w.domain === domain) || null;
      },

      /**
       * Get all workflows for a specific domain (multiple workflows allowed).
       */
      async getAllByDomain(domain) {
        const workflows = await _getAll(KEYS.WORKFLOWS);
        return workflows.filter((w) => w.domain === domain);
      },

      /**
       * Find workflows that match current page.
       * Checks both exact domain match and wildcard patterns.
       */
      async getForCurrentPage(url) {
        const workflows = await _getAll(KEYS.WORKFLOWS);
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;

        return workflows.filter((w) => {
          // Exact domain match
          if (w.domain === hostname) return true;

          // Wildcard match (e.g., "*.google.com")
          if (w.domainPattern) {
            const pattern = new RegExp(
              '^' + w.domainPattern.replace(/\*/g, '.*') + '$'
            );
            return pattern.test(hostname);
          }

          return false;
        });
      },

      /**
       * Duplicate a workflow (for creating variations).
       */
      async duplicate(id) {
        const original = await _getById(KEYS.WORKFLOWS, id);
        if (!original) return null;

        const copy = {
          ...original,
          id: PC.Utils.uuid(),
          name: `${original.name} (Copy)`,
          createdAt: PC.Utils.timestamp(),
          updatedAt: PC.Utils.timestamp(),
        };

        return await _add(KEYS.WORKFLOWS, copy);
      },
    },

    // ── Activity Logs ───────────────────────────────────────────────

    logs: {
      getAll() { return _getAll(KEYS.LOGS); },

      /**
       * Add a log entry. Unlike recipes/chains, logs are append-only.
       * The logger module (lib/logger.js) calls this.
       */
      add(entry) { return _add(KEYS.LOGS, entry); },

      /**
       * Get logs filtered by criteria.
       * @param {object} filters
       * @param {string} [filters.recipeId]
       * @param {string} [filters.chainId]
       * @param {string} [filters.sessionId]
       * @param {string} [filters.action]
       * @param {string} [filters.status]
       * @param {number} [filters.limit] - max results (newest first)
       */
      async getFiltered(filters = {}) {
        let logs = await _getAll(KEYS.LOGS);

        if (filters.recipeId) {
          logs = logs.filter((l) => l.recipeId === filters.recipeId);
        }
        if (filters.chainId) {
          logs = logs.filter((l) => l.chainId === filters.chainId);
        }
        if (filters.sessionId) {
          logs = logs.filter((l) => l.sessionId === filters.sessionId);
        }
        if (filters.action) {
          logs = logs.filter((l) => l.action === filters.action);
        }
        if (filters.status) {
          logs = logs.filter((l) => l.status === filters.status);
        }

        // Sort newest first
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (filters.limit) {
          logs = logs.slice(0, filters.limit);
        }

        return logs;
      },

      /**
       * Clear all logs.
       */
      async clear() {
        await _set(KEYS.LOGS, []);
      },

      /**
       * Remove logs older than maxAge milliseconds.
       * Called periodically to prevent storage bloat.
       */
      async pruneOlderThan(maxAgeMs) {
        const logs = await _getAll(KEYS.LOGS);
        const cutoff = Date.now() - maxAgeMs;
        const pruned = logs.filter(
          (l) => new Date(l.timestamp).getTime() > cutoff
        );
        await _set(KEYS.LOGS, pruned);
        return logs.length - pruned.length; // number removed
      },
    },

    // ── Settings ────────────────────────────────────────────────────

    settings: {
      /**
       * Get all settings, merged with defaults.
       * Missing keys fall back to DEFAULT_SETTINGS.
       */
      async get() {
        const saved = await _get(KEYS.SETTINGS, {});
        return { ...PC.Constants.DEFAULT_SETTINGS, ...saved };
      },

      /**
       * Update specific settings (partial update).
       */
      async update(updates) {
        const current = await _get(KEYS.SETTINGS, {});
        const merged = { ...current, ...updates };
        await _set(KEYS.SETTINGS, merged);
        return merged;
      },

      /**
       * Reset all settings to defaults.
       */
      async reset() {
        await _set(KEYS.SETTINGS, {});
        return { ...PC.Constants.DEFAULT_SETTINGS };
      },
    },

    // ── Active Chain State (session-level) ──────────────────────────
    // Stored in chrome.storage.session for faster access and
    // auto-cleanup when browser closes.

    activeChain: {
      async get() {
        const result = await chrome.storage.session.get(KEYS.ACTIVE_CHAIN_STATE);
        return result[KEYS.ACTIVE_CHAIN_STATE] || null;
      },

      async set(state) {
        await chrome.storage.session.set({
          [KEYS.ACTIVE_CHAIN_STATE]: {
            ...state,
            savedAt: PC.Utils.timestamp(),
          },
        });
      },

      async clear() {
        await chrome.storage.session.remove(KEYS.ACTIVE_CHAIN_STATE);
      },
    },

    // ── Migration Helpers ───────────────────────────────────────────

    /**
     * Convert old recipe format to new workflow format.
     * Useful for migrating existing users.
     *
     * @param {object} recipe - Legacy recipe with elements object
     * @returns {object} workflow - New workflow with steps array
     */
    async migrateRecipeToWorkflow(recipe) {
      if (!recipe || !recipe.elements) {
        throw new Error('Invalid recipe format');
      }

      const steps = [];

      // Step 1: Type into input
      if (recipe.elements.targetInput) {
        steps.push({
          id: 'step_1',
          action: 'type',
          selector: recipe.elements.targetInput,
          value: '{{USER_PROMPT}}', // Template variable
          variableName: 'USER_PROMPT',
          description: 'Type prompt into input field',
        });
      }

      // Step 2: Click send button
      if (recipe.elements.sendTrigger) {
        steps.push({
          id: 'step_2',
          action: 'click',
          selector: recipe.elements.sendTrigger,
          description: 'Click send button',
        });
      }

      // Step 3: Wait for streaming to end (optional)
      if (recipe.elements.streamingIndicator) {
        steps.push({
          id: 'step_3',
          action: 'waitForDisappear',
          selector: recipe.elements.streamingIndicator,
          timeout: 180000,
          description: 'Wait for AI to finish generating',
        });
      }

      // Step 4: Wait for completion indicator
      if (recipe.elements.completionSignal || recipe.elements.completionIndicator) {
        steps.push({
          id: 'step_4',
          action: 'waitForAppear',
          selector: recipe.elements.completionSignal || recipe.elements.completionIndicator,
          timeout: 180000,
          description: 'Wait for completion indicator',
        });
      }

      // Step 5: Extra action (optional)
      if (recipe.elements.extraAction) {
        steps.push({
          id: 'step_5',
          action: 'click',
          selector: recipe.elements.extraAction,
          description: 'Click extra action button',
        });
      }

      // Create new workflow
      const workflow = {
        id: PC.Utils.uuid(),
        name: recipe.name,
        domain: recipe.domain,
        steps,
        variables: {
          USER_PROMPT: {
            label: 'Your Prompt',
            type: 'text',
            required: true,
            default: '',
          },
        },
        settings: recipe.settings || {},
        migratedFrom: recipe.id,
        createdAt: PC.Utils.timestamp(),
        updatedAt: PC.Utils.timestamp(),
      };

      return workflow;
    },

    /**
     * Migrate all recipes to workflows.
     * Leaves original recipes intact.
     */
    async migrateAllRecipes() {
      const recipes = await _getAll(KEYS.RECIPES);
      const workflows = await _getAll(KEYS.WORKFLOWS);
      const existingDomains = new Set(workflows.map((w) => w.domain));

      const migrated = [];

      for (const recipe of recipes) {
        // Skip if workflow already exists for this domain
        if (existingDomains.has(recipe.domain)) {
          console.log(`[Storage] Skipping ${recipe.domain} — workflow exists`);
          continue;
        }

        try {
          const workflow = await this.migrateRecipeToWorkflow(recipe);
          await _add(KEYS.WORKFLOWS, workflow);
          migrated.push(workflow);
          console.log(`[Storage] ✅ Migrated ${recipe.domain} → workflow ${workflow.id}`);
        } catch (err) {
          console.error(`[Storage] ❌ Migration failed for ${recipe.domain}:`, err);
        }
      }

      return migrated;
    },

    // ── Export (for JSON download / future MongoDB migration) ───────

    /**
     * Export all data as a single JSON-serializable object.
     * Structure matches intended MongoDB collections.
     */
    async exportAll() {
      const [recipes, chains, workflows, logs, settings] = await Promise.all([
        _getAll(KEYS.RECIPES),
        _getAll(KEYS.CHAINS),
        _getAll(KEYS.WORKFLOWS),
        _getAll(KEYS.LOGS),
        root.PC.Storage.settings.get(),
      ]);

      return {
        exportedAt: PC.Utils.timestamp(),
        version: '0.2.0',
        data: {
          recipes,
          chains,
          workflows,
          activityLogs: logs,
          settings,
        },
      };
    },

    /**
     * Import data from a previously exported JSON object.
     * Merges with existing data (does not overwrite duplicates).
     */
    async importData(exportedData) {
      if (!exportedData?.data) {
        throw new Error('Invalid export format');
      }

      const { recipes, chains, workflows, activityLogs, settings } = exportedData.data;

      // For each collection, add items that don't already exist (by ID)
      if (recipes) {
        const existing = await _getAll(KEYS.RECIPES);
        const existingIds = new Set(existing.map((r) => r.id));
        const newItems = recipes.filter((r) => !existingIds.has(r.id));
        await _set(KEYS.RECIPES, [...existing, ...newItems]);
      }


      if (chains) {
        const existing = await _getAll(KEYS.CHAINS);
        const existingIds = new Set(existing.map((c) => c.id));
        const newItems = chains.filter((c) => !existingIds.has(c.id));
        await _set(KEYS.CHAINS, [...existing, ...newItems]);
      }

      if (workflows) {
        const existing = await _getAll(KEYS.WORKFLOWS);
        const existingIds = new Set(existing.map((w) => w.id));
        const newItems = workflows.filter((w) => !existingIds.has(w.id));
        await _set(KEYS.WORKFLOWS, [...existing, ...newItems]);
      }


      if (activityLogs) {
        const existing = await _getAll(KEYS.LOGS);
        const existingIds = new Set(existing.map((l) => l.id));
        const newItems = activityLogs.filter((l) => !existingIds.has(l.id));
        await _set(KEYS.LOGS, [...existing, ...newItems]);
      }

      if (settings) {
        await root.PC.Storage.settings.update(settings);
      }
    },
  };
})();