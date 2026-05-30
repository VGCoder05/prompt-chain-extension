/**
 * content/workflowRunner.js
 * Receives EXECUTE_STEP messages from background and executes them.
 */
(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.PC = root.PC || {};

  const MSG = PC.MessageTypes;

  // Listen for step execution commands
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MSG.EXECUTE_STEP) {
      executeStep(message.step, message.stepIndex, message.totalSteps)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async response
    }
  });

  /**
   * Execute a single workflow step.
   */
  async function executeStep(step, stepIndex, totalSteps) {
    console.log(
      `[WorkflowRunner] 🎬 Executing step ${stepIndex + 1}/${totalSteps}: ` +
      `${step.action} — ${step.description || ''}`
    );

    try {
      // Use replayer to execute the step
      const result = await PC.Replayer.executeStep(step, {
        timeout: step.timeout || 10000,
        onProgress: (elapsed, status) => {
          // Send progress updates to background (optional)
          chrome.runtime.sendMessage({
            type: MSG.STEP_PROGRESS,
            stepIndex,
            elapsed,
            status,
          }).catch(() => {}); // Ignore if background is unavailable
        },
      });

      if (!result.success) {
        // Step failed
        chrome.runtime.sendMessage({
          type: MSG.STEP_FAILED,
          step,
          stepIndex,
          error: result.error,
        }).catch(() => {});

        return {
          success: false,
          error: result.error,
        };
      }

      // Step succeeded — notify background
      chrome.runtime.sendMessage({
        type: MSG.STEP_COMPLETED,
        step,
        stepIndex,
        result: result.result,
      }).catch(() => {});

      return {
        success: true,
        result: result.result,
      };

    } catch (err) {
      console.error('[WorkflowRunner] Step execution error:', err);

      chrome.runtime.sendMessage({
        type: MSG.STEP_FAILED,
        step,
        stepIndex,
        error: err.message,
      }).catch(() => {});

      return {
        success: false,
        error: err.message,
      };
    }
  }

  console.log('[PC WorkflowRunner] ✅ Module loaded');
})();