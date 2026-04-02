/**
 * demo-site/demo.js
 * ────────────────────────────────────────────
 * AI Chat Simulator for testing the Prompt Chain Extension.
 *
 * Simulates:
 *  - User sends a message via textarea + send button
 *  - "Stop Generating" button appears (AI is responding)
 *  - Response streams in token by token (simulated)
 *  - "Stop Generating" button disappears (AI is done)
 *  - Send button re-enables
 *
 * The extension's recorder, replayer, and completion detector
 * can all be tested against this page.
 */

(() => {
  // ── DOM References ────────────────────────────────────
  const chatMessages = document.getElementById('chatMessages');
  const chatForm     = document.getElementById('chatForm');
  const textarea     = document.getElementById('promptTextarea');
  const sendButton   = document.getElementById('sendButton');
  const stopButton   = document.getElementById('stopButton');
  const statusText   = document.getElementById('statusText');

  // ── State ─────────────────────────────────────────────
  let isGenerating = false;
  let abortGeneration = false;  // set to true when user clicks Stop

  // ── Simulated AI Responses ────────────────────────────
  // When user sends any message, pick a response to stream back.
  const SIMULATED_RESPONSES = [
    "That's a great question! Let me think about this step by step.\n\nFirst, we need to consider the overall architecture of the system. The key components are the data layer, the business logic layer, and the presentation layer.\n\nFor the data layer, I'd recommend using a document database like MongoDB, since your data has variable structure and nested objects fit naturally.\n\nFor the business logic, Express.js provides a clean routing system with middleware support. You can organize routes by feature domain.\n\nFinally, for the frontend, React gives you component-based architecture with excellent state management options.\n\nWould you like me to go deeper into any of these layers?",

    "I'll analyze the code you've shared and provide detailed feedback.\n\n**Bug #1: Null reference on line 15**\nThe variable `user` could be undefined if the API call fails. Add a null check before accessing `.name`.\n\n**Bug #2: Memory leak in useEffect**\nThe event listener is never cleaned up. Return a cleanup function from the effect.\n\n**Bug #3: Race condition**\nMultiple rapid clicks trigger parallel API calls. Add a loading guard or use AbortController.\n\n**Performance suggestion:**\nThe list renders every item on each state change. Wrap child components in React.memo() and use useCallback for event handlers.\n\nShall I provide the corrected code for any of these issues?",

    "Here's a comprehensive implementation plan:\n\n## Phase 1: Setup\n- Initialize the project with proper tooling\n- Set up the development environment\n- Configure linting and formatting\n\n## Phase 2: Core Features\n- Build the authentication system\n- Implement the main data models\n- Create the API endpoints\n\n## Phase 3: Frontend\n- Build the component library\n- Implement page layouts\n- Connect to the API\n\n## Phase 4: Testing & Deployment\n- Write unit and integration tests\n- Set up CI/CD pipeline\n- Deploy to staging environment\n\nThis approach ensures each phase builds on the previous one, minimizing rework and enabling incremental testing.",

    "Absolutely! Let me explain this concept clearly.\n\nThink of it like a restaurant kitchen. The **chef** (your main function) receives an **order** (the request). Instead of doing everything alone, the chef delegates:\n\n1. The **sous chef** prepares ingredients (data fetching)\n2. The **line cook** handles the actual cooking (processing)\n3. The **expeditor** plates and sends it out (response formatting)\n\nIn programming terms, this is the **separation of concerns** principle. Each component has one job, does it well, and communicates through clear interfaces.\n\nThe benefit? If the line cook calls in sick, you only replace that one role — the rest of the kitchen keeps working. Same with code: changing one module doesn't break the others.\n\nDoes this analogy help? Want me to show concrete code examples?",
  ];

  // Track which response to show next (cycle through them)
  let responseIndex = 0;

  // ── Event Listeners ───────────────────────────────────

  // Handle form submission (Send button click or Enter key)
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSend();
  });

  // Handle Enter key (without Shift) to send
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Handle Stop button
  stopButton.addEventListener('click', () => {
    abortGeneration = true;
    setStatus('Generation stopped by user');
  });

  // ── Core Functions ────────────────────────────────────

  /**
   * Handle sending a message.
   * Adds user message to chat, then starts simulated AI response.
   */
  function handleSend() {
    const text = textarea.value.trim();
    if (!text || isGenerating) return;

    // Add user message to chat
    addMessage(text, 'user');

    // Clear input
    textarea.value = '';
    textarea.style.height = 'auto';

    // Start AI response
    startGeneration();
  }

  /**
   * Add a message bubble to the chat container.
   * @param {string} text - Message text
   * @param {string} role - 'user' or 'assistant'
   * @returns {HTMLElement} the message content element (for streaming updates)
   */
  function addMessage(text, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const content = document.createElement('div');
    content.className = 'message-content';

    if (role === 'user') {
      // User messages render immediately
      const p = document.createElement('p');
      p.textContent = text;
      content.appendChild(p);
    }
    // Assistant messages start empty (filled by streaming)

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    chatMessages.appendChild(messageDiv);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return content;
  }

  /**
   * Start simulated AI response generation.
   * Shows stop button, streams tokens, hides stop button when done.
   */
  async function startGeneration() {
    isGenerating = true;
    abortGeneration = false;

    // Disable send, show stop button
    sendButton.disabled = true;
    stopButton.style.display = 'inline-block';
    setStatus('AI is generating a response...');

    // Create empty assistant message
    const contentEl = addMessage('', 'assistant');

    // Pick the next simulated response
    const fullResponse = SIMULATED_RESPONSES[responseIndex % SIMULATED_RESPONSES.length];
    responseIndex++;

    // Add streaming cursor
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    contentEl.appendChild(cursor);

    // ── Stream tokens one by one ────────────────────────
    // Split response into small chunks (simulating token streaming)
    const tokens = tokenize(fullResponse);
    let currentParagraph = document.createElement('p');
    contentEl.insertBefore(currentParagraph, cursor);

    for (let i = 0; i < tokens.length; i++) {
      // Check if user clicked Stop
      if (abortGeneration) {
        break;
      }

      const token = tokens[i];

      // Handle newlines by creating new paragraphs
      if (token === '\n\n') {
        currentParagraph = document.createElement('p');
        contentEl.insertBefore(currentParagraph, cursor);
      } else if (token === '\n') {
        currentParagraph.appendChild(document.createElement('br'));
      } else {
        currentParagraph.appendChild(document.createTextNode(token));
      }

      // Scroll to bottom as content streams in
      chatMessages.scrollTop = chatMessages.scrollHeight;

      // Simulate variable streaming speed
      const delay = token.length > 5 ? 30 : token === ' ' ? 20 : 40;
      await sleep(delay + Math.random() * 30);
    }

    // ── Generation complete (or stopped) ────────────────

    // Remove streaming cursor
    cursor.remove();

    // Hide stop button, re-enable send
    stopButton.style.display = 'none';
    sendButton.disabled = false;
    isGenerating = false;

    // Focus textarea for next input
    textarea.focus();

    setStatus(
      abortGeneration
        ? 'Generation stopped — ready for input'
        : 'Response complete — ready for input'
    );
  }

  /**
   * Tokenize text into small chunks that simulate streaming.
   * Splits on word boundaries and preserves newlines as separate tokens.
   */
  function tokenize(text) {
    const tokens = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        // Check if this is a double newline (paragraph break) or single
        tokens.push(lines[i - 1] === '' ? '\n\n' : '\n');
      }

      const line = lines[i];
      if (line === '') continue;

      // Split line into words, keeping spaces attached
      const words = line.split(/(\s+)/);
      for (const word of words) {
        if (word) tokens.push(word);
      }
    }

    return tokens;
  }

  // ── Utility ─────────────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  // ── Auto-resize textarea ──────────────────────────────
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  });

})();