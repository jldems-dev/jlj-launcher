// ============================================================
// CRUD CONTROLS BINDING
// ============================================================
function bindCrudControls() {
  $("loginButton")?.addEventListener("click", login);
  $("addGameButton")?.addEventListener("click", addGame);
  $("gameLaunchMethod")?.addEventListener("change", updateAppIdVisibility);
  $("confirmDeleteGameButton")?.addEventListener("click", delGame);
  $("cancelDeleteGameButton")?.addEventListener("click", closeDeleteModal);
}

