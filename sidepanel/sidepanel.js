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
  const idleState      = $('#idleState');
  const activeState    = $('#activeState');
  const completedState = $('#completedState');

  // Chain info
  const chainNameEl = $('#chainName');
  const chainMetaEl = $('#chainMeta');

  // Controls
  const ctrlPause  = $('#ctrlPause');
  const ctrlResume = $('#ctrlResume');
  const ctrlCancel = $('#ctrlCancel');

  // Progress
  const progressFill = $('#progressFill');
  const progressText = $('#progressText');
  const elapsedEl    = $('#elapsed');

  // Steps
  const stepsList = $('#stepsList');

  // Completed
  const resultBanner       = $('#resultBanner');
  const resultIcon         = $('#resultIcon');
  const resultText         = $('#resultText');
  const resultStats        = $('#resultStats');
  const completedStepsList = $('#completedStepsList');
  const btnRunAgain        = $('#btnRunAgain');
  const btnViewLogs        = $('#btnViewLogs');

  // Log
  const logStream   = $('#logStream');
  const btnClearLog = $('#btnClearLog');

  // Header
  const btnOpenDashboard = $('#btnOpenDashboard');


  // ── State ───────────────────────────────────────────────────────
  let _chainData = {
    name: '',
    total: 0,
    domain: '',
    chainId: null,
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
      if (_lastCompletedData?.chainId) {
        const chain = await PC.Storage.chains.getById(_lastCompletedData.chainId);
        if (chain) {
          PC.Messages.send(MSG.RUN_CHAIN, {
            chainId: chain.id,
            recipeId: chain.recipeId,
          });
        } else {
          alert('Chain not found. It may have been deleted.');
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
      // There's an active chain — reconstruct the UI
      addLog('info', 'Reconnected to active chain');

      // Try to get chain details
      const chain = state.chainId ? await PC.Storage.chains.getById(state.chainId) : null;

      _chainData = {
        name: chain?.name || 'Unknown Chain',
        total: chain?.prompts?.length || 0,
        domain: state.tabUrl ? new URL(state.tabUrl).hostname : '',
        chainId: state.chainId,
        sessionId: state.sessionId,
      };

      // Initialize steps from stored state
      _steps = [];
      for (let i = 0; i < _chainData.total; i++) {
        const promptPreview = chain?.prompts?.[i]
          ? PC.Utils.truncate(chain.prompts[i], 50)
          : `Prompt ${i + 1}`;

        _steps.push({
          index: i,
          status: i < (state.currentStep || 0) ? 'done' : 'pending',
          prompt: promptPreview,
          duration: null,
          error: null,
        });
      }

      // Mark current step
      if (state.currentStep !== undefined && state.currentStep < _steps.length) {
        _steps[state.currentStep].status = state.status === 'paused' ? 'paused' : 'active';
      }

      _startTime = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();

      showActive();
      renderChainInfo();
      renderSteps();
      updateProgress(state.currentStep || 0, _chainData.total);
      updateControls(state.status === 'paused' ? 'paused' : 'running');
      startElapsedTimer();

    } else {
      showIdle();
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  STATUS UPDATE HANDLER
  // ══════════════════════════════════════════════════════════════════

  function listenForStatusUpdates() {
    PC.Messages.listen({

      [MSG.CHAIN_STARTED]: (msg) => {
        _chainData = {
          name: msg.chainName || 'Chain',
          total: msg.total || 0,
          domain: msg.domain || '',
          chainId: msg.chainId,
          sessionId: msg.sessionId,
        };

        // Initialize step tracking
        _steps = [];
        for (let i = 0; i < _chainData.total; i++) {
          _steps.push({
            index: i,
            status: 'pending',
            prompt: `Prompt ${i + 1}`,
            duration: null,
            error: null,
          });
        }

        _startTime = Date.now();

        showActive();
        renderChainInfo();
        renderSteps();
        updateProgress(0, _chainData.total);
        updateControls('running');
        startElapsedTimer();
        addLog('info', `Chain started: "${_chainData.name}" (${_chainData.total} prompts)`);
      },

      [MSG.STEP_STARTED]: (msg) => {
        const step = msg.step;
        if (_steps[step]) {
          _steps[step].status = 'active';
          _steps[step].prompt = msg.promptPreview || _steps[step].prompt;
          _steps[step]._startTime = Date.now();
        }
        renderSteps();
        addLog('info', `Step ${step + 1}: ${msg.promptPreview || '...'}`);
      },

      [MSG.STEP_COMPLETED]: (msg) => {
        const step = msg.step;
        if (_steps[step]) {
          _steps[step].status = 'done';
          _steps[step].duration = msg.duration;
        }
        renderSteps();
        updateProgress(step + 1, _chainData.total);
        addLog('success', `Step ${step + 1} done (${PC.Utils.formatDuration(msg.duration || 0)})`);
      },

      [MSG.STEP_FAILED]: (msg) => {
        const step = msg.step;
        if (_steps[step]) {
          _steps[step].status = 'failed';
          _steps[step].error = msg.error;
          _steps[step].duration = msg.duration;
        }
        renderSteps();
        updateProgress(step + 1, _chainData.total);
        addLog('error', `Step ${step + 1} failed: ${msg.error || 'unknown'}`);
      },

      [MSG.STEP_RETRYING]: (msg) => {
        addLog('warn', `Step ${msg.step + 1} retrying (attempt ${msg.attempt}/${msg.maxRetries})`);
      },

      [MSG.STEP_SKIPPED]: (msg) => {
        const step = msg.step;
        if (_steps[step]) {
          _steps[step].status = 'failed';
          _steps[step].error = 'Skipped';
        }
        renderSteps();
        addLog('warn', `Step ${step + 1} skipped`);
      },

      [MSG.CHAIN_PAUSED]: (msg) => {
        const step = msg.step;
        if (_steps[step]) _steps[step].status = 'paused';
        updateControls('paused');
        renderSteps();
        addLog('warn', `Paused at step ${(step || 0) + 1}`);
      },

      [MSG.CHAIN_RESUMED]: (msg) => {
        const step = msg.step;
        if (_steps[step]) _steps[step].status = 'active';
        updateControls('running');
        renderSteps();
        addLog('info', `Resumed at step ${(step || 0) + 1}`);
      },

      [MSG.CHAIN_COMPLETED]: (msg) => {
        _lastCompletedData = { ...msg, chainId: _chainData.chainId };
        showCompleted({
          type: 'success',
          total: msg.total,
          success: msg.success,
          failed: msg.failed,
          duration: msg.duration,
        });
        addLog('success',
          `Chain complete! ${msg.success}/${msg.total} succeeded (${PC.Utils.formatDuration(msg.duration)})`
        );
      },

      [MSG.CHAIN_FAILED]: (msg) => {
        _lastCompletedData = { chainId: _chainData.chainId };
        showCompleted({
          type: 'failed',
          error: msg.error,
          total: _chainData.total,
        });
        addLog('error', `Chain failed: ${msg.error}`);
      },

      [MSG.CHAIN_CANCELLED]: () => {
        _lastCompletedData = { chainId: _chainData.chainId };
        showCompleted({
          type: 'cancelled',
          total: _chainData.total,
        });
        addLog('warn', 'Chain cancelled');
      },

      [MSG.USER_INTERFERENCE]: (msg) => {
        if (_steps[msg.step]) _steps[msg.step].status = 'paused';
        updateControls('paused');
        renderSteps();
        addLog('warn', 'User typing detected — auto-paused');
      },

      [MSG.RESPONSE_TIMEOUT]: (msg) => {
        addLog('warn', `Step ${(msg.step || 0) + 1}: response timeout`);
      },

      [MSG.RECORDING_COMPLETE]: () => {
        addLog('info', 'Recipe recording completed');
      },
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  RENDER FUNCTIONS
  // ══════════════════════════════════════════════════════════════════

  function renderChainInfo() {
    chainNameEl.textContent = _chainData.name;
    chainMetaEl.textContent = `${_chainData.total} prompts · ${_chainData.domain}`;
  }

  function renderSteps() {
    stepsList.innerHTML = '';

    for (const step of _steps) {
      const item = document.createElement('div');
      item.className = 'step-item';

      let icon, iconClass = '';
      switch (step.status) {
        case 'pending':  icon = '⏳'; break;
        case 'active':   icon = '🔄'; iconClass = 'step-icon--spinner'; break;
        case 'paused':   icon = '⏸'; break;
        case 'done':     icon = '✅'; item.classList.add('step-item--done'); break;
        case 'failed':   icon = '❌'; item.classList.add('step-item--failed'); break;
        default:         icon = '·'; break;
      }

      if (step.status === 'active') item.classList.add('step-item--active');

      const durationText = step.duration
        ? PC.Utils.formatDuration(step.duration)
        : step.status === 'active' && step._startTime
          ? PC.Utils.formatDuration(Date.now() - step._startTime) + '...'
          : '';

      const detailText = step.status === 'failed' && step.error
        ? `Error: ${step.error}`
        : step.status === 'active'
          ? 'Processing...'
          : step.status === 'paused'
            ? 'Paused'
            : '';

      item.innerHTML = `
        <span class="step-icon ${iconClass}">${icon}</span>
        <div class="step-body">
          <div class="step-title">${step.index + 1}. ${escapeHtml(step.prompt)}</div>
          ${detailText ? `<div class="step-detail">${escapeHtml(detailText)}</div>` : ''}
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
    // Banner
    resultBanner.className = 'result-banner';

    if (data.type === 'success') {
      resultBanner.classList.add('result-banner--success');
      resultIcon.textContent = '✅';
      resultText.textContent = 'Chain Complete!';
      progressFill.classList.add('progress-bar-fill--done');
    } else if (data.type === 'failed') {
      resultBanner.classList.add('result-banner--failed');
      resultIcon.textContent = '❌';
      resultText.textContent = `Chain Failed: ${data.error || 'Unknown error'}`;
      progressFill.classList.add('progress-bar-fill--error');
    } else {
      resultBanner.classList.add('result-banner--cancelled');
      resultIcon.textContent = '⏹';
      resultText.textContent = 'Chain Cancelled';
      progressFill.classList.add('progress-bar-fill--error');
    }

    // Stats
    const successCount = data.success || _steps.filter((s) => s.status === 'done').length;
    const failedCount = data.failed || _steps.filter((s) => s.status === 'failed').length;
    const totalDuration = data.duration || (Date.now() - (_startTime || Date.now()));

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
        : '⏳';

      item.innerHTML = `
        <span class="step-icon">${icon}</span>
        <div class="step-body">
          <div class="step-title">${step.index + 1}. ${escapeHtml(step.prompt)}</div>
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