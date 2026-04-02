/**
 * dashboard/dashboard.js
 * ────────────────────────────────────────────
 * Dashboard UI logic.
 *
 * Responsibilities:
 *   - Overview stats (recipes, chains, runs today)
 *   - Recipe library (list, health, delete, record)
 *   - Chain management (list, create, edit, delete, run)
 *   - Chain editor (name, recipe select, prompt list with add/remove/reorder)
 *   - Global search across recipes & chains
 *   - Theme & color toggling
 *   - Listen for recording/chain status updates
 *
 * Does NOT execute chains — sends messages to background.
 */
(() => {
  const MSG = PC.MessageTypes;

  // ── DOM Helpers ─────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── State ───────────────────────────────────────────────────────
  let recipes = [];
  let chains = [];
  let selectedChainId = null;  // currently selected chain in editor


  // ══════════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════════════

  async function init() {
    initTheming();
    setupNav();
    setupGlobalSearch();
    setupEventListeners();
    await loadData();
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

    // Theme toggle (light/dark)
    $('#btnThemeToggle').addEventListener('click', () => {
      const next = htmlEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      htmlEl.setAttribute('data-theme', next);
      localStorage.setItem('pc_theme', next);
    });

    // Color toggle (teal/orange)
    $('#btnColorToggle').addEventListener('click', () => {
      const next = htmlEl.getAttribute('data-color') === 'teal' ? 'orange' : 'teal';
      htmlEl.setAttribute('data-color', next);
      localStorage.setItem('pc_color', next);
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  NAVIGATION
  // ══════════════════════════════════════════════════════════════════

  function setupNav() {
    $$('.ni').forEach((navItem) => {
      navItem.addEventListener('click', () => {
        // Update active state in sidebar
        $$('.ni').forEach((n) => n.classList.remove('active'));
        navItem.classList.add('active');

        // Show target view, hide others
        const targetId = navItem.dataset.target;
        $$('.view-section').forEach((v) => {
          v.classList.toggle('active', v.id === targetId);
        });

        // Update breadcrumb
        const title = navItem.textContent.trim().replace(/\d+$/, '').trim();
        $('#breadcrumb').textContent = `/ ${title}`;
      });
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  GLOBAL SEARCH
  // ══════════════════════════════════════════════════════════════════

  function setupGlobalSearch() {
    $('#globalSearch').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();

      // Filter library recipe items
      $$('#library-list .pr').forEach((item) => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
      });

      // Filter chain sidebar items
      $$('#chain-sidebar-list .chain-sidebar-item').forEach((item) => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
      });
    });
  }


  // ══════════════════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════════

  function setupEventListeners() {
    // ── Top bar ──
    $('#btnRecordNew').addEventListener('click', startRecording);

    // ── Library view ──
    $('#btnRefreshRecipes').addEventListener('click', loadData);
    $('#btnRecordFromLib').addEventListener('click', startRecording);

    // ── Chains view ──
    $('#btnNewChain').addEventListener('click', () => openChainEditor(null));
    $('#btnNewChainAlt').addEventListener('click', () => openChainEditor(null));

    // ── Chain search ──
    $('#chainSearch').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      $$('#chain-sidebar-list .chain-sidebar-item').forEach((item) => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
      });
    });

    // ── Dashboard quick actions ──
    $('#dashBtnRecord').addEventListener('click', startRecording);
    $('#dashBtnNewChain').addEventListener('click', () => {
      // Switch to chains view and open editor
      $$('.ni').forEach((n) => n.classList.remove('active'));
      const chainsNav = $('[data-target="view-chains"]');
      chainsNav.classList.add('active');
      $$('.view-section').forEach((v) => v.classList.toggle('active', v.id === 'view-chains'));
      $('#breadcrumb').textContent = '/ Chains';
      openChainEditor(null);
    });
    $('#dashBtnExport').addEventListener('click', exportAll);
    $('#dashBtnImport').addEventListener('click', importData);
  }


  // ══════════════════════════════════════════════════════════════════
  //  DATA LOADING
  // ══════════════════════════════════════════════════════════════════

  async function loadData() {
    recipes = await PC.Storage.recipes.getAll();
    chains = await PC.Storage.chains.getAll();

    // Update stat counts
    $('#count-recipes').textContent = recipes.length;
    $('#stat-recipes').textContent = recipes.length;
    $('#count-chains').textContent = chains.length;
    $('#stat-chains').textContent = chains.length;

    renderLibrary();
    renderChainSidebar();
    renderDashboardRecentChains();

    // If a chain was selected, re-render its editor
    if (selectedChainId) {
      const chain = chains.find((c) => c.id === selectedChainId);
      if (chain) {
        openChainEditor(chain);
      } else {
        selectedChainId = null;
        showChainBuilderEmpty();
      }
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  LIBRARY (Recipes)
  // ══════════════════════════════════════════════════════════════════

  function renderLibrary() {
    const container = $('#library-list');
    const emptyState = $('#library-empty');

    container.innerHTML = '';

    if (recipes.length === 0) {
      container.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    container.style.display = 'block';
    emptyState.style.display = 'none';

    for (const recipe of recipes) {
      const elCount = Object.values(recipe.elements || {}).filter(Boolean).length;
      const health = recipe.healthStatus || 'unknown';

      const item = document.createElement('div');
      item.className = 'pr';
      item.innerHTML = `
        <div class="pr-info">
          <div class="pt">
            <span class="health-dot health-dot--${health}"></span>
            ${escapeHtml(recipe.name)}
          </div>
          <div class="ps">${escapeHtml(recipe.domain)}</div>
          <div class="pm">
            <span>Elements: ${elCount}/4</span>
            <span>Health: <span class="pill ${health === 'good' ? 'g' : health === 'bad' ? 'd' : ''}">${health}</span></span>
            <span>Created: ${formatDate(recipe.createdAt)}</span>
          </div>
        </div>
        <div class="pr-actions">
          <button class="btn" data-action="test" data-id="${recipe.id}">🔍 Test</button>
          <button class="btn btn--danger" data-action="delete" data-id="${recipe.id}">🗑️ Delete</button>
        </div>
      `;

      // Test handler (health check)
      item.querySelector('[data-action="test"]').addEventListener('click', async () => {
        try {
          const response = await PC.Messages.send(MSG.CHECK_HEALTH, { recipeId: recipe.id });
          if (response?.success) {
            alert(`Health check passed! All selectors found.`);
          } else {
            alert(`Health check: ${response?.error || 'Some selectors not found.'}`);
          }
        } catch (err) {
          alert(`Cannot run health check: ${err.message}\nMake sure you have the target site open.`);
        }
        await loadData();
      });

      // Delete handler
      item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (confirm(`Delete recipe "${recipe.name}"?`)) {
          await PC.Storage.recipes.remove(recipe.id);
          await loadData();
        }
      });

      container.appendChild(item);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  CHAINS — SIDEBAR LIST
  // ══════════════════════════════════════════════════════════════════

  function renderChainSidebar() {
    const sidebar = $('#chain-sidebar-list');
    const emptyState = $('#chain-sidebar-empty');

    sidebar.innerHTML = '';

    if (chains.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    for (const chain of chains) {
      const recipeName = recipes.find((r) => r.id === chain.recipeId)?.name || 'No recipe';
      const promptCount = chain.prompts?.length || 0;

      const item = document.createElement('div');
      item.className = 'chain-sidebar-item';
      if (chain.id === selectedChainId) item.classList.add('active');

      item.innerHTML = `
        <div class="chain-sidebar-item-name">${escapeHtml(chain.name)}</div>
        <div class="chain-sidebar-item-meta">
          ${promptCount} prompt${promptCount !== 1 ? 's' : ''} · ${escapeHtml(recipeName)}
        </div>
      `;

      item.addEventListener('click', () => {
        selectedChainId = chain.id;
        openChainEditor(chain);
        // Update active state in sidebar
        $$('.chain-sidebar-item').forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
      });

      sidebar.appendChild(item);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  CHAINS — EDITOR
  // ══════════════════════════════════════════════════════════════════

  function showChainBuilderEmpty() {
    $('#chain-builder-empty').style.display = 'flex';
    $('#chain-editor').style.display = 'none';
  }

  function openChainEditor(chain) {
    const emptyEl = $('#chain-builder-empty');
    const editorEl = $('#chain-editor');

    emptyEl.style.display = 'none';
    editorEl.style.display = 'block';

    // Determine if new chain or editing existing
    const isNew = !chain;
    const editChain = chain || { name: '', recipeId: '', prompts: [''] };

    if (chain) {
      selectedChainId = chain.id;
    }

    // ── Name ──
    const nameInput = $('#chainEditorName');
    nameInput.value = editChain.name;

    // ── Recipe Select ──
    const recipeSelect = $('#chainEditorRecipe');
    recipeSelect.innerHTML = '<option value="">-- Select a recipe --</option>';
    for (const recipe of recipes) {
      const option = document.createElement('option');
      option.value = recipe.id;
      option.textContent = `${recipe.name} (${recipe.domain})`;
      recipeSelect.appendChild(option);
    }
    recipeSelect.value = editChain.recipeId || '';

    // ── Prompts ──
    renderPromptList(editChain.prompts || ['']);

    // ── Add Prompt ──
    $('#btnAddPrompt').onclick = () => {
      const prompts = collectPromptsFromEditor();
      prompts.push('');
      renderPromptList(prompts);
    };

    // ── Run ──
    $('#btnRunChain').onclick = async () => {
      if (isNew) {
        alert('Save the chain first before running.');
        return;
      }
      await runChain(chain);
    };
    // Show/hide run button for new chains
    $('#btnRunChain').style.display = isNew ? 'none' : 'inline-block';

    // ── Delete ──
    $('#btnDeleteChain').onclick = async () => {
      if (isNew) return;
      if (confirm(`Delete chain "${editChain.name}"?`)) {
        await PC.Storage.chains.remove(editChain.id);
        selectedChainId = null;
        showChainBuilderEmpty();
        await loadData();
      }
    };
    $('#btnDeleteChain').style.display = isNew ? 'none' : 'inline-block';

    // ── Save ──
    $('#btnSaveChainEditor').onclick = async () => {
      const name = nameInput.value.trim();
      const recipeId = recipeSelect.value;
      const prompts = collectPromptsFromEditor();

      if (!name) {
        alert('Please enter a chain name.');
        nameInput.focus();
        return;
      }
      if (!recipeId) {
        alert('Please select a recipe.');
        return;
      }
      if (prompts.length === 0) {
        alert('Please enter at least one prompt.');
        return;
      }

      if (isNew) {
        const newChain = await PC.Storage.chains.add({ name, recipeId, prompts });
        selectedChainId = newChain.id;
      } else {
        await PC.Storage.chains.update(editChain.id, { name, recipeId, prompts });
      }

      await loadData();
    };

    // ── Cancel ──
    $('#btnCancelChainEditor').onclick = () => {
      selectedChainId = null;
      showChainBuilderEmpty();
      // Deselect in sidebar
      $$('.chain-sidebar-item').forEach((el) => el.classList.remove('active'));
    };
  }

  function renderPromptList(prompts) {
    const container = $('#chainEditorPrompts');
    const countEl = $('#chainEditorPromptCount');
    container.innerHTML = '';

    const validPrompts = prompts.filter((p) => p.trim().length > 0);
    countEl.textContent = `(${validPrompts.length})`;

    prompts.forEach((prompt, index) => {
      const item = document.createElement('div');
      item.className = 'chain-prompt-item';
      item.draggable = true;
      item.dataset.index = index;

      item.innerHTML = `
        <div class="chain-prompt-number">${index + 1}</div>
        <textarea class="chain-prompt-textarea" rows="2" placeholder="Enter prompt...">${escapeHtml(prompt)}</textarea>
        <div class="chain-prompt-actions">
          <button class="chain-prompt-btn chain-prompt-btn--drag" title="Drag to reorder">⠿</button>
          <button class="chain-prompt-btn chain-prompt-btn--delete" title="Remove" data-action="remove">✕</button>
        </div>
      `;

      // Remove prompt
      item.querySelector('[data-action="remove"]').addEventListener('click', () => {
        const currentPrompts = collectPromptsFromEditor();
        currentPrompts.splice(index, 1);
        if (currentPrompts.length === 0) currentPrompts.push('');
        renderPromptList(currentPrompts);
      });

      // Drag & drop
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', index);
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIndex = index;
        if (fromIndex === toIndex) return;

        const currentPrompts = collectPromptsFromEditor();
        const [moved] = currentPrompts.splice(fromIndex, 1);
        currentPrompts.splice(toIndex, 0, moved);
        renderPromptList(currentPrompts);
      });

      // Update count on input
      item.querySelector('.chain-prompt-textarea').addEventListener('input', () => {
        const valid = collectPromptsFromEditor().filter((p) => p.trim().length > 0);
        countEl.textContent = `(${valid.length})`;
      });

      container.appendChild(item);
    });
  }

  function collectPromptsFromEditor() {
    const textareas = $$('#chainEditorPrompts .chain-prompt-textarea');
    return Array.from(textareas).map((ta) => ta.value.trim()).filter((p) => p.length > 0);
  }


  // ══════════════════════════════════════════════════════════════════
  //  CHAINS — RUN
  // ══════════════════════════════════════════════════════════════════

  async function runChain(chain) {
    if (!chain.recipeId) {
      alert('This chain has no recipe assigned. Please select a recipe and save.');
      return;
    }

    const recipe = recipes.find((r) => r.id === chain.recipeId);
    if (!recipe) {
      alert('Recipe not found. It may have been deleted.');
      return;
    }

    const response = await PC.Messages.send(MSG.RUN_CHAIN, {
      chainId: chain.id,
      recipeId: chain.recipeId,
    });

    if (response?.success) {
      alert(`Chain "${chain.name}" started! Check the popup or side panel for status.`);
    } else {
      alert(`Failed to start chain: ${response?.error || 'Unknown error'}`);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  DASHBOARD — RECENT CHAINS
  // ══════════════════════════════════════════════════════════════════

  function renderDashboardRecentChains() {
    const container = $('#dash-recent-chains');
    container.innerHTML = '';

    if (chains.length === 0) {
      container.innerHTML = '<div class="card-empty">No chains created yet.</div>';
      return;
    }

    // Show up to 5 most recent chains
    const recent = chains.slice(-5).reverse();

    for (const chain of recent) {
      const recipeName = recipes.find((r) => r.id === chain.recipeId)?.name || 'No recipe';
      const promptCount = chain.prompts?.length || 0;

      const item = document.createElement('div');
      item.className = 'dash-chain-item';
      item.innerHTML = `
        <span class="dash-chain-name">${escapeHtml(chain.name)}</span>
        <span class="dash-chain-meta">${promptCount} steps · ${escapeHtml(recipeName)}</span>
      `;
      container.appendChild(item);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  RECORDING
  // ══════════════════════════════════════════════════════════════════

  async function startRecording() {
    const response = await PC.Messages.send(MSG.START_RECORDING, {});

    if (response?.success) {
      alert('Recording started! Switch to the target AI chat site and interact with the page. The popup will capture your selectors.');
    } else if (response?.error === 'Recording already in progress') {
      alert('A recording is already in progress.');
    } else {
      alert(`Could not start recording: ${response?.error || 'Unknown error'}.\nMake sure you have an AI chat site open in the active tab.`);
    }
  }


  // ══════════════════════════════════════════════════════════════════
  //  EXPORT / IMPORT
  // ══════════════════════════════════════════════════════════════════

  async function exportAll() {
    try {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        recipes,
        chains,
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompt-chain-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  }

  async function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.recipes && !data.chains) {
          alert('Invalid import file: no recipes or chains found.');
          return;
        }

        let importedRecipes = 0;
        let importedChains = 0;

        if (data.recipes && Array.isArray(data.recipes)) {
          for (const recipe of data.recipes) {
            await PC.Storage.recipes.add(recipe);
            importedRecipes++;
          }
        }

        if (data.chains && Array.isArray(data.chains)) {
          for (const chain of data.chains) {
            await PC.Storage.chains.add(chain);
            importedChains++;
          }
        }

        alert(`Imported ${importedRecipes} recipe(s) and ${importedChains} chain(s).`);
        await loadData();
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
    });

    input.click();
  }


  // ══════════════════════════════════════════════════════════════════
  //  LIVE STATUS UPDATES
  // ══════════════════════════════════════════════════════════════════

  function listenForStatusUpdates() {
    PC.Messages.listen({

      [MSG.CHAIN_STARTED]: (msg) => {
        PC.Logger?.log(`Chain started: ${msg.chainName}`);
      },

      [MSG.CHAIN_COMPLETED]: (msg) => {
        PC.Logger?.log(`Chain completed: ${msg.success}/${msg.total} succeeded`);
        loadData(); // Refresh data
      },

      [MSG.CHAIN_FAILED]: (msg) => {
        PC.Logger?.log(`Chain failed: ${msg.error}`);
      },

      [MSG.CHAIN_CANCELLED]: () => {
        PC.Logger?.log('Chain cancelled');
      },

      [MSG.RECORDING_COMPLETE]: () => {
        PC.Logger?.log('Recording complete — refreshing data');
        loadData();
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

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '—';
    }
  }


  // ── Start ───────────────────────────────────────────────────────
  init();

})();