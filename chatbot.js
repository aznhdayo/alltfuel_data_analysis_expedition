/* =========================================================================
   Evasta AI Chatbot — floating, resizable assistant widget
   Self-contained: injects its own styles and markup, so it can be dropped
   onto any page with a single <script src="js/chatbot.js"></script> tag.
   ========================================================================= */
(function () {
  "use strict";

  // Guard against double-injection if the script is included more than once.
  if (window.__evastaChatLoaded) return;
  window.__evastaChatLoaded = true;

  var MIN_W = 320, MIN_H = 420;
  var STORE_KEY = "evastaChatSize";

  /* ----------------------------- Styles ---------------------------------- */
  var css = `
  .evasta-chat *, .evasta-chat *::before, .evasta-chat *::after { box-sizing: border-box; }

  /* Floating launcher button (bottom-right of every page) */
  #evastaChatLauncher {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 60px;
    height: 60px;
    border: none;
    border-radius: 50%;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 26px rgba(37, 99, 235, 0.42);
    z-index: 2147483000;
    transition: transform .18s ease, box-shadow .18s ease;
  }
  #evastaChatLauncher:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 14px 32px rgba(37,99,235,.5); }
  #evastaChatLauncher:focus-visible { outline: 3px solid rgba(37,99,235,.5); outline-offset: 3px; }
  #evastaChatLauncher svg { width: 28px; height: 28px; }
  #evastaChatLauncher.is-open { transform: scale(.9); opacity: 0; pointer-events: none; }

  /* Chat panel */
  #evastaChatPanel {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 380px;
    height: 540px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px);
    background: #ffffff;
    border-radius: 18px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
    display: none;
    flex-direction: column;
    overflow: hidden;
    z-index: 2147483001;
    font-family: "Space Grotesk", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    animation: evastaPop .22s ease;
  }
  #evastaChatPanel.is-open { display: flex; }
  @keyframes evastaPop { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }

  /* Header */
  #evastaChatHeader {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #fff;
  }
  #evastaChatHeader .evasta-avatar {
    width: 38px; height: 38px; flex: 0 0 auto;
    border-radius: 50%;
    background: rgba(255,255,255,.18);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px;
  }
  #evastaChatHeader .evasta-title { font-size: 15px; font-weight: 700; line-height: 1.1; }
  #evastaChatHeader .evasta-sub { font-size: 12px; opacity: .85; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  #evastaChatHeader .evasta-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 3px rgba(74,222,128,.25); }
  #evastaChatClose {
    margin-left: auto; border: none; background: rgba(255,255,255,.16); color: #fff;
    width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 18px; line-height: 1;
    display: flex; align-items: center; justify-content: center; transition: background .15s ease;
  }
  #evastaChatClose:hover { background: rgba(255,255,255,.3); }

  /* Messages */
  #evastaChatMessages {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
    background: #f4f6fb;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scrollbar-width: thin;
  }
  .evasta-msg { max-width: 82%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .evasta-msg.bot { align-self: flex-start; background: #fff; color: #1e293b; border: 1px solid #e6e9f2; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  .evasta-msg.user { align-self: flex-end; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border-bottom-right-radius: 4px; }

  /* Typing indicator */
  .evasta-typing { align-self: flex-start; display: inline-flex; gap: 4px; padding: 12px 14px; background: #fff; border: 1px solid #e6e9f2; border-radius: 14px; border-bottom-left-radius: 4px; }
  .evasta-typing span { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; animation: evastaBounce 1.2s infinite ease-in-out; }
  .evasta-typing span:nth-child(2) { animation-delay: .15s; }
  .evasta-typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes evastaBounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-5px); opacity: 1; } }

  /* Input */
  #evastaChatInputArea { display: flex; align-items: flex-end; gap: 8px; padding: 12px; background: #fff; border-top: 1px solid #eceefb; }
  #evastaChatInput {
    flex: 1; resize: none; border: 1px solid #d8dcec; border-radius: 12px; padding: 10px 12px;
    font: inherit; font-size: 14px; line-height: 1.4; max-height: 120px; min-height: 42px; outline: none; color: #1e293b;
  }
  #evastaChatInput:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
  #evastaChatSend {
    flex: 0 0 auto; width: 42px; height: 42px; border: none; border-radius: 12px; cursor: pointer;
    background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; display: flex; align-items: center; justify-content: center; transition: filter .15s ease;
  }
  #evastaChatSend:hover { filter: brightness(1.08); }
  #evastaChatSend:disabled { opacity: .5; cursor: not-allowed; }
  #evastaChatSend svg { width: 18px; height: 18px; }

  /* Resize handle (top-left corner — panel is anchored bottom-right) */
  #evastaChatResize {
    position: absolute; top: 0; left: 0; width: 22px; height: 22px; cursor: nwse-resize; z-index: 5;
  }
  #evastaChatResize::before {
    content: ""; position: absolute; top: 7px; left: 7px; width: 9px; height: 9px;
    border-top: 2px solid rgba(255,255,255,.7); border-left: 2px solid rgba(255,255,255,.7); border-radius: 2px;
  }
  body.evasta-resizing { user-select: none; cursor: nwse-resize; }

  @media (max-width: 480px) {
    #evastaChatPanel { width: calc(100vw - 24px) !important; height: calc(100vh - 90px) !important; right: 12px; bottom: 80px; }
    #evastaChatResize { display: none; }
  }
  `;
  var styleEl = document.createElement("style");
  styleEl.id = "evastaChatStyles";
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ----------------------------- Markup ---------------------------------- */
  var root = document.createElement("div");
  root.className = "evasta-chat";
  root.innerHTML = `
    <button id="evastaChatLauncher" type="button" aria-label="Open Evasta chat assistant" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    </button>

    <section id="evastaChatPanel" role="dialog" aria-label="Evasta chat assistant" aria-hidden="true">
      <div id="evastaChatResize" title="Drag to resize"></div>
      <header id="evastaChatHeader">
        <span class="evasta-avatar" aria-hidden="true">⚡</span>
        <div>
          <div class="evasta-title">Evasta Assistant</div>
          <div class="evasta-sub"><span class="evasta-dot"></span> Online · EV charging help</div>
        </div>
        <button id="evastaChatClose" type="button" aria-label="Close chat">&times;</button>
      </header>
      <div id="evastaChatMessages" aria-live="polite"></div>
      <div id="evastaChatInputArea">
        <textarea id="evastaChatInput" rows="1" placeholder="Ask about EV charging…" aria-label="Type your message"></textarea>
        <button id="evastaChatSend" type="button" aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  var launcher = root.querySelector("#evastaChatLauncher");
  var panel = root.querySelector("#evastaChatPanel");
  var closeBtn = root.querySelector("#evastaChatClose");
  var messages = root.querySelector("#evastaChatMessages");
  var input = root.querySelector("#evastaChatInput");
  var sendBtn = root.querySelector("#evastaChatSend");
  var resizeHandle = root.querySelector("#evastaChatResize");

  /* ------------------------- Size persistence ---------------------------- */
  (function restoreSize() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.w && saved.h) {
        panel.style.width = saved.w + "px";
        panel.style.height = saved.h + "px";
      }
    } catch (e) { /* ignore */ }
  })();

  /* ----------------------------- Open / close ---------------------------- */
  var greeted = false;
  function openChat() {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    launcher.classList.add("is-open");
    launcher.setAttribute("aria-expanded", "true");
    if (!greeted) {
      greeted = true;
      addMessage("bot", "Hi there! 👋 I'm the Evasta Assistant. Ask me anything about EV charging — plugs, stations, or state-by-state insights.");
    }
    setTimeout(function () { input.focus(); }, 60);
  }
  function closeChat() {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    launcher.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }
  launcher.addEventListener("click", openChat);
  closeBtn.addEventListener("click", closeChat);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("is-open")) closeChat();
  });

  /* ----------------------------- Messages -------------------------------- */
  function addMessage(sender, text) {
    var div = document.createElement("div");
    div.className = "evasta-msg " + (sender === "user" ? "user" : "bot");
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function showTyping() {
    var t = document.createElement("div");
    t.className = "evasta-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    messages.appendChild(t);
    messages.scrollTop = messages.scrollHeight;
    return t;
  }

  /* ----------------------- Lightweight intent help ----------------------- */
  function normalizeText(s) { return String(s || "").trim().toLowerCase(); }
  function isGreeting(q) { var t = normalizeText(q); return /^(hello|hi|hey|yo)\b/.test(t) || /(hi there|hey there|good morning|good afternoon|good evening)/.test(t); }
  function isThanks(q) { return /\b(thanks|thank you|thx|appreciate)\b/.test(normalizeText(q)); }
  function isGoodbye(q) { return /\b(bye|goodbye|see you|farewell)\b/.test(normalizeText(q)); }

  function botFallbackResponse(question) {
    if (isGreeting(question)) return "Hello! 👋 How can I help you with EV charging today?";
    if (isThanks(question)) return "You're welcome! 😊 Want to know about plugs, stations, or coverage by state?";
    if (isGoodbye(question)) return "Goodbye! If you have more questions about EV charging, just say hello.";
    return "Sorry — I couldn't process that just now. Try rephrasing, or ask about a specific state, month, or topic.";
  }

  // Call the Back4App cloud function, tolerating different response shapes.
  async function askEvastaAI(question) {
    if (isGreeting(question) || isThanks(question) || isGoodbye(question)) {
      return botFallbackResponse(question);
    }
    try {
      if (typeof Parse === "undefined" || !Parse.Cloud) return botFallbackResponse(question);
      var res = await Parse.Cloud.run("evastaAIChat", { question: question, message: question });
      var reply = res && (res.reply || res.answer || res.text || (res.result && res.result.reply));
      return reply || "I couldn't generate an answer for that. Could you try asking another way?";
    } catch (err) {
      return botFallbackResponse(question);
    }
  }

  /* ------------------------------ Sending -------------------------------- */
  var busy = false;
  async function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;

    addMessage("user", text);
    input.value = "";
    input.style.height = "auto";

    var typing = showTyping();
    var reply = await askEvastaAI(text);
    typing.remove();
    addMessage("bot", reply);

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  // Auto-grow the textarea up to its max height.
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  /* ------------------------------ Resizing ------------------------------- */
  var resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
  function onResizeStart(e) {
    resizing = true;
    var p = e.touches ? e.touches[0] : e;
    startX = p.clientX; startY = p.clientY;
    var rect = panel.getBoundingClientRect();
    startW = rect.width; startH = rect.height;
    document.body.classList.add("evasta-resizing");
    e.preventDefault();
  }
  function onResizeMove(e) {
    if (!resizing) return;
    var p = e.touches ? e.touches[0] : e;
    // Panel anchored bottom-right: dragging the top-left handle up/left grows it.
    var newW = startW + (startX - p.clientX);
    var newH = startH + (startY - p.clientY);
    newW = Math.max(MIN_W, Math.min(newW, window.innerWidth - 32));
    newH = Math.max(MIN_H, Math.min(newH, window.innerHeight - 48));
    panel.style.width = newW + "px";
    panel.style.height = newH + "px";
  }
  function onResizeEnd() {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove("evasta-resizing");
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        w: Math.round(panel.getBoundingClientRect().width),
        h: Math.round(panel.getBoundingClientRect().height)
      }));
    } catch (e) { /* ignore */ }
  }
  resizeHandle.addEventListener("mousedown", onResizeStart);
  resizeHandle.addEventListener("touchstart", onResizeStart, { passive: false });
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("touchmove", onResizeMove, { passive: false });
  window.addEventListener("mouseup", onResizeEnd);
  window.addEventListener("touchend", onResizeEnd);
})();
