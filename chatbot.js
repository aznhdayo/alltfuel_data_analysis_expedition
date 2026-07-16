/* =========================================================================
   Evasta Assistant widget — floating, resizable assistant widget
   Self-contained: injects its own styles and markup, so it can be dropped
   onto any page with a single <script src="js/chatbot.js"></script> tag.
   ========================================================================= */
(function () {
  "use strict";

  if (window.__evastaChatLoaded) return;
  window.__evastaChatLoaded = true;

  var MIN_W = 320, MIN_H = 420;
  var STORE_KEY = "evastaChatSize";
  var HISTORY_MAX = 10;

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
  .evasta-msg { max-width: 82%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .evasta-msg.bot { align-self: flex-start; background: #fff; color: #1e293b; border: 1px solid #e6e9f2; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  .evasta-msg.user { align-self: flex-end; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border-bottom-right-radius: 4px; }

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
          <div class="evasta-sub"><span class="evasta-dot"></span> AI for navigation + About context</div>
        </div>
        <button id="evastaChatClose" type="button" aria-label="Close chat">&times;</button>
      </header>
      <div id="evastaChatMessages" aria-live="polite"></div>
      <div id="evastaChatInputArea">
        <textarea id="evastaChatInput" rows="1" placeholder="Ask about Evasta or the site…" aria-label="Type your message"></textarea>
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

  var PAGE_MAP = {
    home: "index.html",
    california: "california-deep-dive.html",
    texas: "texas-deep-dive.html",
    resources: "resources.html",
    about: "about.html",
    map: "fastchargingstationmap_test.html"
  };

  var ABOUT_SNIPPETS = [
    "Mission: turn raw federal EV charging data into practical, planning-focused insights.",
    "Who it’s for: counties/regional planners, Clean Cities Coalitions, state energy offices, researchers, EV companies, analysts, journalists, and civic data advocates.",
    "What it covers: state-level summaries, network/operator comparisons, plug and station trends, California county analytics, and month-over-month tracking.",
    "Data source/disclaimer: uses public U.S. DOE AFDC data; not affiliated with DOE/AFDC. For county-level California context, it references a public CA ZIP-to-County reference from UnitedStatesZipCodes.org.",
    "How to use: pick the page that matches your question (US overview, CA deep dive, TX deep dive, or downloads in Resources) and interpret charts through the shared data model."
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

  function addMessage(sender, text) {
    var div = document.createElement("div");
    div.className = "evasta-msg " + (sender === "user" ? "user" : "bot");
    div.textContent = String(text || "");
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

  function norm(s) { return String(s || "").trim(); }
  function lower(s) { return norm(s).toLowerCase(); }
  function hasAny(text, words) {
    var t = lower(text);
    for (var i = 0; i < words.length; i++) if (t.indexOf(words[i]) !== -1) return true;
    return false;
  }

  function pushHistory(role, content) {
    conversationHistory.push({ role: role, content: String(content || "") });
    if (conversationHistory.length > HISTORY_MAX) conversationHistory = conversationHistory.slice(-HISTORY_MAX);
  }

  function offlineAnswer(question) {
    var q = lower(question);

    if (!q) return "Tell me what you’re trying to do (navigate, download data, or understand what the charts mean).";
    if (/^(hi|hello|hey)\b/.test(q)) return "Hi! 👋 What do you want to find on Evasta? (Example: California analytics, Texas analytics, or CSV downloads)";
    if (/\b(thanks|thank you|thx)\b/.test(q)) return "You’re welcome! Want help navigating to a specific page (California, Texas, Resources, or About)?";
    if (/\b(bye|goodbye)\b/.test(q)) return "Goodbye! Come back anytime—I'll help you navigate Evasta.";

    if (hasAny(q, ["download", "csv", "dataset", "resources"])) {
      return "For CSV downloads, open `resources.html` (EV Network Summary, State Summary, City Summary (California), and raw EV Stations data).";
    }
    if (hasAny(q, ["california", "county"])) {
      return "For California county-level analytics, open `california-deep-dive.html`. Example state: California.";
    }
    if (hasAny(q, ["texas", "tx deep"])) {
      return "For Texas-focused insights, open `texas-deep-dive.html`.";
    }
    if (hasAny(q, ["about", "mission", "what is evasta", "what does evasta do"])) {
      if (hasAny(q, ["mission", "what does evasta do"])) return "From the About page: the mission is to turn raw federal EV charging data into practical, planning-focused insights.";
      if (hasAny(q, ["who", "for", "audience"])) return "From the About page: it’s made for counties/regional planners, Clean Cities Coalitions, state energy offices, researchers, EV companies, analysts, journalists, and civic data advocates.";
      return "From the About page: Evasta translates public AFDC EV charging data into clearer charts and actionable insights for planning.";
    }
    if (hasAny(q, ["data source", "afdc", "doe", "department of energy"])) {
      return "The data comes from the U.S. DOE Alternative Fuels Data Center (AFDC). Evasta is not affiliated with DOE/AFDC; it uses their public data for analytics.";
    }
    if (hasAny(q, ["map", "station", "location"])) {
      return "For the station map tool, open `fastchargingstationmap_test.html` and choose state/city filters.";
    }

    if (q.length < 5) {
      return "Can you tell me which page you’re on, or what you want to learn? (Example: “California county analytics”, “download CSV”, or “What is Evasta’s mission?”)";
    }

    return "I can help with navigation and explanations from the About page. If you ask about a specific feature, tell me which page you’re viewing. Example: California → `california-deep-dive.html`.";
  }

  async function getAIResponse(question) {
    try {
      var canParse = (typeof Parse !== "undefined" && Parse && Parse.Cloud && typeof Parse.Cloud.run === "function");
      if (!canParse) return offlineAnswer(question);

      var aiSystem = [
        "You are the Evasta website assistant.",
        "You must be grounded in the project's navigation and About-page content.",
        "If the question is outside what Evasta provides, say you don't have that info on this site and guide the user to relevant pages.",
        "When relevant, mention at least one US example state (California or Texas).",
        "Be helpful and avoid repeating the same canned sentence every message."
      ].join("\n");

      var messagesForAI = [{ role: "system", content: aiSystem }]
        .concat(conversationHistory)
        .concat([{ role: "user", content: String(question || "") }]);

      var res = await Parse.Cloud.run("evastaAIChat", {
        messages: messagesForAI,
        question: question,
        context: { pages: PAGE_MAP, about: ABOUT_SNIPPETS },
        mode: "site_assistant"
      });

      var reply = res && (res.reply || res.answer || res.text || (res.result && (res.result.reply || res.result.text)));
      if (!reply || typeof reply !== "string") return offlineAnswer(question);

      var cleaned = reply.trim();
      if (!cleaned) return offlineAnswer(question);
      return cleaned;
    } catch (e) {
      return offlineAnswer(question);
    }
  }

  var greeted = false;
  function openChat() {
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    launcher.classList.add("is-open");
    launcher.setAttribute("aria-expanded", "true");
    if (!greeted) {
      greeted = true;
      addMessage("bot", "Hi! 👋 I’m the Evasta Assistant. Ask me how to navigate the website or questions based on the About page.");
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
    var reply = await getAIResponse(text);
    typing.remove();
    addMessage("bot", reply);

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
