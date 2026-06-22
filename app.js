/* -------------------------------------------------------
   DOM REFERENCES
------------------------------------------------------- */
const homeScreen    = document.getElementById("homeScreen");
const loginScreen   = document.getElementById("loginScreen");
const signupScreen  = document.getElementById("signupScreen");
const pendingScreen = document.getElementById("pendingScreen");
const mapScreen     = document.getElementById("mapScreen");

const navLogin      = document.getElementById("navLogin");
const navMap        = document.getElementById("navMap");
const navAnalytics  = document.getElementById("navAnalytics");
const navAbout      = document.getElementById("navAbout");

const loginForm     = document.getElementById("loginForm");
const signupForm    = document.getElementById("signupForm");
const backToLogin   = document.getElementById("backToLogin");
const pendingBackHome = document.getElementById("pendingBackHome");
const valueCardLinks = document.querySelectorAll(".value-card-link");
const valueGrid = document.querySelector(".value-grid");
const valueLoginNote = document.getElementById("valueLoginNote");

/* -------------------------------------------------------
   SCREEN + NAV HELPERS
------------------------------------------------------- */
function showScreen(screen) {
  [homeScreen, loginScreen, signupScreen, pendingScreen, mapScreen].forEach(s => {
    if (s) s.classList.remove("active");
  });
  screen.classList.add("active");
  window.scrollTo(0, 0);
}

function updateNavForLoginState() {
  const user = Parse.User.current();
  navLogin.textContent = user ? "Logout" : "Login";
  updateValueCardsLock();
}

function updateValueCardsLock() {
  const user = Parse.User.current();
  const locked = !user;
  if (valueGrid) {
    valueGrid.classList.toggle("locked", locked);
  }
  if (valueLoginNote) {
    valueLoginNote.classList.remove("show");
  }
}

/* -------------------------------------------------------
   NAVIGATION EVENTS
------------------------------------------------------- */
navLogin.addEventListener("click", async () => {
  const user = Parse.User.current();
  if (user) {
    await Parse.User.logOut();
    updateNavForLoginState();
    showScreen(homeScreen);
  } else {
    showScreen(loginScreen);
  }
});

navMap.addEventListener("click", () => {
  showScreen(homeScreen);
  const section = document.getElementById("station-map");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
});

navAnalytics.addEventListener("click", () => {
  showScreen(homeScreen);
  const section = document.getElementById("analytics");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
});

navAbout.addEventListener("click", () => {
  showScreen(homeScreen);
  const section = document.getElementById("about");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
});

/* Footer quick links mirror the primary nav destinations */
[
  ["footerMap", "station-map"],
  ["footerAnalytics", "analytics"],
  ["footerAbout", "about"],
].forEach(([id, targetId]) => {
  const link = document.getElementById(id);
  if (!link) return;
  link.addEventListener("click", () => {
    showScreen(homeScreen);
    const section = document.getElementById(targetId);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

/* -------------------------------------------------------
   VALUE CARD CLICK HANDLERS
------------------------------------------------------- */
valueCardLinks.forEach((card) => {
  card.addEventListener("click", () => {
    const target = card.getAttribute("data-target");

    // Analytics cards — no login required, scroll to section
    if (target === "analytics" || target === "california-analytics") {
      showScreen(homeScreen);
      const section = document.getElementById(target);
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    // EV map — requires login
    const user = Parse.User.current();
    if (!user) {
      if (valueLoginNote) {
        valueLoginNote.classList.add("show");
        setTimeout(() => valueLoginNote.classList.remove("show"), 2500);
      }
      return;
    }

    if (target === "ev-map") {
      window.open("./fastchargingstationmap_test.html", "_blank");
      return;
    }
  });
});

/* Show login note only on the EV map card when not logged in */
valueCardLinks.forEach((card) => {
  if (card.getAttribute("data-target") !== "ev-map") return;

  const showLoginNote = () => {
    if (!Parse.User.current() && valueLoginNote) {
      valueLoginNote.classList.add("show");
    }
  };

  const hideLoginNote = () => {
    if (valueLoginNote) {
      valueLoginNote.classList.remove("show");
    }
  };

  card.addEventListener("mouseenter", showLoginNote);
  card.addEventListener("mouseleave", hideLoginNote);
  card.addEventListener("focusin", showLoginNote);
  card.addEventListener("focusout", hideLoginNote);
});

backToLogin.addEventListener("click", (e) => {
  e.preventDefault();
  showScreen(loginScreen);
});

pendingBackHome.addEventListener("click", (e) => {
  e.preventDefault();
  showScreen(homeScreen);
});

/* -------------------------------------------------------
   INITIAL STATE
------------------------------------------------------- */
showScreen(homeScreen);
updateNavForLoginState();

/* -------------------------------------------------------
   DOWNLOAD SECTION (login-gated)
------------------------------------------------------- */
function showDownloadAlert() {
  const alertEl = document.getElementById("downloadAlert");
  if (!alertEl) return;
  alertEl.style.display = "block";
  // Scroll banner into view (so user sees the dedicated message)
  try { alertEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
}

function hideDownloadAlert() {
  const alertEl = document.getElementById("downloadAlert");
  if (!alertEl) return;
  alertEl.style.display = "none";
}

// Banner buttons
const downloadLoginBtn = document.getElementById("downloadLoginBtn");
if (downloadLoginBtn) {
  downloadLoginBtn.addEventListener("click", () => {
    hideDownloadAlert();
    showScreen(loginScreen);
  });
}

const downloadCancelBtn = document.getElementById("downloadCancelBtn");
if (downloadCancelBtn) {
  downloadCancelBtn.addEventListener("click", () => {
    hideDownloadAlert();
  });
}

// Gate download links
const downloadLinks = document.querySelectorAll(".download-file-link[data-download-file]");
downloadLinks.forEach(link => {
  link.addEventListener("click", (e) => {
    const user = Parse.User.current();
    if (!user) {
      e.preventDefault();
      showDownloadAlert();
    }
  });
});
