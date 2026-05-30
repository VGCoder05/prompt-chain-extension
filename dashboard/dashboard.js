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
  let workflows = [];
  let chains = [];
  let selectedChainId = null;  // currently selected chain in editor
  let selectedWorkflowId = null;  // currently selected workflow in editor

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

  /**
 * Navigate to a view programmatically.
 */
  function navigateTo(viewId) {
    $$('.ni').forEach((n) => {
      n.classList.toggle('active', n.dataset.target === viewId);
    });
    $$('.view-section').forEach((v) => {
      v.classList.toggle('active', v.id === viewId);
    });
    const navItem = $(`[data-target="${viewId}"]`);
    if (navItem) {
      const title = navItem.textContent.trim().replace(/\d+$/, '').trim();
      $('#breadcrumb').textContent = `/ ${title}`;
    }
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
    $('#btnNewWorkflow').addEventListener('click', () => {
      navigateTo('view-workflows');
      openWorkflowEditor(null);
    });

    // ── Library view ──
    $('#btnRefreshRecipes').addEventListener('click', loadData);
    $('#btnRecordFromLib').addEventListener('click', startRecording);

    // ── Chains view ──
    $('#btnNewChain').addEventListener('click', () => openChainEditor(null));
    $('#btnNewChainAlt').addEventListener('click', () => openChainEditor(null));

    // ── Workflows view (✅ NEW) ──
    $('#btnNewWorkflowAlt').addEventListener('click', () => openWorkflowEditor(null));
    $('#btnRecordWorkflow').addEventListener('click', startRecording);

    // ── Workflow search ──
    $('#workflowSearch').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      $$('#workflow-sidebar-list .chain-sidebar-item').forEach((item) => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? '' : 'none';
      });
    });

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
    // $('#dashBtnNewChain').addEventListener('click', () => {
    //   // Switch to chains view and open editor
    //   $$('.ni').forEach((n) => n.classList.remove('active'));
    //   const chainsNav = $('[data-target="view-chains"]');
    //   chainsNav.classList.add('active');
    //   $$('.view-section').forEach((v) => v.classList.toggle('active', v.id === 'view-chains'));
    //   $('#breadcrumb').textContent = '/ Chains';
    //   openChainEditor(null);
    // });      
    $('#dashBtnNewWorkflow').addEventListener('click', () => {
      navigateTo('view-workflows');
      openWorkflowEditor(null);
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
    workflows = await PC.Storage.workflows.getAll();

    // Update stat counts
    $('#count-recipes').textContent = recipes.length;
    $('#count-chains').textContent = chains.length;
    $('#count-workflows').textContent = workflows.length;

    $('#stat-recipes').textContent = recipes.length;
    $('#stat-workflows').textContent = workflows.length;

    // Update runs today
    const logsToday = await PC.Storage.logs.getFiltered({
      limit: 1000,
    });
    const today = new Date().toDateString();
    const runsToday = logsToday.filter(
      (l) => new Date(l.timestamp).toDateString() === today
    ).length;
    $('#stat-runs-today').textContent = runsToday;

    renderLibrary();
    renderChainSidebar();
    renderWorkflowSidebar();
    renderDashboardRecentWorkflows();

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

    // ✅ NEW : For Workflow
    if (selectedWorkflowId) {
      const workflow = workflows.find((w) => w.id === selectedWorkflowId);
      if (workflow) {
        openWorkflowEditor(workflow);
      } else {
        selectedWorkflowId = null;
        showWorkflowBuilderEmpty();
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

  function renderWorkflowSidebar() {
    const sidebar = $('#workflow-sidebar-list');
    const emptyState = $('#workflow-sidebar-empty');

    sidebar.innerHTML = '';

    if (workflows.length === 0) {
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';

    for (const workflow of workflows) {
      const stepCount = workflow.steps?.length || 0;
      const item = document.createElement('div');
      item.className = 'chain-sidebar-item';
      if (workflow.id === selectedWorkflowId) item.classList.add('active');

      item.innerHTML = `
      <div class="chain-sidebar-item-name">${escapeHtml(workflow.name)}</div>
      <div class="chain-sidebar-item-meta">
        ${stepCount} step${stepCount !== 1 ? 's' : ''} · ${escapeHtml(workflow.domain || '')}
      </div>
    `;

      item.addEventListener('click', () => {
        selectedWorkflowId = workflow.id;
        openWorkflowEditor(workflow);
        $$('#workflow-sidebar-list .chain-sidebar-item').forEach((el) =>
          el.classList.remove('active')
        );
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


  // ══════════════════════════════════════════════════════════════════
  //  Workflow — EDITOR
  // ══════════════════════════════════════════════════════════════════
  function showWorkflowBuilderEmpty() {
    $('#workflow-builder-empty').style.display = 'flex';
    $('#workflow-editor').style.display = 'none';
  }

  function openWorkflowEditor(workflow) {
    const emptyEl = $('#workflow-builder-empty');
    const editorEl = $('#workflow-editor');

    emptyEl.style.display = 'none';
    editorEl.style.display = 'block';

    const isNew = !workflow;
    const editWorkflow = workflow || {
      name: 'New Workflow',
      domain: '',
      steps: [],
      variables: {},
    };

    if (workflow) selectedWorkflowId = workflow.id;

    // ── Name ──
    $('#workflowEditorName').value = editWorkflow.name;

    // ── Meta ──
    $('#workflowMeta').innerHTML = workflow ? `
    <span class="workflow-meta-item">🌐 ${escapeHtml(editWorkflow.domain || 'Unknown domain')}</span>
    <span class="workflow-meta-item">📅 ${formatDate(editWorkflow.createdAt)}</span>
    <span class="workflow-meta-item">📝 ${editWorkflow.steps?.length || 0} steps</span>
  ` : '<span class="workflow-meta-item">New workflow</span>';

    // ── Variables ──
    renderWorkflowVariables(editWorkflow.variables || {});

    // ── Steps ──
    renderWorkflowSteps(editWorkflow.steps || []);

    // ── Run Button ──
    $('#btnRunWorkflow').style.display = isNew ? 'none' : 'inline-block';
    $('#btnRunWorkflow').onclick = async () => {
      await runWorkflow(editWorkflow);
    };

    // ── Health Check ──
    $('#btnHealthCheckWorkflow').onclick = async () => {
      await healthCheckWorkflow(editWorkflow);
    };

    // ── Delete ──
    $('#btnDeleteWorkflow').style.display = isNew ? 'none' : 'inline-block';
    $('#btnDeleteWorkflow').onclick = async () => {
      if (!workflow) return;
      if (confirm(`Delete workflow "${editWorkflow.name}"?`)) {
        await PC.Storage.workflows.remove(editWorkflow.id);
        selectedWorkflowId = null;
        showWorkflowBuilderEmpty();
        await loadData();
      }
    };

    // ── Save ──
    $('#btnSaveWorkflow').onclick = async () => {
      const name = $('#workflowEditorName').value.trim();
      if (!name) {
        alert('Please enter a workflow name.');
        return;
      }

      const steps = collectStepsFromEditor();
      const variables = collectVariablesFromEditor();

      if (isNew) {
        const newWorkflow = await PC.Storage.workflows.add({
          name,
          domain: editWorkflow.domain,
          steps,
          variables,
        });
        selectedWorkflowId = newWorkflow.id;
      } else {
        await PC.Storage.workflows.update(editWorkflow.id, { name, steps, variables });
      }

      await loadData();
    };

    // ── Cancel ──
    $('#btnCancelWorkflow').onclick = () => {
      selectedWorkflowId = null;
      showWorkflowBuilderEmpty();
      $$('#workflow-sidebar-list .chain-sidebar-item').forEach((el) =>
        el.classList.remove('active')
      );
    };

    // ── Export Single Workflow ──
    $('#btnExportWorkflow').onclick = () => {
      if (!workflow) return;
      const blob = new Blob(
        [JSON.stringify(workflow, null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workflow-${workflow.name.toLowerCase().replace(/\s+/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
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

  function renderWorkflowVariables(variables) {
    const container = $('#workflowVariablesList');
    container.innerHTML = '';

    const entries = Object.entries(variables);

    if (entries.length === 0) {
      container.innerHTML = '<div class="card-empty hint">No variables defined. They will be added automatically from steps with {{VARIABLE_NAME}} values.</div>';
      return;
    }

    for (const [name, config] of entries) {
      const item = document.createElement('div');
      item.className = 'workflow-variable-item';
      item.dataset.varName = name;

      const labelText = typeof config === 'object' ? config.label || name : name;
      const defaultVal = typeof config === 'object' ? config.default || '' : config;

      item.innerHTML = `
      <div class="workflow-variable-header">
        <span class="workflow-variable-tag">{{${escapeHtml(name)}}}</span>
        <button class="chain-prompt-btn chain-prompt-btn--delete" 
                data-action="remove-var" title="Remove variable">✕</button>
      </div>
      <div class="workflow-variable-fields">
        <input type="text" class="chain-field-input var-label-input"
               placeholder="Display label" value="${escapeHtml(labelText)}" />
        <input type="text" class="chain-field-input var-default-input"
               placeholder="Default value" value="${escapeHtml(defaultVal)}" />
      </div>
    `;

      item.querySelector('[data-action="remove-var"]').addEventListener('click', () => {
        item.remove();
      });

      container.appendChild(item);
    }
  }

  function collectVariablesFromEditor() {
    const variables = {};
    $$('#workflowVariablesList .workflow-variable-item').forEach((item) => {
      const name = item.dataset.varName;
      const label = item.querySelector('.var-label-input')?.value.trim() || name;
      const defaultVal = item.querySelector('.var-default-input')?.value.trim() || '';
      variables[name] = {
        label,
        type: 'text',
        required: true,
        default: defaultVal,
      };
    });
    return variables;
  }

  function renderWorkflowSteps(steps) {
    const container = $('#workflowStepsList');
    const countEl = $('#workflowStepCount');
    container.innerHTML = '';
    countEl.textContent = `(${steps.length})`;

    if (steps.length === 0) {
      container.innerHTML = `
      <div class="card-empty hint">
        No steps recorded. Click "🎯 Record New" to record a workflow.
      </div>
    `;
      return;
    }

    const actionLabels = {
      type: '⌨️ Type text',
      click: '👆 Click element',
      waitForAppear: '👀 Wait for appear',
      waitForDisappear: '⏳ Wait for disappear',
    };

    steps.forEach((step, index) => {
      const item = document.createElement('div');
      item.className = 'chain-prompt-item workflow-step-item';
      item.draggable = true;
      item.dataset.index = index;

      // Build value display
      const valueDisplay = step.value
        ? `<div class="workflow-step-value">
           Value: 
           <span class="workflow-step-value-text" 
                 data-step-index="${index}">${escapeHtml(step.value)}</span>
           ${step.variableName
          ? `<span class="workflow-var-badge">{{${escapeHtml(step.variableName)}}}</span>`
          : ''}
         </div>`
        : '';

      item.innerHTML = `
      <div class="chain-prompt-number">${index + 1}</div>
      <div class="step-body workflow-step-body">
        <div class="workflow-step-action">
          ${actionLabels[step.action] || step.action}
        </div>
        <div class="workflow-step-description">
          ${escapeHtml(step.description || '')}
        </div>
        ${valueDisplay}
      </div>
      <div class="chain-prompt-actions">
        <button class="chain-prompt-btn" 
                data-action="make-variable" 
                data-index="${index}"
                title="Convert value to variable">{{x}}</button>
        <button class="chain-prompt-btn chain-prompt-btn--drag" 
                title="Drag to reorder">⠿</button>
        <button class="chain-prompt-btn chain-prompt-btn--delete" 
                data-action="remove-step" 
                data-index="${index}"
                title="Remove step">✕</button>
      </div>
    `;

      // ✅ Remove step
      item.querySelector('[data-action="remove-step"]').addEventListener('click', () => {
        const currentSteps = collectStepsFromEditor();
        currentSteps.splice(index, 1);
        renderWorkflowSteps(currentSteps);
      });

      // ✅ Convert value to variable
      item.querySelector('[data-action="make-variable"]')?.addEventListener('click', () => {
        if (!step.value || step.variableName) return;

        const varName = prompt(
          `Convert "${PC.Utils.truncate(step.value, 30)}" to a variable?\n` +
          `Enter variable name (e.g., USER_PROMPT):`,
          'USER_PROMPT'
        );

        if (!varName) return;

        const cleanName = varName.trim().toUpperCase().replace(/\s+/g, '_');
        const currentSteps = collectStepsFromEditor();
        currentSteps[index] = {
          ...currentSteps[index],
          value: `{{${cleanName}}}`,
          variableName: cleanName,
        };

        // Auto-add variable to variables section
        const existingVars = collectVariablesFromEditor();
        if (!existingVars[cleanName]) {
          const container = $('#workflowVariablesList');
          const varItem = document.createElement('div');
          varItem.className = 'workflow-variable-item';
          varItem.dataset.varName = cleanName;
          varItem.innerHTML = `
          <div class="workflow-variable-header">
            <span class="workflow-variable-tag">{{${escapeHtml(cleanName)}}}</span>
            <button class="chain-prompt-btn chain-prompt-btn--delete"
                    data-action="remove-var" title="Remove variable">✕</button>
          </div>
          <div class="workflow-variable-fields">
            <input type="text" class="chain-field-input var-label-input"
                   placeholder="Display label" value="${escapeHtml(cleanName)}" />
            <input type="text" class="chain-field-input var-default-input"
                   placeholder="Default value" value="" />
          </div>
        `;
          varItem.querySelector('[data-action="remove-var"]').addEventListener('click', () => {
            varItem.remove();
          });
          container.appendChild(varItem);
        }

        renderWorkflowSteps(currentSteps);
      });

      // ✅ Drag & drop
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', index);
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });

      item.addEventListener('dragover', (e) => e.preventDefault());

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIndex = index;
        if (fromIndex === toIndex) return;

        const currentSteps = collectStepsFromEditor();
        const [moved] = currentSteps.splice(fromIndex, 1);
        currentSteps.splice(toIndex, 0, moved);
        renderWorkflowSteps(currentSteps);
      });

      container.appendChild(item);
    });
  }

  function collectStepsFromEditor() {
    // Steps are read-only in the editor (recorded, not typed)
    // Return the current steps from the rendered items
    const items = $$('#workflowStepsList .workflow-step-item');
    const currentWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
    if (!currentWorkflow) return [];

    // Map rendered items back to steps (preserving fingerprints)
    return Array.from(items).map((item, index) => {
      const stepIndex = parseInt(item.dataset.index, 10);
      return currentWorkflow.steps[stepIndex];
    }).filter(Boolean);
  }

  async function runWorkflow(workflow) {
    if (!workflow.steps || workflow.steps.length === 0) {
      alert('This workflow has no steps. Record or add steps first.');
      return;
    }

    // Collect variable values from user
    const variables = {};
    const variableDefs = workflow.variables || {};

    for (const [name, config] of Object.entries(variableDefs)) {
      const label = typeof config === 'object' ? config.label || name : name;
      const defaultVal = typeof config === 'object' ? config.default || '' : '';
      const value = prompt(`Enter value for: ${label}`, defaultVal);
      if (value === null) return; // User cancelled
      variables[name] = value;
    }

    const response = await PC.Messages.runWorkflow(workflow, variables);

    if (response?.success !== false) {
      alert(`Workflow "${workflow.name}" started!\nCheck the side panel for live progress.`);
    } else {
      alert(`Failed to start workflow: ${response?.error || 'Unknown error'}`);
    }
  }

  async function healthCheckWorkflow(workflow) {
    try {
      const response = await PC.Messages.send(PC.MessageTypes.CHECK_HEALTH, {
        workflow,
      });

      if (response?.canRun) {
        alert(`✅ Health check passed!\n${workflow.steps.length} steps verified.`);
      } else if (response?.overall === 'degraded') {
        alert(`⚠️ Workflow degraded.\nSome selectors may have changed.\nBroken steps: ${response.brokenSteps?.join(', ') || 'none'}`);
      } else {
        alert(`❌ Health check failed.\nBroken steps: ${response?.brokenSteps?.join(', ') || 'unknown'}\n\nConsider re-recording this workflow.`);
      }
    } catch (err) {
      alert(`Cannot run health check: ${err.message}\nMake sure you have the target site open.`);
    }
  }

  function renderDashboardRecentWorkflows() {
    const container = $('#dash-recent-workflows');
    container.innerHTML = '';

    const allItems = [
      ...workflows.map((w) => ({ ...w, _type: 'workflow' })),
      ...chains.map((c) => ({ ...c, _type: 'chain' })),
    ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);

    if (allItems.length === 0) {
      container.innerHTML = '<div class="card-empty">No workflows created yet.</div>';
      return;
    }

    for (const item of allItems) {
      const el = document.createElement('div');
      el.className = 'dash-chain-item';

      const icon = item._type === 'workflow' ? '🎬' : '⛓';
      const meta = item._type === 'workflow'
        ? `${item.steps?.length || 0} steps · ${item.domain || ''}`
        : `${item.prompts?.length || 0} prompts`;

      el.innerHTML = `
      <span class="dash-chain-name">${icon} ${escapeHtml(item.name)}</span>
      <span class="dash-chain-meta">${escapeHtml(meta)}</span>
    `;

      el.addEventListener('click', () => {
        if (item._type === 'workflow') {
          navigateTo('view-workflows');
          openWorkflowEditor(item);
        } else {
          navigateTo('view-chains');
          openChainEditor(item);
        }
      });

      container.appendChild(el);
    }
  }

  // Update status listeners to include workflow events
  function listenForStatusUpdates() {
    PC.Messages.listen({
      [MSG.WORKFLOW_COMPLETED]: (msg) => {
        PC.Logger?.log(`Workflow completed: ${msg.workflowName}`);
        loadData();
      },

      [MSG.WORKFLOW_FAILED]: (msg) => {
        PC.Logger?.log(`Workflow failed: ${msg.error}`);
      },

      [MSG.CHAIN_COMPLETED]: (msg) => {
        PC.Logger?.log(`Chain completed: ${msg.success}/${msg.total} succeeded`);
        loadData();
      },

      [MSG.RECORDING_COMPLETE]: (msg) => {
        PC.Logger?.log('Recording complete — refreshing');
        loadData();
        // ✅ Navigate to workflows view to show newly recorded workflow
        setTimeout(() => navigateTo('view-workflows'), 500);
      },
    });
  }


  // ── Start ───────────────────────────────────────────────────────
  init();

})(); 