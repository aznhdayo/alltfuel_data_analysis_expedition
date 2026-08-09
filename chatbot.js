/* =========================================================================
   Evasta Assistant widget — floating, resizable, interactive AI assistant.
   Self-contained: injects its own styles and markup, so it can be dropped
   onto any page with a single <script src="js/chatbot.js"></script> tag.

   Talks to the Netlify Function at /api/chat (Netlify AI Gateway), which
   grounds the assistant in the About page + site navigation and streams the
   reply back token-by-token. Falls back to a lightweight offline guide if the
   endpoint is unreachable.
   ========================================================================= */
(function () {
  "use strict";

  if (window.__evastaChatLoaded) return;
  window.__evastaChatLoaded = true;

  var MIN_W = 320, MIN_H = 420;
  var STORE_KEY = "evastaChatSize";
  var HISTORY_MAX = 12;
  var API_URL = "/api/chat";

  /* ----------------------------- Styles ---------------------------------- */
  var css = `
  .evasta-chat *, .evasta-chat *::before, .evasta-chat *::after { box-sizing: border-box; }

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

  #evastaChatPanel {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 380px;
    height: 560px;
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
  #evastaChatHeader .evasta-sub { font-size: 11px; opacity: .9; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  #evastaChatHeader .evasta-dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 3px rgba(74,222,128,.25); }
  #evastaChatClose {
    margin-left: auto; border: none; background: rgba(255,255,255,.16); color: #fff;
    width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 18px; line-height: 1;
    display: flex; align-items: center; justify-content: center; transition: background .15s ease;
  }
  #evastaChatClose:hover { background: rgba(255,255,255,.3); }

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
  .evasta-msg { max-width: 86%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.5; word-break: break-word; }
  .evasta-msg.bot { align-self: flex-start; background: #fff; color: #1e293b; border: 1px solid #e6e9f2; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  .evasta-msg.user { align-self: flex-end; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border-bottom-right-radius: 4px; }
  .evasta-msg p { margin: 0 0 8px; }
  .evasta-msg p:last-child { margin-bottom: 0; }
  .evasta-msg ul { margin: 6px 0; padding-left: 18px; }
  .evasta-msg li { margin: 2px 0; }
  .evasta-msg a.evasta-link {
    color: #1d4ed8; font-weight: 600; text-decoration: none;
    border-bottom: 1px solid rgba(29,78,216,.35);
  }
  .evasta-msg a.evasta-link:hover { border-bottom-color: #1d4ed8; }
  .evasta-msg.user a.evasta-link { color: #fff; border-bottom-color: rgba(255,255,255,.6); }
  .evasta-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 1px; background: #2563eb; border-radius: 1px; vertical-align: -2px; animation: evastaBlink 1s steps(2) infinite; }
  @keyframes evastaBlink { 50% { opacity: 0; } }

  .evasta-suggestions { display: flex; flex-wrap: wrap; gap: 8px; align-self: flex-start; max-width: 100%; margin-top: 2px; }
  .evasta-chip {
    border: 1px solid #c9d4f2; background: #fff; color: #1d4ed8;
    border-radius: 999px; padding: 7px 12px; font: inherit; font-size: 12.5px; font-weight: 600;
    cursor: pointer; transition: background .15s ease, transform .1s ease;
  }
  .evasta-chip:hover { background: #eef3ff; transform: translateY(-1px); }

  .evasta-typing { align-self: flex-start; display: inline-flex; gap: 4px; padding: 12px 14px; background: #fff; border: 1px solid #e6e9f2; border-radius: 14px; border-bottom-left-radius: 4px; }
  .evasta-typing span { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; animation: evastaBounce 1.2s infinite ease-in-out; }
  .evasta-typing span:nth-child(2) { animation-delay: .15s; }
  .evasta-typing span:nth-child(3) { animation-delay: .3s; }
  @keyframes evastaBounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-5px); opacity: 1; } }

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
    <button id="evastaChatLauncher" type="button" aria-label="Open Evasta assistant" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
    </button>

    <section id="evastaChatPanel" role="dialog" aria-label="Evasta assistant" aria-hidden="true">
      <div id="evastaChatResize" title="Drag to resize"></div>
      <header id="evastaChatHeader">
        <span class="evasta-avatar" aria-hidden="true">⚡</span>
        <div>
          <div class="evasta-title">Evasta Assistant</div>
          <div class="evasta-sub"><span class="evasta-dot"></span> Ask me anything about the site</div>
        </div>
        <button id="evastaChatClose" type="button" aria-label="Close chat">&times;</button>
      </header>
      <div id="evastaChatMessages" aria-live="polite"></div>
      <div id="evastaChatInputArea">
        <textarea id="evastaChatInput" rows="1" placeholder="Ask about EV charging data or where to find it…" aria-label="Type your message"></textarea>
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

  // Human-friendly labels for the pages the assistant can link to.
  var PAGE_LABELS = {
    "index.html": "US Overview",
    "us-data-analysis.html": "US Data Analysis",
    "california-deep-dive.html": "California Deep Dive",
    "texas-deep-dive.html": "Texas Deep Dive",
    "resources.html": "Resources & Downloads",
    "fastchargingstationmap_test.html": "Station Map",
    "about.html": "About Evasta"
  };

  var SUGGESTIONS = [
    "What is Evasta?",
    "Show me California data",
    "Where can I download CSVs?",
    "How do I read the charts?"
  ];

  var conversationHistory = [];

  (function restoreSize() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.w && saved.h) {
        panel.style.width = saved.w + "px";
        panel.style.height = saved.h + "px";
      }
    } catch (e) {}
  })();

  /* ----------------------- Rendering helpers ----------------------------- */
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Turn the assistant's lightweight markdown into safe HTML: escape first,
  // then re-introduce a small allow-list of formatting and clickable page links.
  function renderRich(text) {
    var html = escapeHtml(text);

    // [page.html] and bare page.html mentions -> friendly clickable links.
    Object.keys(PAGE_LABELS).forEach(function (page) {
      var label = PAGE_LABELS[page];
      var esc = page.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var bracket = new RegExp("\\[" + esc + "\\]", "g");
      var bare = new RegExp("(?<![\\w\\/\">])" + esc + "(?![\\w\">])", "g");
      var anchor = '<a class="evasta-link" href="' + page + '">' + label + "</a>";
      html = html.replace(bracket, anchor).replace(bare, anchor);
    });

    // **bold**
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // Bullet lists ("- item" / "* item" lines).
    var lines = html.split("\n");
    var out = [], listBuf = null;
    function flushList() {
      if (listBuf) { out.push("<ul>" + listBuf.join("") + "</ul>"); listBuf = null; }
    }
    lines.forEach(function (line) {
      var m = line.match(/^\s*[-*]\s+(.*)$/);
      if (m) { (listBuf = listBuf || []).push("<li>" + m[1] + "</li>"); }
      else { flushList(); if (line.trim()) out.push("<p>" + line + "</p>"); }
    });
    flushList();
    return out.join("");
  }

  function addMessage(sender, text) {
    var div = document.createElement("div");
    div.className = "evasta-msg " + (sender === "user" ? "user" : "bot");
    if (sender === "user") div.textContent = String(text || "");
    else div.innerHTML = renderRich(text);
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

  function showSuggestions() {
    var wrap = document.createElement("div");
    wrap.className = "evasta-suggestions";
    SUGGESTIONS.forEach(function (s) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "evasta-chip";
      chip.textContent = s;
      chip.addEventListener("click", function () {
        wrap.remove();
        input.value = s;
        send();
      });
      wrap.appendChild(chip);
    });
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  }

  function lower(s) { return String(s || "").trim().toLowerCase(); }
  function hasAny(text, words) {
    var t = lower(text);
    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) !== -1) return true;
    return false;
  }

  function pushHistory(role, content) {
    conversationHistory.push({ role: role, content: String(content || "") });
    if (conversationHistory.length > HISTORY_MAX) conversationHistory = conversationHistory.slice(-HISTORY_MAX);
  }

  // Local safety net used only if the AI endpoint can't be reached.
  function offlineAnswer(question) {
    var q = lower(question);
    if (!q) return "Tell me what you’re trying to do — navigate the site, download data, or understand what the charts mean.";
    if (/^(hi|hello|hey)\b/.test(q)) return "Hi! 👋 What would you like to find on Evasta?";
    if (hasAny(q, ["download", "csv", "dataset", "resources"]))
      return "You can download every dataset — network, state, and California county summaries plus raw stations — from [resources.html].";
    if (hasAny(q, ["california", "county"]))
      return "California county-level and network analytics live on the [california-deep-dive.html].";
    if (hasAny(q, ["texas", " tx"]))
      return "Texas city-level and network insights are on the [texas-deep-dive.html].";
    if (hasAny(q, ["map", "station", "location", "near"]))
      return "Try the interactive [fastchargingstationmap_test.html] to explore stations with state and city filters.";
    if (hasAny(q, ["about", "mission", "what is evasta", "who", "data source", "afdc"]))
      return "Evasta turns public U.S. DOE AFDC EV charging data into clear, planning-focused analytics. Full details are on the [about.html].";
    return "I can help you navigate Evasta and answer questions from the About page. Try the [about.html], or the [california-deep-dive.html] and [resources.html]. (The live assistant is offline right now.)";
  }

  /* --------------------------- Networking -------------------------------- */
  // Streams the reply from /api/chat, updating the bubble as tokens arrive.
  async function streamAIResponse(question, bubble) {
    var res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, history: conversationHistory })
    });

    if (!res.ok || !res.body) throw new Error("Bad response: " + res.status);

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var full = "";
    var cursor = '<span class="evasta-cursor"></span>';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      full += decoder.decode(chunk.value, { stream: true });
      bubble.innerHTML = renderRich(full) + cursor;
      messages.scrollTop = messages.scrollHeight;
    }

    full = full.trim();
    if (!full) throw new Error("Empty response");
    bubble.innerHTML = renderRich(full);
    messages.scrollTop = messages.scrollHeight;
    return full;
  }

  /* ------------------------- Open / close -------------------------------- */
  var greeted = false;
  function openChat() {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    launcher.classList.add("is-open");
    launcher.setAttribute("aria-expanded", "true");
    if (!greeted) {
      greeted = true;
      addMessage("bot", "Hi! 👋 I’m the Evasta Assistant. I can help you find your way around the site and answer questions about our EV charging analytics. What are you looking for?");
      showSuggestions();
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

  /* ----------------------------- Send ------------------------------------ */
  var busy = false;
  async function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;

    var existing = messages.querySelector(".evasta-suggestions");
    if (existing) existing.remove();

    addMessage("user", text);
    input.value = "";
    input.style.height = "auto";

    var typing = showTyping();
    var reply;
    try {
      typing.remove();
      var bubble = addMessage("bot", "");
      bubble.innerHTML = '<span class="evasta-cursor"></span>';
      reply = await streamAIResponse(text, bubble);
    } catch (e) {
      if (typing.parentNode) typing.remove();
      reply = offlineAnswer(text);
      var last = messages.querySelector(".evasta-msg.bot:last-child");
      if (last && last.textContent === "") last.innerHTML = renderRich(reply);
      else addMessage("bot", reply);
    }

    pushHistory("user", text);
    pushHistory("assistant", reply);

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  /* ---------------------------- Resize ----------------------------------- */
  var resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
  function onResizeStart(e) {
    resizing = true;
    var p = e.touches ? e.touches[0] : e;
    startX = p.clientX;
    startY = p.clientY;
    var rect = panel.getBoundingClientRect();
    startW = rect.width;
    startH = rect.height;
    document.body.classList.add("evasta-resizing");
    e.preventDefault();
  }

  function onResizeMove(e) {
    if (!resizing) return;
    var p = e.touches ? e.touches[0] : e;
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
    } catch (e) {}
  }

  resizeHandle.addEventListener("mousedown", onResizeStart);
  resizeHandle.addEventListener("touchstart", onResizeStart, { passive: false });
  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("touchmove", onResizeMove, { passive: false });
  window.addEventListener("mouseup", onResizeEnd);
  window.addEventListener("touchend", onResizeEnd);
})();
