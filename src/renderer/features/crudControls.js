// ============================================================
// CRUD CONTROLS BINDING
// ============================================================
function bindCrudControls() {
  $("loginForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    login();
  });
  $("loginForm")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const isUsernameField = event.target.id === "loginUsername";
    if (isUsernameField || event.repeat) event.preventDefault();
    if (isUsernameField) $("loginPassword")?.focus();
  });
  $("addGameButton")?.addEventListener("click", addGame);
  $("gameLaunchMethod")?.addEventListener("change", updateAppIdVisibility);
  $("confirmDeleteGameButton")?.addEventListener("click", delGame);
  $("cancelDeleteGameButton")?.addEventListener("click", closeDeleteModal);
}

