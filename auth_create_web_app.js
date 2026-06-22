/* -------------------------------------------------------
   SIGNUP
------------------------------------------------------- */
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const firstName = document.getElementById("firstname").value.trim();
  const lastName  = document.getElementById("lastname").value.trim();
  const email     = document.getElementById("newEmail").value.trim();
  const password  = document.getElementById("newPassword").value.trim();
  const alias     = document.getElementById("alias").value.trim();

  try {
    const user = new Parse.User();
    user.set("username", email);
    user.set("email", email);
    user.set("password", password);
    user.set("firstName", firstName);
    user.set("lastName", lastName);
    user.set("alias", alias);

    await user.signUp();

    alert("Signup successful. Your account is pending approval.");
    await Parse.User.logOut();
    updateNavForLoginState();
    showScreen(pendingScreen);

  } catch (err) {
    alert("Signup failed: " + err.message);
  }
});

/* -------------------------------------------------------
   LOGIN
------------------------------------------------------- */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("Username").value.trim();
  const password = document.getElementById("Password").value.trim();

  try {
    const user = await Parse.User.logIn(username, password);
    const identifier = user.get("username") || user.get("email") || username;

    let res;
    try {
      res = await Parse.Cloud.run("checkApprovalStatus", { identifier });
    } catch (err) {
      console.error("checkApprovalStatus failed:", err);
      await Parse.User.logOut();
      alert("Unable to verify approval status right now.");
      return;
    }

    if (!res.found) {
      await Parse.User.logOut();
      alert("No account found.");
      return;
    }

    if (!res.isApproved) {
      await Parse.User.logOut();
      showScreen(pendingScreen);
      return;
    }

    updateNavForLoginState();
    window.location.href = "map-screen/index.html";

    setTimeout(() => initializeMapAndData(), 50);

  } catch (err) {
    alert("Login failed: " + err.message);
  }
});
