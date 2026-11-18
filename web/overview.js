// The overview: balance, monthly figures and the spending cake.

// ---- Overview ----

async function loadOverview() {
  try {
    summary = await callBackend("getSummary");
    renderSummary(summary, true);
  } catch (error) {
    reportError(error);
  }
}

function countUp(node, target) {
  const duration = 700;
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    node.textContent = money.format(Math.round(target * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderSummary({ items = [], syncedAt = "", pendingReview }, animate = false) {
  const find = (label) => items.find((item) => item.label === label);
  const balance = find(balanceLabel);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!balance) $("#heroBalance").textContent = "—";
  else if (animate && !still) countUp($("#heroBalance"), balance.amount);
  else $("#heroBalance").textContent = money.format(balance.amount);
  const synced = syncedAt ? new Date(syncedAt) : null;
  $("#heroSynced").textContent = synced && !Number.isNaN(synced.getTime()) ? ` · ${syncedFormat.format(synced)} 同步` : "";

  document.querySelectorAll(".stat[data-label]").forEach((stat) => {
    const item = find(stat.dataset.label);
    stat.hidden = !item;
    if (item) stat.querySelector("strong").textContent = money.format(item.amount);
  });
  // Only the treasurer receives a count; it opens the review list.
  $("#heroReview").hidden = typeof pendingReview !== "number";
  $("#heroReview button").textContent = pendingReview > 0 ? `${pendingReview} 筆 →` : "0 筆";

  const spending = items.filter((item) => !totalLabels.includes(item.label));
  const expense = find(expenseLabel);
  const total = expense ? expense.amount : spending.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const layers = renderCake($("#cakeArt"), spending);
  // Legend rows follow the cake from the top layer down.
  $("#cakeLegend").replaceChildren(...(spending.length ? layers : []).flatMap((layer) => {
    const term = element("dt");
    term.append(element("span", `swatch block layer-${layer.index % maxLayers}`), element("span", "", layer.label));
    const share = total > 0 ? `${Math.round((layer.amount / total) * 100)}%` : "";
    return [term, element("dd", "share", share), element("dd", "", money.format(layer.amount))];
  }));
  $("#summaryEmpty").hidden = items.length > 0;
}
