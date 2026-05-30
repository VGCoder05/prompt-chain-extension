/**
 * sidepanel/sidepanel.js
 * ────────────────────────────────────────────
 * Live execution monitor for the side panel.
 *
 * Features:
 *   - Real-time step-by-step progress display
 *   - Progress bar with percentage
 *   - Per-step timing
 *   - Pause/Resume/Cancel controls
 *   - Live log stream
 *   - Completion summary with stats
 *   - Reconnects to active chain on open
 *   - Theme & color toggling (synced with popup/dashboard)
 *
 * Does NOT execute chains — listens to status messages
 * from background and sends control commands.
 */
(() => {
  const MSG = PC.MessageTypes;

  // ── DOM Helpers ─────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);

  // ── DOM References ──────────────────────────────────────────────

  // States
  const idleState = $('#idleState');
  const activeState = $('#activeState');
  const completedState = $('#completedState');

  // Chain info
  const chainNameEl = $('#chainName');
  const chainMetaEl = $('#chainMeta');

  // Controls
  const ctrlPause = $('#ctrlPause');
  const ctrlResume = $('#ctrlResume');
  const ctrlCancel = $('#ctrlCancel');

  // Progress
  const progressFill = $('#progressFill');
  const progressText = $('#progressText');
  const elapsedEl = $('#elapsed');

  // Steps
  const stepsList = $('#stepsList');

  // Completed
  const resultBanner = $('#resultBanner');
  const resultIcon = $('#resultIcon');
  const resultText = $('#resultText');
  const resultStats = $('#resultStats');
  const completedStepsList = $('#completedStepsList');
  const btnRunAgain = $('#btnRunAgain');
  const btnViewLogs = $('#btnViewLogs');

  // Log
  const logStream = $('#logStream');
  const btnClearLog = $('#btnClearLog');

  // Header
  const btnOpenDashboard = $('#btnOpenDashboard');


  // ── State ───────────────────────────────────────────────────────
  let _workflowData = {
    name: '',
    totalSteps: 0,
    domain: '',
    workflowId: null,
    variables: {},
    sessionId: null,
  };

  let _steps = [];          // Array of step info objects
  let _startTime = null;
  let _elapsedTimer = null;
  let _lastCompletedData = null;


  // ══════════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════════════

  async function init() {
    initTheming();
    setupEventListeners();
    listenForStatusUpdates();
    await reconnectToActiveChain();
  }


  // ══════════════════════════════════════════════════════════════════
  //  THEMING
  // ══════════════════════════════════════════════════════════════════

  function initTheming() {
    const htmlEl = document.documentElement;
    const savedTheme = localStorage.getItem('pc_theme') || 'dark';
    const savedColor = localStorage.getItem('pc_color') || 'teal';

    htmlEl.setAttribute('data-theme', savedTheme);
    htmlEl.setAttribute('data-color', savedColor);

    $('#btnToggleTheme').addEventListener('click', () => {
      const next = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      htmlEl.setAttribute('data-theme', next);
      localStorage.setItem('pc_theme', next);
    });

    $('#btnToggleColor').addEventListener('click', () => {
      const next = htmlEl.getAttribute('data-color') === 'teal' ? 'orange' : 'teal';
      htmlEl.setAttribute('data-color', next);
      localStorage.setItem('pc_color', next);
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════════

  function setupEventListeners() {
    // Chain controls
    ctrlPause.addEventListener('click', () => PC.Messages.send(MSG.PAUSE_CHAIN));

    ctrlResume.addEventListener('click', () => PC.Messages.send(MSG.RESUME_CHAIN));

    ctrlCancel.addEventListener('click', () => {
      if (confirm('Cancel the running chain?')) {
        PC.Messages.send(MSG.CANCEL_CHAIN);
      }
    });

    // Log
    btnClearLog.addEventListener('click', clearLog);

    // Navigation
    btnOpenDashboard.addEventListener('click', () => PC.Messages.send(MSG.OPEN_DASHBOARD));

    // Completed actions
    btnRunAgain.addEventListener('click', async () => {
      if (_lastCompletedData?.workflowId) {
        // ✅ NEW: Reload workflow and re-run
        const workflow = await PC.Storage.workflows.getById(_lastCompletedData.workflowId);
        if (workflow) {
          // Show prompt for variables if workflow has any
          const variables = {};
          if (workflow.variables) {
            for (const [name, config] of Object.entries(workflow.variables)) {
              const value = prompt(`Enter value for {{${name}}}:`, config.default || '');
              if (value === null) return; // User cancelled
              variables[name] = value;
            }
          }

          PC.Messages.runWorkflow(workflow, variables);
        } else {
          alert('Workflow not found. It may have been deleted.');
        }
      } else if (_lastCompletedData?.chainId) {
        // ✅ LEGACY: Chain re-run
        const chain = await PC.Storage.chains.getById(_lastCompletedData.chainId);
        if (chain) {
          PC.Messages.send(MSG.RUN_CHAIN, {
            chainId: chain.id,
            recipeId: chain.recipeId,
          });
        }
      }
    });

    btnViewLogs.addEventListener('click', () => {
      PC.Messages.send(MSG.OPEN_DASHBOARD);
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  STATE MANAGEMENT — Show/Hide Sections
  // ══════════════════════════════════════════════════════════════════

  function showIdle() {
    idleState.style.display = 'block';
    activeState.style.display = 'none';
    completedState.style.display = 'none';
    stopElapsedTimer();
  }

  function showActive() {
    idleState.style.display = 'none';
    activeState.style.display = 'block';
    completedState.style.display = 'none';
  }

  function showCompleted(data) {
    idleState.style.display = 'none';
    activeState.style.display = 'none';
    completedState.style.display = 'block';
    stopElapsedTimer();
    renderCompletedView(data);
  }


  // ══════════════════════════════════════════════════════════════════
  //  RECONNECT — side panel opened mid-chain
  // ══════════════════════════════════════════════════════════════════

  async function reconnectToActiveChain() {
    const state = await PC.Storage.activeChain.get();

    if (!state) {
      showIdle();
      return;
    }

    if (state.status === 'running' || state.status === 'starting' || state.status === 'paused') {
      addLog('info', 'Reconnected to active workflow');

      // ✅ NEW: Check if this is a workflow or legacy chain
      const isWorkflow = state.workflowId && state.steps;

      if (isWorkflow) {
        // ✅ NEW: Workflow format
        _workflowData = {
          name: state.workflowName || 'Unknown Workflow',
          totalSteps: state.steps?.length || 0,
          domain: state.tabUrl ? new URL(state.tabUrl).hostname : '',
          workflowId: state.workflowId,
          variables: state.variables || {},
          sessionId: state.sessionId,
        };

        // Initialize steps from workflow
        _steps = state.steps.map((step, index) => ({
          index,
          status: index < (state.currentStepIndex || 0) ? 'done' : 'pending',
          action: step.action,
          description: step.description || getActionLabel(step.action),
          duration: null,
          error: null,
        }));

        // Mark current step
        if (state.currentStepIndex !== undefined && state.currentStepIndex < _steps.length) {
          _steps[state.currentStepIndex].status = state.status === 'paused' ? 'paused' : 'active';
        }

      } else {
        // ✅ LEGACY: Chain format (backwards compatibility)
        const chain = state.chainId ? await PC.Storage.chains.getById(state.chainId) : null;

        _workflowData = {
          name: chain?.name || 'Unknown Chain',
          totalSteps: chain?.prompts?.length || 0,
          domain: state.tabUrl ? new URL(state.tabUrl).hostname : '',
          workflowId: null,
          variables: {},
          sessionId: state.sessionId,
        };

        _steps = [];
        for (let i = 0; i < _workflowData.totalSteps; i++) {
          const promptPreview = chain?.prompts?.[i]
            ? PC.Utils.truncate(chain.prompts[i], 50)
            : `Prompt ${i + 1}`;

          _steps.push({
            index: i,
            status: i < (state.currentStep || 0) ? 'done' : 'pending',
            action: 'type', // Legacy chains only typed text
            description: promptPreview,
            duration: null,
            error: null,
          });
        }

        if (state.currentStep !== undefined && state.currentStep < _steps.length) {
          _steps[state.currentStep].status = state.status === 'paused' ? 'paused' : 'active';
        }
      }

      _startTime = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();

      showActive();
      renderWorkflowInfo();
      renderVariables();
      renderSteps();
      updateProgress(state.currentStepIndex || state.currentStep || 0, _workflowData.totalSteps);
      updateControls(state.status === 'paused' ? 'paused' : 'running');
      startElapsedTimer();

    } else {
      showIdle();
    }
  }

  /**
 * Get human-readable label for a step action.
 */
  function getActionLabel(action) {
    const labels = {
      type: 'Type text',
      click: 'Click element',
      waitForAppear: 'Wait for element to appear',
      waitForDisappear: 'Wait for element to disappear',
      delay: 'Wait',
    };
    return labels[action] || action;
  }

  /**
   * Get emoji icon for a step action.
   */
  function getActionIcon(action) {
    const icons = {
      type: '⌨️',
      click: '👆',
      waitForAppear: '👀',
      waitForDisappear: '⏳',
      delay: '⏱️',
    };
    return icons[action] || '·';
  }


  // ══════════════════════════════════════════════════════════════════
  //  STATUS UPDATE HANDLER
  // ══════════════════════════════════════════════════════════════════

  function listenForStatusUpdates() {
    PC.Messages.listen({

      // ✅ NEW: Workflow execution messages
      [MSG.WORKFLOW_PROGRESS]: (msg) => {
        updateProgress(msg.currentStep, msg.totalSteps);
        addLog('info', `Step ${msg.currentStep}/${msg.totalSteps}: ${msg.stepAction}`);
      },

      [MSG.WORKFLOW_COMPLETED]: (msg) => {
        _lastCompletedData = { workflowId: _workflowData.workflowId };
        showCompleted({
          type: 'success',
          total: msg.totalSteps,
          success: msg.totalSteps,
          failed: 0,
          duration: msg.duration,
        });
        addLog('success',
          `Workflow complete! All ${msg.totalSteps} steps succeeded (${PC.Utils.formatDuration(msg.duration)})`
        );
      },

      [MSG.WORKFLOW_FAILED]: (msg) => {
        _lastCompletedData = { workflowId: _workflowData.workflowId };
        showCompleted({
          type: 'failed',
          error: msg.error,
          total: msg.totalSteps || _workflowData.totalSteps,
          failedAtStep: msg.failedAtStep,
        });
        addLog('error', `Workflow failed at step ${msg.failedAtStep}: ${msg.error}`);
      },

      // ✅ LEGACY: Chain execution (backwards compatibility)
      [MSG.CHAIN_STARTED]: (msg) => {
        _workflowData = {
          name: msg.chainName || 'Chain',
          totalSteps: msg.total || 0,
          domain: msg.domain || '',
          workflowId: null,
          variables: {},
          sessionId: msg.sessionId,
        };

        _steps = [];
        for (let i = 0; i < _workflowData.totalSteps; i++) {
          _steps.push({
            index: i,
            status: 'pending',
            action: 'type',
            description: `Prompt ${i + 1}`,
            duration: null,
            error: null,
          });
        }

        _startTime = Date.now();

        showActive();
        renderWorkflowInfo();
        renderSteps();
        updateProgress(0, _workflowData.totalSteps);
        updateControls('running');
        startElapsedTimer();
        addLog('info', `Chain started: "${_workflowData.name}" (${_workflowData.totalSteps} prompts)`);
      },

      [MSG.STEP_STARTED]: (msg) => {
        const stepIndex = msg.stepIndex ?? msg.step; // Support both formats
        if (_steps[stepIndex]) {
          _steps[stepIndex].status = 'active';
          _steps[stepIndex].description = msg.stepDescription || msg.promptPreview || _steps[stepIndex].description;
          _steps[stepIndex]._startTime = Date.now();
        }
        renderSteps();
        addLog('info', `Step ${stepIndex + 1}: ${_steps[stepIndex]?.description || '...'}`);
      },

      [MSG.STEP_COMPLETED]: (msg) => {
        const stepIndex = msg.stepIndex ?? msg.step;
        if (_steps[stepIndex]) {
          _steps[stepIndex].status = 'done';
          _steps[stepIndex].duration = msg.duration || (Date.now() - (_steps[stepIndex]._startTime || Date.now()));
        }
        renderSteps();
        updateProgress(stepIndex + 1, _workflowData.totalSteps);
        addLog('success', `Step ${stepIndex + 1} done (${PC.Utils.formatDuration(_steps[stepIndex]?.duration || 0)})`);
      },

      [MSG.STEP_FAILED]: (msg) => {
        const stepIndex = msg.stepIndex ?? msg.step;
        if (_steps[stepIndex]) {
          _steps[stepIndex].status = 'failed';
          _steps[stepIndex].error = msg.error;
          _steps[stepIndex].duration = msg.duration;
        }
        renderSteps();
        addLog('error', `Step ${stepIndex + 1} failed: ${msg.error || 'unknown'}`);
      },

      [MSG.STEP_PROGRESS]: (msg) => {
        // Real-time progress during long waits
        const stepIndex = msg.stepIndex;
        const elapsed = msg.elapsed;
        const status = msg.status; // 'waiting', 'generating', etc.

        addLog('info', `Step ${stepIndex + 1}: ${status}... (${PC.Utils.formatDuration(elapsed)})`);
      },

      // ... rest of legacy listeners (CHAIN_PAUSED, CHAIN_RESUMED, etc.)
      // Keep these for backwards compatibility
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  RENDER FUNCTIONS
  // ══════════════════════════════════════════════════════════════════

  function renderWorkflowInfo() {
    const chainNameEl = $('#chainName');
    const chainMetaEl = $('#chainMeta');

    chainNameEl.textContent = _workflowData.name;
    chainMetaEl.textContent = `${_workflowData.totalSteps} steps · ${_workflowData.domain}`;
  }

  function renderVariables() {
    const variablesSection = $('#variablesSection');
    const variablesList = $('#variablesList');

    // Only show if variables exist
    if (!_workflowData.variables || Object.keys(_workflowData.variables).length === 0) {
      variablesSection.style.display = 'none';
      return;
    }

    variablesSection.style.display = 'block';
    variablesList.innerHTML = '';

    for (const [name, value] of Object.entries(_workflowData.variables)) {
      const item = document.createElement('div');
      item.className = 'variable-item';
      item.innerHTML = `
      <span class="variable-name">{{${name}}}:</span>
      <span class="variable-value" title="${escapeHtml(value)}">${escapeHtml(PC.Utils.truncate(value, 50))}</span>
    `;
      variablesList.appendChild(item);
    }
  }

  function renderSteps() {
    stepsList.innerHTML = '';

    for (const step of _steps) {
      const item = document.createElement('div');
      item.className = 'step-item';

      // ✅ NEW: Use action-specific icons
      let icon, iconClass = '';
      switch (step.status) {
        case 'pending':
          icon = getActionIcon(step.action);
          item.style.opacity = '0.5';
          break;
        case 'active':
          icon = '🔄';
          iconClass = 'step-icon--spinner';
          break;
        case 'paused':
          icon = '⏸';
          break;
        case 'done':
          icon = '✅';
          item.classList.add('step-item--done');
          break;
        case 'failed':
          icon = '❌';
          item.classList.add('step-item--failed');
          break;
        default:
          icon = '·';
          break;
      }

      if (step.status === 'active') item.classList.add('step-item--active');

      const durationText = step.duration
        ? PC.Utils.formatDuration(step.duration)
        : step.status === 'active' && step._startTime
          ? PC.Utils.formatDuration(Date.now() - step._startTime) + '...'
          : '';

      // ✅ NEW: Show action type + description
      const stepTitle = `${step.index + 1}. ${getActionLabel(step.action)}`;
      const stepDetail = step.status === 'failed' && step.error
        ? `Error: ${step.error}`
        : step.status === 'active'
          ? step.description || 'Processing...'
          : step.status === 'paused'
            ? 'Paused'
            : step.description || '';

      item.innerHTML = `
      <span class="step-icon ${iconClass}">${icon}</span>
      <div class="step-body">
        <div class="step-title">${escapeHtml(stepTitle)}</div>
        ${stepDetail ? `<div class="step-detail">${escapeHtml(stepDetail)}</div>` : ''}
      </div>
      ${durationText ? `<span class="step-duration">${durationText}</span>` : ''}
    `;

      stepsList.appendChild(item);
    }

    // Auto-scroll to active step
    const activeEl = stepsList.querySelector('.step-item--active');
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateProgress(completed, total) {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${completed} / ${total}`;

    // Reset modifier classes
    progressFill.classList.remove('progress-bar-fill--done', 'progress-bar-fill--error');
  }

  function updateControls(state) {
    if (state === 'running') {
      ctrlPause.style.display = 'inline-block';
      ctrlResume.style.display = 'none';
      ctrlCancel.style.display = 'inline-block';
    } else if (state === 'paused') {
      ctrlPause.style.display = 'none';
      ctrlResume.style.display = 'inline-block';
      ctrlCancel.style.display = 'inline-block';
    }
  }


  // ── Completed View ──────────────────────────────────────────────

  function renderCompletedView(data) {
    const resultBanner = $('#resultBanner');
    const resultIcon = $('#resultIcon');
    const resultText = $('#resultText');
    const resultStats = $('#resultStats');
    const completedStepsList = $('#completedStepsList');

    // Banner
    resultBanner.className = 'result-banner';

    if (data.type === 'success') {
      resultBanner.classList.add('result-banner--success');
      resultIcon.textContent = '✅';
      resultText.textContent = 'Workflow Complete!'; // ✅ Changed
      progressFill.classList.add('progress-bar-fill--done');
    } else if (data.type === 'failed') {
      resultBanner.classList.add('result-banner--failed');
      resultIcon.textContent = '❌';
      resultText.textContent = data.failedAtStep
        ? `Failed at step ${data.failedAtStep}: ${data.error || 'Unknown error'}`
        : `Workflow Failed: ${data.error || 'Unknown error'}`;
      progressFill.classList.add('progress-bar-fill--error');
    } else {
      resultBanner.classList.add('result-banner--cancelled');
      resultIcon.textContent = '⏹';
      resultText.textContent = 'Workflow Cancelled'; // ✅ Changed
      progressFill.classList.add('progress-bar-fill--error');
    }

    // Stats
    const successCount = data.success ?? _steps.filter((s) => s.status === 'done').length;
    const failedCount = data.failed ?? _steps.filter((s) => s.status === 'failed').length;
    const totalDuration = data.duration ?? (Date.now() - (_startTime || Date.now()));

    resultStats.innerHTML = `
    <div class="stat-card">
      <div class="stat-value stat-value--success">${successCount}</div>
      <div class="stat-label">Succeeded</div>
    </div>
    <div class="stat-card">
      <div class="stat-value stat-value--failed">${failedCount}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${PC.Utils.formatDuration(totalDuration)}</div>
      <div class="stat-label">Duration</div>
    </div>
  `;

    // Completed steps list
    completedStepsList.innerHTML = '';

    for (const step of _steps) {
      const item = document.createElement('div');
      item.className = 'step-item';
      if (step.status === 'done') item.classList.add('step-item--done');
      if (step.status === 'failed') item.classList.add('step-item--failed');

      const icon = step.status === 'done' ? '✅'
        : step.status === 'failed' ? '❌'
          : getActionIcon(step.action);

      item.innerHTML = `
      <span class="step-icon">${icon}</span>
      <div class="step-body">
        <div class="step-title">${step.index + 1}. ${escapeHtml(getActionLabel(step.action))}</div>
        <div class="step-detail">${escapeHtml(step.description || '')}</div>
        ${step.error ? `<div class="step-detail">Error: ${escapeHtml(step.error)}</div>` : ''}
      </div>
      ${step.duration ? `<span class="step-duration">${PC.Utils.formatDuration(step.duration)}</span>` : ''}
    `;

      completedStepsList.appendChild(item);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  ELAPSED TIMER
  // ══════════════════════════════════════════════════════════════════

  function startElapsedTimer() {
    stopElapsedTimer();
    _elapsedTimer = setInterval(() => {
      if (_startTime) {
        elapsedEl.textContent = `Elapsed: ${PC.Utils.formatDuration(Date.now() - _startTime)}`;
      }
    }, 1000);
  }

  function stopElapsedTimer() {
    if (_elapsedTimer) {
      clearInterval(_elapsedTimer);
      _elapsedTimer = null;
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  LOG STREAM
  // ══════════════════════════════════════════════════════════════════

  function addLog(level, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-entry--${level}`;

    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });

    entry.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-msg">${escapeHtml(message)}</span>
    `;

    logStream.appendChild(entry);

    // Keep max 200 entries
    while (logStream.children.length > 200) {
      logStream.removeChild(logStream.firstChild);
    }

    // Auto-scroll to bottom
    logStream.scrollTop = logStream.scrollHeight;
  }

  function clearLog() {
    logStream.innerHTML = '';
    addLog('info', 'Log cleared');
  }


  // ══════════════════════════════════════════════════════════════════
  //  UTILITIES
  // ══════════════════════════════════════════════════════════════════

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }


  // ── Start ───────────────────────────────────────────────────────
  init();

})();