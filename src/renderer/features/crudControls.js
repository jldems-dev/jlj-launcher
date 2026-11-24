// ============================================================
// CRUD CONTROLS BINDING
// ============================================================
function bindCrudControls() {
  const loginForm = $("loginForm");
  loginForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    login();
  });
  loginForm?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.repeat) event.preventDefault();
  });
  $("addGameButton")?.addEventListener("click", addGame);
  $("gameLaunchMethod")?.addEventListener("change", updateAppIdVisibility);
  $("confirmDeleteGameButton")?.addEventListener("click", delGame);
  $("cancelDeleteGameButton")?.addEventListener("click", closeDeleteModal);
}

