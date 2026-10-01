function requestAppActionConfirmation({ title, message, confirmLabel = "確認", action }) {
  pendingAppAction = action;
  $("#appActionConfirmTitle").textContent = title;
  $("#appActionConfirmMessage").textContent = message;
  $("#confirmAppAction").textContent = confirmLabel;
  $("#appActionConfirmDialog").hidden = false;
}

function closeAppActionConfirmation() {
  pendingAppAction = null;
  $("#appActionConfirmDialog").hidden = true;
}

