const logList = document.getElementById("log-list");
const loading = document.getElementById("log-loading");

const summaryPlayers = document.getElementById("sum-players");
const summaryCompletion = document.getElementById("sum-completion");
const summaryWins = document.getElementById("sum-wins");
const summaryLosses = document.getElementById("sum-losses");
const summaryAvgAch = document.getElementById("sum-avg-ach");
const summaryWon = document.getElementById("sum-won");

const playerSearch = document.getElementById("player-search");
const playerTbody = document.getElementById("player-tbody");

const detailOverlay = document.getElementById("detail-overlay");
const detailModal = document.getElementById("detail-modal");
const detailClose = document.getElementById("detail-close");
const detailTitle = document.getElementById("detail-title");
const detailKV = document.getElementById("detail-kv");


let oldestId = null;
let isLoadingOlder = false;
let isUserReadingOld = false;

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}

function createLogEl(item) {
  const div = document.createElement("div");
  div.className = "log-item";
  div.dataset.id = item.id;

  div.innerHTML = `
    <div class="log-line">${(item.email || "").split("@")[0]}-${item.username}-${item.deviceId}: ${item.content}</div>
    <div class="log-time">at: ${formatTime(item.createdAt)}</div>
  `;
  return div;
}

function prependLogs(items) {
  if (!items.length) return;

  const prevScrollHeight = logList.scrollHeight;
  const prevScrollTop = logList.scrollTop;

  const inAsc = [...items].reverse();
  const anchor = loading && loading.parentElement === logList ? loading.nextSibling : logList.firstChild;

  for (const it of inAsc) {
    logList.insertBefore(createLogEl(it), anchor);
  }

  const newScrollHeight = logList.scrollHeight;
  logList.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
}

function appendLog(item) {
  logList.appendChild(createLogEl(item));
  if (!isUserReadingOld) {
    logList.scrollTop = logList.scrollHeight;
  }
}

async function fetchLatest() {
  showLoadingTop();
  const r = await fetch("/api/admin/logs?limit=20");
  const data = await r.json();
  hideLoading();

  if (!data.success) return;

  const asc = [...data.logs].reverse();
  logList.innerHTML = "";
  logList.appendChild(loading);
  for (const it of asc) logList.appendChild(createLogEl(it));

  if (data.logs.length > 0) {
    oldestId = data.logs[data.logs.length - 1].id;
  }

  logList.scrollTop = logList.scrollHeight;
}


async function fetchOlder() {
  if (isLoadingOlder || !oldestId) return;
  isLoadingOlder = true;

  showLoadingTop();
  const r = await fetch(`/api/admin/logs?limit=20&beforeId=${oldestId}`);
  const data = await r.json();
  hideLoading();

  isLoadingOlder = false;
  if (!data.success || data.logs.length === 0) return;

  oldestId = data.logs[data.logs.length - 1].id;

  prependLogs(data.logs);
}


function startSse() {
  const es = new EventSource("/api/admin/logs/stream");

  es.onmessage = (e) => {
    const item = JSON.parse(e.data);
    if (item.type === "hello") return;

    if (logList.querySelector(`[data-id="${item.id}"]`)) return;

    appendLog(item);
  };

  es.onerror = () => {
  };
}

logList.addEventListener("scroll", () => {
  const nearBottom = (logList.scrollHeight - (logList.scrollTop + logList.clientHeight)) < 20;
  isUserReadingOld = !nearBottom;

  // load older khi chạm top
  if (logList.scrollTop <= 0) {
    fetchOlder();
  }
});
function showLoadingTop() {
  if (!loading) return;
  loading.classList.remove("hidden");
  logList.prepend(loading);
}

function hideLoading() {
  loading.classList.add("hidden");
}

function n2(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString();
}

function pct01(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return "0%";
  return Math.round(v * 100) + "%";
}

async function fetchSummary() {
  try {
    const r = await fetch("/api/admin/reports/summary");
    const data = await r.json();
    if (!data.success) return;

    const s = data.summary;

    summaryPlayers.textContent = n2(s.playersTotal);
    summaryWon.textContent = n2(s.playersWon);
    summaryCompletion.textContent = pct01(s.completionRate);
    summaryWins.textContent = n2(s.winsTotal);
    summaryLosses.textContent = n2(s.lossesTotal);
    summaryAvgAch.textContent = (Number(s.achievementsAvg) || 0).toFixed(2);
  } catch {}
}

function createPlayerRow(p) {
  const tr = document.createElement("tr");
  tr.dataset.email = p.email;
  tr.dataset.username = p.username;

  const playerName = `${(p.email || "").split("@")[0]}-${p.username}`;

  tr.innerHTML = `
    <td>${playerName}</td>
    <td>${n2(p.wins_total)}</td>
    <td>${n2(p.losses_total)}</td>
    <td>${n2(p.achievements_count)}</td>
    <td>${n2(p.device_count)}</td>
  `;

  tr.addEventListener("click", () => openDetail(p.email, p.username));
  return tr;
}

async function fetchPlayers(q = "") {
  try {
    const url = `/api/admin/reports/players?limit=100&q=${encodeURIComponent(q)}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!data.success) return;

    playerTbody.innerHTML = "";
    for (const p of data.players) {
      playerTbody.appendChild(createPlayerRow(p));
    }
  } catch {}
}

function showDetailModal() {
  detailOverlay.classList.add("show");
  detailModal.classList.add("show");
}
function hideDetailModal() {
  detailOverlay.classList.remove("show");
  detailModal.classList.remove("show");
}

async function openDetail(email, username) {
  try {
    const url = `/api/admin/reports/detail?email=${encodeURIComponent(email)}&username=${encodeURIComponent(username)}`;
    const r = await fetch(url);
    const data = await r.json();
    
    if (!data.success) return;

    const rep = data.report;
    if (!rep) return;

    detailTitle.textContent = `${(rep.email || "").split("@")[0]} - ${rep.username}`;

    const deviceIds = Array.isArray(rep.device_ids) ? rep.device_ids : [];
    const deviceText = deviceIds.length ? `${deviceIds.length}: ${deviceIds.join(" | ")}` : "0";
    const achIds = Array.isArray(rep.achievement_ids) ? rep.achievement_ids : [];
    const achText = achIds.length ? `${achIds.length}: ${achIds.join(" | ")}` : "0";

    detailKV.innerHTML = `
      <div class="modal-k">Wins total</div><div>${n2(rep.wins_total)}</div>
      <div class="modal-k">Losses total</div><div>${n2(rep.losses_total)}</div>
      <div class="modal-k">Achievements</div><div>${achText}</div>
      <div class="modal-k">Has won</div><div>${rep.has_won ? "Yes" : "No"}</div>
      <div class="modal-k">First win at</div><div>${rep.first_win_at ? formatTime(rep.first_win_at) : "-"}</div>
      <div class="modal-k">DeviceID</div><div>${deviceText}</div>
    `;

    showDetailModal();
  } catch {}
}

let _playerSearchTimer = null;
if (playerSearch) {
  playerSearch.addEventListener("input", () => {
    clearTimeout(_playerSearchTimer);
    _playerSearchTimer = setTimeout(() => {
      fetchPlayers(playerSearch.value || "");
    }, 250);
  });
}

if (detailClose) detailClose.addEventListener("click", hideDetailModal);
if (detailOverlay) detailOverlay.addEventListener("click", hideDetailModal);


fetchLatest().then(startSse);
fetchSummary();
fetchPlayers("");

setInterval(fetchSummary, 5000);

setInterval(() => {
  fetchPlayers(playerSearch ? (playerSearch.value || "") : "");
}, 5000);