/**
 * content/healthChecker.js
 * ────────────────────────────────────────────
 * Pre-run health check for recorded recipes AND workflows.
 * Verifies all recorded elements/selectors can still be found
 * on the current page with acceptable confidence.
 *
 * Supports TWO formats:
 *   1. Legacy Recipes — elements object (targetInput, sendTrigger, etc.)
 *   2. New Workflows — steps array (JSON action steps)
 *
 * Returns a report with per-element/step status:
 *   healthy (>0.8), degraded (0.5-0.8), broken (<0.5)
 *
 * Main API:
 *   - checkAuto(recipeOrWorkflow) — Auto-detects format
 *   - check(recipe) — Legacy recipe checker
 *   - checkSteps(workflow) — New workflow checker
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
 * Run health check on a workflow's JSON steps.
 * Validates that all selectors in the steps array are findable.
 *
 * @param {object} workflow - Workflow object with steps array
 * @returns {object} {
 *   overall: 'healthy' | 'degraded' | 'broken',
 *   steps: [
 *     { stepId, action, found, confidence, method, status },
 *     ...
 *   ],
 *   brokenSteps: number[],  // indices of broken steps
 *   canRun: boolean,
 * }
 */
    checkSteps(workflow) {
      if (!workflow || !workflow.steps || !Array.isArray(workflow.steps)) {
        return {
          overall: 'broken',
          steps: [],
          brokenSteps: [],
          canRun: false,
        };
      }

      const report = {
        steps: [],
        brokenSteps: [],
      };

      workflow.steps.forEach((step, index) => {
        const stepReport = {
          stepId: step.id || `step_${index + 1}`,
          action: step.action,
          description: step.description || '',
        };

        // Steps without selectors (like delays) are always healthy
        if (!step.selector) {
          stepReport.found = true;
          stepReport.confidence = 1.0;
          stepReport.method = 'n/a';
          stepReport.status = 'healthy';
          report.steps.push(stepReport);
          return;
        }

        // Check if selector can be found
        const health = PC.SelectorEngine.checkHealth(step.selector);

        stepReport.found = health.found;
        stepReport.confidence = health.confidence;
        stepReport.method = health.method;
        stepReport.status = health.status;

        if (health.status === 'broken' || health.status === 'unreliable') {
          report.brokenSteps.push(index);
        }

        report.steps.push(stepReport);

        const icon = health.status === 'healthy' ? '✅' :
          health.status === 'degraded' ? '⚠️' : '❌';

        console.log(
          `[HealthCheck] ${icon} Step ${index + 1} (${step.action}): ${health.status} ` +
          `(confidence: ${health.confidence.toFixed(2)})`
        );
      });

      // Determine overall health
      const statuses = report.steps.map((s) => s.status);

      if (statuses.every((s) => s === 'healthy')) {
        report.overall = 'healthy';
      } else if (statuses.some((s) => s === 'broken' || s === 'unreliable')) {
        report.overall = 'broken';
      } else {
        report.overall = 'degraded';
      }

      // Can run if no critical steps are broken
      // (waitForDisappear can timeout gracefully, so only fail on type/click breaks)
      const criticalSteps = report.steps.filter(
        (s) => s.action === 'type' || s.action === 'click'
      );
      const criticalOk = criticalSteps.every(
        (s) => s.status === 'healthy' || s.status === 'degraded'
      );

      report.canRun = criticalOk;

      const overallIcon = report.overall === 'healthy' ? '✅' :
        report.overall === 'degraded' ? '⚠️' : '❌';
      console.log(
        `[HealthCheck] ${overallIcon} Overall: ${report.overall} — ` +
        `canRun: ${report.canRun}` +
        (report.brokenSteps.length > 0
          ? ` — broken steps: [${report.brokenSteps.map(i => i + 1).join(', ')}]`
          : '')
      );

      return report;
    },

    /**
 * Universal health check — works with both old recipes and new workflows.
 * Automatically detects format and calls appropriate checker.
 *
 * @param {object} recipeOrWorkflow
 * @returns {object} health report
 */
    checkAuto(recipeOrWorkflow) {
      if (!recipeOrWorkflow) {
        return {
          overall: 'broken',
          canRun: false,
        };
      }

      // New format: has steps array
      if (recipeOrWorkflow.steps && Array.isArray(recipeOrWorkflow.steps)) {
        console.log('[HealthCheck] Detected new workflow format (steps array)');
        return this.checkSteps(recipeOrWorkflow);
      }

      // Old format: has elements object
      if (recipeOrWorkflow.elements) {
        console.log('[HealthCheck] Detected legacy recipe format (elements object)');
        return this.check(recipeOrWorkflow);
      }

      return {
        overall: 'broken',
        canRun: false,
      };
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

  // console.log('[PC HealthChecker] ✅ Module loaded');

})();