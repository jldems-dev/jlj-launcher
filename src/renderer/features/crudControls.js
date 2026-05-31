// ============================================================
// CRUD CONTROLS BINDING
// ============================================================
function bindCrudControls() {
  $("loginButton")?.addEventListener("click", login);
  $("addGameButton")?.addEventListener("click", addGame);
  $("confirmDeleteGameButton")?.addEventListener("click", delGame);
  $("cancelDeleteGameButton")?.addEventListener("click", closeDeleteModal);
}

