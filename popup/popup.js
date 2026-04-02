/**
 * popup/popup.js
 * ────────────────────────────────────────────
 * Redesigned Popup UI logic.
 *
 * Responsibilities:
 *   - List saved recipes (with health status)
 *   - List saved prompt chains (with run button)
 *   - Inline chain creation (name + recipe + prompts)
 *   - Quick Run: run prompts immediately on current tab
 *   - Start/cancel recording
 *   - Show active chain status with pause/resume/cancel
 *   - Open dashboard / side panel
 *   - Theming (light/dark, teal/orange)
 *   - Search filtering across recipes & chains
 *   - Connection status for current tab
 *
 * Does NOT execute chains — sends messages to background
 * which forwards to the content script.
 */
(() => {
  const MSG = PC.MessageTypes;

  // ── DOM Helpers ─────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Core App State ──────────────────────────────────────────────
  let currentFilter = 'recipes';
  let currentTabDomain = null;
  let _currentTabRecipe = null;  // recipe for Quick Run tab

  // ── DOM References ──────────────────────────────────────────────
  // Status bar
  const statusBar = $('#statusBar');
  const statusIcon = $('#statusIcon');
  const statusText = $('#statusText');
  const btnPause = $('#btnPause');
  const btnResume = $('#btnResume');
  const btnCancel = $('#btnCancel');

  // Panels
  const panelRecipes = $('#panel-recipes');
  const panelChains = $('#panel-chains');
  const panelQuick = $('#panel-quick');

  // Recipes panel
  const recipeList = $('#recipeList');
  const recipeEmpty = $('#recipeEmpty');
  const btnRecord = $('#btnRecord');

  // Chains panel
  const chainList = $('#chainList');
  const chainEmpty = $('#chainEmpty');
  const btnNewChain = $('#btnNewChain');
  const chainForm = $('#chainForm');
  const chainNameInput = $('#chainNameInput');
  const chainRecipeSelect = $('#chainRecipeSelect');
  const chainPromptsInput = $('#chainPromptsInput');
  const btnSaveChain = $('#btnSaveChain');
  const btnCancelChain = $('#btnCancelChain');

  // Quick Run panel
  const currentRecipeInfo = $('#currentRecipeInfo');
  const quickPromptsInput = $('#quickPromptsInput');
  const btnQuickRun = $('#btnQuickRun');


  // ══════════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════════════

  async function init() {
    initTheming();
    setupFilterTabs();
    setupEventListeners();
    await checkCurrentTab();
    await loadRecipes();
    await loadChains();
    await checkCurrentTabRecipe();
    await checkActiveChainStatus();
    listenForStatusUpdates();
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
  //  CONNECTION STATUS (current tab awareness)
  // ══════════════════════════════════════════════════════════════════

  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      currentTabDomain = new URL(tab.url).hostname;

      const recipe = await PC.Storage.recipes.getByDomain(currentTabDomain);
      const connStatus = $('#connStatus');
      const connText = $('#currentDomain');

      if (recipe) {
        connStatus.classList.add('active');
        connText.innerHTML = `${escapeHtml(currentTabDomain)} <span style="opacity:0.7">— Recipe Active</span>`;
      } else {
        connStatus.classList.remove('active');
        connText.innerHTML = `${escapeHtml(currentTabDomain)} <span style="opacity:0.7">— No Recipe</span>`;
      }
    } catch (err) {
      $('#currentDomain').textContent = 'Cannot access current tab';
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  FILTER TAB SWITCHING
  // ══════════════════════════════════════════════════════════════════

  function setupFilterTabs() {
    const filterBtns = $$('.fc2');

    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        filterBtns.forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        currentFilter = btn.dataset.filter;
        showActivePanel();
      });
    });
  }

  function showActivePanel() {
    // Hide all panels
    panelRecipes.classList.remove('tab-content--active');
    panelChains.classList.remove('tab-content--active');
    panelQuick.classList.remove('tab-content--active');

    // Show the selected one
    switch (currentFilter) {
      case 'recipes':
        panelRecipes.classList.add('tab-content--active');
        break;
      case 'chains':
        panelChains.classList.add('tab-content--active');
        break;
      case 'quick':
        panelQuick.classList.add('tab-content--active');
        break;
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════════

  function setupEventListeners() {
    // Recording
    btnRecord.addEventListener('click', startRecording);

    // Chain form
    btnNewChain.addEventListener('click', showChainForm);
    btnSaveChain.addEventListener('click', saveChain);
    btnCancelChain.addEventListener('click', hideChainForm);

    // Quick run
    quickPromptsInput.addEventListener('input', updateQuickRunButton);
    btnQuickRun.addEventListener('click', quickRun);

    // Chain controls
    btnPause.addEventListener('click', () => PC.Messages.send(MSG.PAUSE_CHAIN));
    btnResume.addEventListener('click', () => PC.Messages.send(MSG.RESUME_CHAIN));
    btnCancel.addEventListener('click', () => PC.Messages.send(MSG.CANCEL_CHAIN));

    // Navigation (header)
    $('#btnOpenDashboard').addEventListener('click', () => PC.Messages.send(MSG.OPEN_DASHBOARD));
    // $('#btnOpenSidePanel').addEventListener('click', () => PC.Messages.send(MSG.OPEN_SIDEPANEL));
    $('#btnOpenSidePanel').addEventListener('click', openSidePanel);

    // Navigation (footer)
    $('#btnOpenDashboardFooter').addEventListener('click', () => PC.Messages.send(MSG.OPEN_DASHBOARD));
    // $('#btnOpenSidePanelFooter').addEventListener('click', () => PC.Messages.send(MSG.OPEN_SIDEPANEL));
    $('#btnOpenSidePanelFooter').addEventListener('click', openSidePanel);

    // Search — filters visible items in the active panel
    $('#searchInput').addEventListener('input', applySearch);
  }


  // ══════════════════════════════════════════════════════════════════
  //  SEARCH
  // ══════════════════════════════════════════════════════════════════

  function applySearch() {
    const query = $('#searchInput').value.toLowerCase().trim();

    // Filter recipe list items
    recipeList.querySelectorAll('.list-item').forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(query) ? '' : 'none';
    });

    // Filter chain list items
    chainList.querySelectorAll('.list-item').forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(query) ? '' : 'none';
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  RECIPES
  // ══════════════════════════════════════════════════════════════════

  async function loadRecipes() {
    const recipes = await PC.Storage.recipes.getAll();

    recipeList.innerHTML = '';

    if (recipes.length === 0) {
      recipeEmpty.style.display = 'block';
      recipeList.style.display = 'none';
      return;
    }

    recipeEmpty.style.display = 'none';
    recipeList.style.display = 'flex';

    for (const recipe of recipes) {
      const elCount = Object.values(recipe.elements || {}).filter(Boolean).length;
      const health = recipe.healthStatus || 'unknown';
      const healthDotClass = `health-dot--${health}`;

      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div class="list-item-info">
          <div class="list-item-name">
            <span class="health-dot ${healthDotClass}"></span>
            ${escapeHtml(recipe.name)}
          </div>
          <div class="list-item-meta">
            ${escapeHtml(recipe.domain)} · ${elCount}/4 elements
          </div>
        </div>
        <div class="list-item-actions">
          <button class="list-item-btn list-item-btn--delete" data-recipe-id="${recipe.id}" data-action="delete">🗑️</button>
        </div>
      `;

      // Delete handler
      item.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete recipe "${recipe.name}"?`)) {
          await PC.Storage.recipes.remove(recipe.id);
          await loadRecipes();
          await loadChainRecipeSelect();
        }
      });

      recipeList.appendChild(item);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  CHAINS
  // ══════════════════════════════════════════════════════════════════

  async function loadChains() {
    const chains = await PC.Storage.chains.getAll();

    chainList.innerHTML = '';

    if (chains.length === 0) {
      chainEmpty.style.display = chainForm.style.display === 'none' ? 'block' : 'none';
      chainList.style.display = 'none';
      return;
    }

    chainEmpty.style.display = 'none';
    chainList.style.display = 'flex';

    for (const chain of chains) {
      const promptCount = chain.prompts?.length || 0;

      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML = `
        <div class="list-item-info">
          <div class="list-item-name">${escapeHtml(chain.name)}</div>
          <div class="list-item-meta">
            ${promptCount} prompt${promptCount !== 1 ? 's' : ''}
            ${chain.recipeId ? '' : ' · <span style="color:#f87171;">no recipe</span>'}
          </div>
        </div>
        <div class="list-item-actions">
          <button class="list-item-btn list-item-btn--run" data-action="run">▶ Run</button>
          <button class="list-item-btn list-item-btn--delete" data-action="delete">🗑️</button>
        </div>
      `;

      // Run handler
      item.querySelector('[data-action="run"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        await runChain(chain);
      });

      // Delete handler
      item.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete chain "${chain.name}"?`)) {
          await PC.Storage.chains.remove(chain.id);
          await loadChains();
        }
      });

      chainList.appendChild(item);
    }
  }

  async function showChainForm() {
    chainForm.style.display = 'block';
    chainEmpty.style.display = 'none';
    btnNewChain.style.display = 'none';
    chainNameInput.value = '';
    chainPromptsInput.value = '';
    await loadChainRecipeSelect();
    chainNameInput.focus();
  }

  function hideChainForm() {
    chainForm.style.display = 'none';
    btnNewChain.style.display = 'inline-block';
    loadChains(); // Re-check empty state
  }

  async function loadChainRecipeSelect() {
    const recipes = await PC.Storage.recipes.getAll();
    chainRecipeSelect.innerHTML = '<option value="">-- Select a recipe --</option>';

    for (const recipe of recipes) {
      const option = document.createElement('option');
      option.value = recipe.id;
      option.textContent = `${recipe.name} (${recipe.domain})`;
      chainRecipeSelect.appendChild(option);
    }

    // Auto-select if there's only one recipe
    if (recipes.length === 1) {
      chainRecipeSelect.value = recipes[0].id;
    }
  }

  async function saveChain() {
    const name = chainNameInput.value.trim();
    const recipeId = chainRecipeSelect.value;
    const promptsText = chainPromptsInput.value.trim();

    if (!name) {
      alert('Please enter a chain name.');
      chainNameInput.focus();
      return;
    }

    if (!recipeId) {
      alert('Please select a recipe.');
      return;
    }

    if (!promptsText) {
      alert('Please enter at least one prompt.');
      chainPromptsInput.focus();
      return;
    }

    // Split prompts by newlines, filter empty
    const prompts = promptsText
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (prompts.length === 0) {
      alert('Please enter at least one prompt.');
      return;
    }

    await PC.Storage.chains.add({
      name,
      recipeId,
      prompts,
    });

    hideChainForm();
    await loadChains();
  }

  async function runChain(chain) {
    if (!chain.recipeId) {
      alert('This chain has no recipe assigned. Edit it in the Dashboard.');
      return;
    }

    const recipe = await PC.Storage.recipes.getById(chain.recipeId);
    if (!recipe) {
      alert('Recipe not found. It may have been deleted.');
      return;
    }

    // Send to background → content script
    const response = await PC.Messages.send(MSG.RUN_CHAIN, {
      chainId: chain.id,
      recipeId: chain.recipeId,
    });

    if (response?.success) {
      showStatus('running', `Running "${chain.name}" — 0/${chain.prompts.length}`);
    } else {
      alert(`Failed to start chain: ${response?.error || 'Unknown error'}`);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  QUICK RUN
  // ══════════════════════════════════════════════════════════════════

  async function checkCurrentTabRecipe() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        currentRecipeInfo.innerHTML = '<span class="hint">No active tab</span>';
        return;
      }

      const hostname = new URL(tab.url).hostname;
      const recipe = await PC.Storage.recipes.getByDomain(hostname);

      if (recipe) {
        _currentTabRecipe = recipe;
        const health = recipe.healthStatus || 'unknown';
        currentRecipeInfo.innerHTML = `
          <span class="health-dot health-dot--${health}"></span>
          <span class="current-recipe-name">${escapeHtml(recipe.name)}</span>
          <span class="hint"> — ${escapeHtml(recipe.domain)}</span>
        `;
        updateQuickRunButton();
      } else {
        _currentTabRecipe = null;
        currentRecipeInfo.innerHTML = `
          <span class="hint">No recipe for <strong>${escapeHtml(hostname)}</strong>.
          <a href="#" id="quickRecordLink">Record one</a>.</span>
        `;
        const link = $('#quickRecordLink');
        if (link) link.addEventListener('click', (e) => { e.preventDefault(); startRecording(); });
        updateQuickRunButton();
      }
    } catch (err) {
      currentRecipeInfo.innerHTML = '<span class="hint">Cannot access current tab</span>';
    }
  }

  function updateQuickRunButton() {
    const hasRecipe = _currentTabRecipe !== null;
    const hasPrompts = quickPromptsInput.value.trim().length > 0;
    btnQuickRun.disabled = !hasRecipe || !hasPrompts;
  }

  async function quickRun() {
    if (!_currentTabRecipe) {
      alert('No recipe for this site. Record one first.');
      return;
    }

    const promptsText = quickPromptsInput.value.trim();
    if (!promptsText) return;

    const prompts = promptsText
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (prompts.length === 0) return;

    // Create a temporary chain
    const chain = await PC.Storage.chains.add({
      name: `Quick Run ${new Date().toLocaleTimeString()}`,
      recipeId: _currentTabRecipe.id,
      prompts,
    });

    const response = await PC.Messages.send(MSG.RUN_CHAIN, {
      chainId: chain.id,
      recipeId: _currentTabRecipe.id,
    });

    if (response?.success) {
      showStatus('running', `Quick run — 0/${prompts.length}`);
      quickPromptsInput.value = '';
      updateQuickRunButton();
    } else {
      alert(`Failed: ${response?.error || 'Unknown error'}`);
      // Clean up temp chain
      await PC.Storage.chains.remove(chain.id);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  RECORDING
  // ══════════════════════════════════════════════════════════════════

  async function startRecording() {
    const response = await PC.Messages.send(MSG.START_RECORDING, {});

    if (response?.success) {
      // Close popup so user can interact with the page
      window.close();
    } else if (response?.error === 'Recording already in progress') {
      alert('A recording is already in progress on the current tab.');
    } else {
      alert(`Could not start recording: ${response?.error || 'Unknown error'}.\nMake sure you are on a web page.`);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  STATUS BAR
  // ══════════════════════════════════════════════════════════════════

  function showStatus(state, text) {
    statusBar.style.display = 'flex';

    // Reset classes
    statusBar.className = 'status-bar';

    switch (state) {
      case 'running':
        statusBar.classList.add('status-bar--running');
        statusIcon.textContent = '🔄';
        btnPause.style.display = 'inline-block';
        btnResume.style.display = 'none';
        break;
      case 'paused':
        statusBar.classList.add('status-bar--paused');
        statusIcon.textContent = '⏸';
        btnPause.style.display = 'none';
        btnResume.style.display = 'inline-block';
        break;
      case 'completed':
        statusBar.classList.add('status-bar--done');
        statusIcon.textContent = '✅';
        btnPause.style.display = 'none';
        btnResume.style.display = 'none';
        btnCancel.style.display = 'none';
        // Auto-hide after 5 seconds
        setTimeout(() => { statusBar.style.display = 'none'; }, 5000);
        break;
      case 'failed':
      case 'cancelled':
        statusBar.classList.add('status-bar--error');
        statusIcon.textContent = state === 'failed' ? '❌' : '⏹';
        btnPause.style.display = 'none';
        btnResume.style.display = 'none';
        btnCancel.style.display = 'none';
        setTimeout(() => { statusBar.style.display = 'none'; }, 5000);
        break;
      default:
        break;
    }

    btnCancel.style.display = (state === 'running' || state === 'paused') ? 'inline-block' : 'none';
    statusText.textContent = text;
  }

  function hideStatus() {
    statusBar.style.display = 'none';
  }

  async function checkActiveChainStatus() {
    // Ask background for current chain state
    const state = await PC.Storage.activeChain.get();
    if (state && (state.status === 'running' || state.status === 'starting')) {
      showStatus('running', `Chain running — step ${state.currentStep || 0}`);
    } else if (state && state.status === 'paused') {
      showStatus('paused', `Chain paused at step ${state.currentStep || 0}`);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  LIVE STATUS UPDATES
  // ══════════════════════════════════════════════════════════════════

  function listenForStatusUpdates() {
    PC.Messages.listen({

      [MSG.CHAIN_STARTED]: (msg) => {
        showStatus('running', `Running "${msg.chainName || 'chain'}" — 0/${msg.total}`);
      },

      [MSG.STEP_STARTED]: (msg) => {
        showStatus('running', `Step ${msg.step + 1}/${msg.total}: ${msg.promptPreview || '...'}`);
      },

      [MSG.STEP_COMPLETED]: (msg) => {
        showStatus('running', `Step ${msg.step + 1}/${msg.total} done ✓`);
      },

      [MSG.STEP_FAILED]: (msg) => {
        showStatus('running', `Step ${msg.step + 1}/${msg.total} failed — continuing...`);
      },

      [MSG.CHAIN_PAUSED]: (msg) => {
        showStatus('paused', `Paused at step ${(msg.step || 0) + 1}`);
      },

      [MSG.CHAIN_RESUMED]: (msg) => {
        showStatus('running', `Resumed at step ${(msg.step || 0) + 1}`);
      },

      [MSG.CHAIN_COMPLETED]: (msg) => {
        showStatus('completed',
          `Done! ${msg.success}/${msg.total} succeeded — ${PC.Utils.formatDuration(msg.duration)}`
        );
        loadChains(); // Refresh list
      },

      [MSG.CHAIN_FAILED]: (msg) => {
        showStatus('failed', `Failed: ${msg.error || 'Unknown error'}`);
      },

      [MSG.CHAIN_CANCELLED]: () => {
        showStatus('cancelled', 'Chain cancelled');
      },

      [MSG.USER_INTERFERENCE]: () => {
        showStatus('paused', 'Paused — manual input detected');
      },

      [MSG.RECORDING_COMPLETE]: () => {
        loadRecipes();
        loadChains();       // Recipe select may need refresh
        checkCurrentTab();  // Refresh connection status
        checkCurrentTabRecipe(); // Refresh quick run recipe info
      },
    });
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

  // ══════════════════════════════════════════════════════════════════
  //  SIDE PANEL (must be called directly from user gesture)
  // ══════════════════════════════════════════════════════════════════

  async function openSidePanel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        alert('No active tab found.');
        return;
      }
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close(); // close popup after opening side panel
    } catch (err) {
      console.warn('Failed to open side panel:', err);
      alert(`Could not open side panel: ${err.message}`);
    }
  }


  // ── Start ───────────────────────────────────────────────────────
  init();

})();

