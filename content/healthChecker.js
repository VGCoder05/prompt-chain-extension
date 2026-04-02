/**
 * content/healthChecker.js
 * ────────────────────────────────────────────
 * Pre-run health check for recorded recipes.
 * Verifies all recorded elements can still be found
 * on the current page with acceptable confidence.
 *
 * Returns a report with per-element status:
 *   healthy (>0.8), degraded (0.5-0.8), broken (<0.5)
 *
 * Used by chainRunner before starting a chain,
 * and by the dashboard/popup for recipe status display.
 *
 * Dependencies:
 *   - PC.SelectorEngine (content/selectorEngine.js)
 *   - PC.Constants (lib/constants.js)
 *   - PC.Logger (lib/logger.js)
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const CONF = PC.Constants.CONFIDENCE;

  root.PC.HealthChecker = {

    /**
     * Run a full health check on a recipe's recorded elements.
     *
     * @param {object} recipe - The recipe object from storage
     * @returns {object} {
     *   overall: 'healthy' | 'degraded' | 'broken',
     *   elements: {
     *     targetInput:       { found, confidence, method, status },
     *     sendTrigger:       { found, confidence, method, status },
     *     completionSignal:  { found, confidence, method, status },
     *     extraAction:       { found, confidence, method, status } | null,
     *   },
     *   brokenElements: string[],  // names of broken elements
     *   canRun: boolean,           // true if essential elements are usable
     * }
     */
    check(recipe) {
      if (!recipe || !recipe.elements) {
        return {
          overall: 'broken',
          elements: {},
          brokenElements: ['recipe'],
          canRun: false,
        };
      }

      const report = {
        elements: {},
        brokenElements: [],
      };

      // Check each element
      const essentialElements = ['targetInput', 'sendTrigger', 'completionSignal'];
      const allElements = [...essentialElements];
      if (recipe.elements.extraAction) {
        allElements.push('extraAction');
      }

      for (const name of allElements) {
        const fingerprint = recipe.elements[name];

        if (!fingerprint) {
          // Element was never recorded (extraAction might be null)
          if (essentialElements.includes(name)) {
            report.elements[name] = {
              found: false,
              confidence: 0,
              method: 'none',
              status: 'broken',
            };
            report.brokenElements.push(name);
          }
          continue;
        }

        const health = PC.SelectorEngine.checkHealth(fingerprint);
        report.elements[name] = health;

        if (health.status === 'broken' || health.status === 'unreliable') {
          report.brokenElements.push(name);
        }

        const icon = health.status === 'healthy' ? '✅' :
                     health.status === 'degraded' ? '⚠️' : '❌';

        console.log(
          `[HealthCheck] ${icon} ${name}: ${health.status} ` +
          `(confidence: ${health.confidence.toFixed(2)}, method: ${health.method})`
        );
      }

      // Determine overall health
      const essentialStatuses = essentialElements.map(
        (name) => report.elements[name]?.status || 'broken'
      );

      if (essentialStatuses.every((s) => s === 'healthy')) {
        report.overall = 'healthy';
      } else if (essentialStatuses.some((s) => s === 'broken' || s === 'unreliable')) {
        report.overall = 'broken';
      } else {
        report.overall = 'degraded';
      }

      // Can we run a chain?
      // Requires targetInput and sendTrigger to be at least degraded.
      // CompletionSignal can fall back to DOM mutation.
      const inputOk = ['healthy', 'degraded'].includes(
        report.elements.targetInput?.status
      );
      const sendOk = ['healthy', 'degraded'].includes(
        report.elements.sendTrigger?.status
      );

      report.canRun = inputOk && sendOk;

      // Log summary
      const overallIcon = report.overall === 'healthy' ? '✅' :
                          report.overall === 'degraded' ? '⚠️' : '❌';
      console.log(
        `[HealthCheck] ${overallIcon} Overall: ${report.overall} — ` +
        `canRun: ${report.canRun}` +
        (report.brokenElements.length > 0
          ? ` — broken: [${report.brokenElements.join(', ')}]`
          : '')
      );

      // Log to activity log
      PC.Logger.healthCheck(
        report.overall === 'broken'
          ? PC.Constants.LOG_STATUSES.FAILED
          : PC.Constants.LOG_STATUSES.SUCCESS,
        {
          recipeId: recipe.id,
          domain: recipe.domain,
          overall: report.overall,
          canRun: report.canRun,
          brokenElements: report.brokenElements,
        }
      );

      return report;
    },

    /**
     * Check if a specific element from a recipe can be found.
     * Lighter than a full check — used for quick validation.
     *
     * @param {object} fingerprint
     * @returns {boolean}
     */
    canFindElement(fingerprint) {
      if (!fingerprint) return false;
      const health = PC.SelectorEngine.checkHealth(fingerprint);
      return health.found && health.confidence >= CONF.MINIMUM;
    },
  };

  console.log('[PC HealthChecker] ✅ Module loaded');

})();