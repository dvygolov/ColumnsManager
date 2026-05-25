(() => {
  "use strict";

  const Config = {
    VERSION: "250526b5",
    APP: "ColumnsManager",
    API_URL: "https://adsmanager-graph.facebook.com/v23.0/",
    CACHE_KEY: "columnsmanager.lastPackage.v1",
  };
  const APP_ID = "ywbColumnsManager";
  const APP_TITLE = "Columns Manager";
  const APP_MARK_SVG = `<svg class="ywb-mark" viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="${APP_ID}-gold" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="#ffe16a"/><stop offset="55%" stop-color="#ffd000"/><stop offset="100%" stop-color="#ffab00"/></linearGradient></defs><rect x="4" y="4" width="88" height="88" rx="22" fill="#151515" stroke="url(#${APP_ID}-gold)" stroke-width="6"/><text x="48" y="59" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="32" font-weight="900" letter-spacing="-2" fill="url(#${APP_ID}-gold)">CM</text></svg>`;

  if (window.__ColumnsManagerPayloadBuild === Config.VERSION && typeof window.showColumnsManager === "function") {
    window.showColumnsManager();
    return;
  }
  window.__ColumnsManagerPayloadBuild = Config.VERSION;

  const state = {
    accounts: [],
    exportAccountId: "",
    importAccountId: "",
    exportPresets: [],
    selectedPresetIds: new Set(),
    loadedPresetAccountId: "",
    package: null,
    logs: [],
    activeTab: "export",
    loadingAccounts: false,
    loadingPresets: false,
    busy: false,
    logsOpen: false,
    exportInSingleFile: true,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getAccessToken() {
    if (window.__accessToken) return window.__accessToken;
    const entries = performance.getEntriesByType("resource").map((entry) => entry.name || "");
    for (const url of entries) {
      if (!url.includes("adsmanager-graph.facebook.com") || !url.includes("access_token=")) continue;
      try {
        const token = new URL(url).searchParams.get("access_token");
        if (token) return token;
      } catch (error) {
        // Ignore malformed resource URLs.
      }
    }
    return "";
  }

  function cleanAccountId(value) {
    return String(value || "").trim().replace(/^act_/, "").replace(/[^\d]/g, "");
  }

  function getCurrentAccountId() {
    try {
      if (typeof require === "function") {
        const context = require("BusinessUnifiedNavigationContext");
        return cleanAccountId(context?.adAccountID || "");
      }
    } catch (error) {
      // Ads Manager module may not be available on every route.
    }
    return "";
  }

  function getAccountLabel(account) {
    const id = cleanAccountId(account?.id);
    const name = account?.name || (id ? `act_${id}` : "Ad account");
    const suffix = account?.currency ? `, ${account.currency}` : "";
    return `${name}${suffix} [${id}]`;
  }

  function getPresetKey(preset, index) {
    return String(preset?.id || `${index}:${preset?.name || "Columns preset"}`);
  }

  function safeFileName(value, fallback = "columns-preset") {
    const name = String(value || fallback)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");
    return (name || fallback).slice(0, 96);
  }

  function buildExportFileName(accountId, selectedPresets) {
    if (selectedPresets.length === 1) {
      return `${safeFileName(selectedPresets[0].name)}.json`;
    }
    const names = selectedPresets.slice(0, 3).map((preset) => safeFileName(preset.name, "preset"));
    const suffix = selectedPresets.length > 3 ? ` and ${selectedPresets.length - 3} more` : "";
    return `${safeFileName(names.join(" + ") + suffix, `columns act_${accountId}`)}.json`;
  }

  function log(message, type = "info") {
    const item = { ts: new Date().toISOString(), type, message };
    state.logs.push(item);
    if (state.logs.length > 300) state.logs.shift();
    const box = document.querySelector("#ywbColumnsLog");
    if (box) renderLogs(box);
    (type === "error" ? console.error : console.log)(`[${Config.APP}] ${message}`);
  }

  function renderLogs(box = document.querySelector("#ywbColumnsLog")) {
    if (!box) return;
    const root = document.querySelector("#ywbColumnsManager");
    const toggle = root?.querySelector("#ywbColumnsLogToggle");
    const count = root?.querySelector("#ywbColumnsLogCount");
    const last = root?.querySelector("#ywbColumnsLogLast");
    const latest = state.logs[state.logs.length - 1];
    if (toggle) {
      toggle.setAttribute("aria-expanded", state.logsOpen ? "true" : "false");
      toggle.textContent = state.logsOpen ? "Hide logs" : "Show logs";
    }
    if (count) count.textContent = String(state.logs.length);
    if (last) last.textContent = latest ? `[${latest.ts.slice(11, 19)}] ${latest.message}` : "No log entries yet.";
    box.innerHTML = state.logs
      .map(
        (item) =>
          `<div class="ywb-log-row ${escapeHtml(item.type)}">[${escapeHtml(item.ts.slice(11, 19))}] ${escapeHtml(item.message)}</div>`,
      )
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function downloadJson(fileName, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error("Cannot read selected file."));
      reader.readAsText(file);
    });
  }

  class GraphApi {
    constructor(token = getAccessToken()) {
      this.token = token;
      if (!this.token) {
        throw new Error("Ads Manager access_token not found. Wait for Ads Manager to fully load and run the bookmarklet again.");
      }
    }

    url(path, params = {}) {
      const finalUrl = path.startsWith("http") ? new URL(path) : new URL(path.replace(/^\/+/, ""), Config.API_URL);
      if (!finalUrl.searchParams.has("access_token")) finalUrl.searchParams.set("access_token", this.token);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") finalUrl.searchParams.set(key, String(value));
      });
      return finalUrl.toString();
    }

    async request(path, params = {}, init = {}) {
      const response = await fetch(this.url(path, params), {
        credentials: "include",
        cache: "no-store",
        ...init,
      });
      const text = await response.text();
      const clean = text.replace(/^for\s*\(;;\);\s*/, "");
      let json = {};
      try {
        json = clean ? JSON.parse(clean) : {};
      } catch (error) {
        throw new Error(`Graph response is not JSON: ${text.slice(0, 180)}`);
      }
      if (!response.ok || json.error) {
        throw new Error(json.error?.message || `${response.status} ${text.slice(0, 180)}`);
      }
      return json;
    }

    get(path, params = {}) {
      return this.request(path, params);
    }

    post(path, body = {}) {
      const form = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) form.set(key, typeof value === "string" ? value : JSON.stringify(value));
      });
      return this.request(path, {}, { method: "POST", body: form });
    }

    delete(path, body = {}) {
      const form = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) form.set(key, typeof value === "string" ? value : JSON.stringify(value));
      });
      return this.request(path, {}, { method: "DELETE", body: form });
    }
  }

  async function graphGetAll(path, params = {}) {
    const api = new GraphApi();
    const rows = [];
    let nextPath = path;
    let nextParams = params;
    while (nextPath) {
      const data = await api.get(nextPath, nextParams);
      rows.push(...(data.data || []));
      nextPath = data.paging?.next || "";
      nextParams = {};
    }
    return rows;
  }

  async function loadAccounts() {
    if (state.loadingAccounts) return state.accounts;
    state.loadingAccounts = true;
    renderUiState();
    try {
      log("Loading ad accounts...");
      const rows = await graphGetAll("me/adaccounts", {
        fields: ["id", "name", "account_status", "currency", "timezone_name"].join(","),
      });
      const deduped = new Map();
      for (const row of rows) {
        const account = {
          id: cleanAccountId(row.id),
          name: row.name || row.id,
          currency: row.currency || "",
          status: row.account_status || "",
          raw: row,
        };
        if (account.id && !deduped.has(account.id)) deduped.set(account.id, account);
      }
      state.accounts = [...deduped.values()].sort((left, right) =>
        getAccountLabel(left).localeCompare(getAccountLabel(right), "ru"),
      );
      const currentAccountId = getCurrentAccountId();
      if (!state.exportAccountId) state.exportAccountId = currentAccountId || state.accounts[0]?.id || "";
      if (!state.importAccountId) state.importAccountId = currentAccountId || state.accounts[0]?.id || "";
      log(`Loaded ${state.accounts.length} account(s).`, "success");
      return state.accounts;
    } finally {
      state.loadingAccounts = false;
      renderUiState();
    }
  }

  async function fetchColumnPresets(accountId) {
    const cleanId = cleanAccountId(accountId);
    if (!cleanId) throw new Error("Choose an ad account first.");
    const api = new GraphApi();
    const response = await api.get(`act_${cleanId}`, {
      fields: "name,account_id,user_settings{column_presets{columns,id,name}}",
    });
    const presets = response?.user_settings?.column_presets?.data || [];
    return {
      accountId: cleanId,
      accountName: response.name || "",
      raw: response,
      presets: presets.map((preset, index) => ({
        key: getPresetKey(preset, index),
        id: preset.id || "",
        name: preset.name || "Columns preset",
        columns: Array.isArray(preset.columns) ? preset.columns : [],
      })),
    };
  }

  async function loadPresetsForAccount(accountId = state.exportAccountId) {
    const cleanId = cleanAccountId(accountId);
    if (!cleanId) {
      state.exportPresets = [];
      state.selectedPresetIds = new Set();
      state.loadedPresetAccountId = "";
      renderUiState();
      return [];
    }
    state.loadingPresets = true;
    state.exportPresets = [];
    state.selectedPresetIds = new Set();
    state.loadedPresetAccountId = cleanId;
    renderUiState();
    try {
      log(`Loading column presets from act_${cleanId}...`);
      const data = await fetchColumnPresets(cleanId);
      state.exportPresets = data.presets;
      state.loadedPresetAccountId = data.accountId;
      state.selectedPresetIds = new Set(data.presets.map((preset) => preset.key));
      log(`Found ${data.presets.length} preset(s) in act_${cleanId}.`, data.presets.length ? "success" : "warning");
      return data.presets;
    } finally {
      state.loadingPresets = false;
      renderUiState();
    }
  }

  function buildPresetPackage(accountId, account, presets) {
    return {
      app: Config.APP,
      version: Config.VERSION,
      exportedAt: new Date().toISOString(),
      sourceAccountId: accountId,
      sourceAccountName: account?.name || "",
      presets: presets.map((preset) => ({
        id: preset.id || "",
        name: preset.name || "Columns preset",
        columns: preset.columns || [],
      })),
    };
  }

  async function exportColumnPresets(accountId = state.exportAccountId, presetIds = state.selectedPresetIds) {
    const cleanId = cleanAccountId(accountId);
    if (!cleanId) throw new Error("Choose an export account first.");
    if (state.loadedPresetAccountId !== cleanId) {
      await loadPresetsForAccount(cleanId);
    }
    const selectedIds = new Set([...presetIds].map(String));
    const selectedPresets = state.exportPresets.filter((preset) => selectedIds.has(String(preset.key)));
    if (!selectedPresets.length) throw new Error("Choose at least one preset to export.");
    const account = state.accounts.find((item) => item.id === cleanId);
    let pack = null;
    if (state.exportInSingleFile) {
      pack = buildPresetPackage(cleanId, account, selectedPresets);
      downloadJson(buildExportFileName(cleanId, selectedPresets), pack);
      log(`Exported ${pack.presets.length} selected preset(s) in one file.`, "success");
    } else {
      for (const preset of selectedPresets) {
        const singlePack = buildPresetPackage(cleanId, account, [preset]);
        downloadJson(`${safeFileName(preset.name, "columns-preset")}.json`, singlePack);
      }
      pack = buildPresetPackage(cleanId, account, selectedPresets);
      log(`Exported ${selectedPresets.length} selected preset(s) as separate files.`, "success");
    }
    state.package = pack;
    localStorage.setItem(Config.CACHE_KEY, JSON.stringify(pack));
    renderUiState();
    return pack;
  }

  async function ensureUserSettings(api, accountId) {
    const settingsResponse = await api.get(`act_${accountId}`, { fields: "user_settings" });
    let userSettingsId = settingsResponse?.user_settings?.id || "";
    if (!userSettingsId) {
      log(`Creating user_settings for act_${accountId}...`);
      const created = await api.post(`act_${accountId}/user_settings`);
      userSettingsId = created.id || "";
    }
    if (!userSettingsId) throw new Error(`Cannot resolve user_settings id for act_${accountId}.`);
    return userSettingsId;
  }

  async function deleteColumnPreset(api, userSettingsId, preset) {
    const presetId = String(preset?.id || "").trim();
    if (!presetId) return false;
    try {
      await api.delete(presetId);
      return true;
    } catch (objectError) {
      try {
        await api.delete(`${userSettingsId}/column_presets`, { id: presetId });
        return true;
      } catch (edgeError) {
        throw new Error(edgeError.message || objectError.message);
      }
    }
  }

  async function clearExistingColumnPresets(api, accountId, userSettingsId) {
    const existing = await fetchColumnPresets(accountId);
    const presets = existing.presets.filter((preset) => preset.id);
    if (!presets.length) {
      log(`No existing presets found in act_${accountId}.`);
      return { deleted: 0, total: 0 };
    }
    log(`Deleting ${presets.length} existing preset(s) in act_${accountId}...`, "warning");
    let deleted = 0;
    for (const preset of presets) {
      try {
        if (await deleteColumnPreset(api, userSettingsId, preset)) {
          deleted += 1;
          log(`Deleted existing preset "${preset.name}" (${preset.id}).`, "success");
        }
      } catch (error) {
        log(`Could not delete existing preset "${preset.name}" (${preset.id}): ${error.message}`, "warning");
      }
    }
    log(`Clear existing finished: ${deleted}/${presets.length} preset(s) deleted.`, deleted === presets.length ? "success" : "warning");
    return { deleted, total: presets.length };
  }

  async function importPresetsToAccount(accountId, pack, clearExisting) {
    const cleanId = cleanAccountId(accountId);
    if (!cleanId) throw new Error("Choose an import account first.");
    if (!pack?.presets?.length) throw new Error("Selected JSON has no presets.");
    const api = new GraphApi();
    const userSettingsId = await ensureUserSettings(api, cleanId);
    if (clearExisting) {
      await clearExistingColumnPresets(api, cleanId, userSettingsId);
    }
    let ok = 0;
    for (const preset of pack.presets || []) {
      try {
        await api.post(`${userSettingsId}/column_presets`, {
          name: preset.name || "Columns preset",
          columns: JSON.stringify(preset.columns || []),
        });
        ok += 1;
        log(`Imported "${preset.name || "Columns preset"}" into act_${cleanId}.`, "success");
      } catch (error) {
        log(`Failed to import "${preset.name || "Columns preset"}" into act_${cleanId}: ${error.message}`, "error");
      }
    }
    log(`Import finished: ${ok}/${pack.presets.length} preset(s) into act_${cleanId}.`, ok ? "success" : "warning");
    return { accountId: cleanId, imported: ok, total: pack.presets.length };
  }

  async function importColumnPresets(accountId, pack, clearExisting = false) {
    return importPresetsToAccount(accountId, pack, clearExisting);
  }

  async function importSelectedJson(file, accountId, clearExisting) {
    if (!file) return null;
    const cleanId = cleanAccountId(accountId);
    if (!cleanId) throw new Error("Choose an import account first.");
    const pack = await readJsonFile(file);
    if (!pack?.presets?.length) throw new Error("Selected JSON has no presets.");
    state.package = pack;
    localStorage.setItem(Config.CACHE_KEY, JSON.stringify(pack));
    log(`Importing ${pack.presets.length} preset(s) from ${file.name}...`);
    const result = await importPresetsToAccount(cleanId, pack, clearExisting);
    renderUiState();
    return result;
  }

  function renderAccountOptions(selectedId) {
    if (state.loadingAccounts) return `<option value="">Loading accounts...</option>`;
    if (!state.accounts.length) return `<option value="">No accounts loaded</option>`;
    const options = [`<option value="">Choose account</option>`];
    for (const account of state.accounts) {
      options.push(
        `<option value="${escapeHtml(account.id)}" ${account.id === selectedId ? "selected" : ""}>${escapeHtml(getAccountLabel(account))}</option>`,
      );
    }
    return options.join("");
  }

  function renderPresetList() {
    if (!state.exportAccountId) {
      return `<div class="ywb-empty">Choose an account to load column presets.</div>`;
    }
    if (state.loadingPresets) {
      return `<div class="ywb-empty">Loading presets...</div>`;
    }
    if (!state.exportPresets.length) {
      return `<div class="ywb-empty">No column presets found for this account.</div>`;
    }
    return state.exportPresets
      .map((preset) => {
        const columnsCount = Array.isArray(preset.columns) ? preset.columns.length : 0;
        return `
          <label class="ywb-preset">
            <input type="checkbox" data-preset-key="${escapeHtml(preset.key)}" ${state.selectedPresetIds.has(preset.key) ? "checked" : ""}>
            <span>
              <strong>${escapeHtml(preset.name)}</strong>
              <small>${columnsCount} column${columnsCount === 1 ? "" : "s"}</small>
            </span>
          </label>`;
      })
      .join("");
  }

  function renderUiState() {
    const root = document.querySelector("#ywbColumnsManager");
    if (!root) return;
    const exportSelect = root.querySelector("#ywbColumnsExportAccount");
    const importSelect = root.querySelector("#ywbColumnsImportAccount");
    const presets = root.querySelector("#ywbColumnsPresets");
    const selectAll = root.querySelector("#ywbColumnsSelectAll");
    const exportButton = root.querySelector("#ywbColumnsExport");
    const importButton = root.querySelector("#ywbColumnsImportButton");
    const packageInfo = root.querySelector("#ywbColumnsPackageInfo");
    const singleFile = root.querySelector("#ywbColumnsSingleFile");

    if (exportSelect) exportSelect.innerHTML = renderAccountOptions(state.exportAccountId);
    if (importSelect) importSelect.innerHTML = renderAccountOptions(state.importAccountId);
    if (presets) presets.innerHTML = renderPresetList();
    if (selectAll) {
      selectAll.checked = Boolean(state.exportPresets.length) && state.selectedPresetIds.size === state.exportPresets.length;
      selectAll.indeterminate = state.selectedPresetIds.size > 0 && state.selectedPresetIds.size < state.exportPresets.length;
      selectAll.disabled = !state.exportPresets.length || state.loadingPresets;
    }
    if (exportButton) {
      exportButton.disabled = state.busy || state.loadingPresets || !state.selectedPresetIds.size;
      exportButton.textContent = state.busy && state.activeTab === "export" ? "Exporting..." : "Export selected";
    }
    if (importButton) importButton.disabled = state.busy || !state.importAccountId;
    if (packageInfo) {
      packageInfo.textContent = state.package
        ? `Last JSON: ${state.package.presets?.length || 0} preset(s) from act_${state.package.sourceAccountId || "unknown"}`
        : "Choose JSON during import; no separate load step needed.";
    }
    if (singleFile) singleFile.checked = state.exportInSingleFile;

    root.querySelectorAll("[data-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.activeTab);
    });
    root.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== state.activeTab;
    });
    root.querySelector("#ywbColumnsLogs")?.classList.toggle("open", state.logsOpen);
    renderLogs();
  }

  function createUi() {
    const old = document.querySelector("#ywbColumnsManager");
    if (old) old.remove();
    const root = document.createElement("div");
    root.id = "ywbColumnsManager";
    root.innerHTML = `
      <style>
        #ywbColumnsManager{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:none;font:13px/1.4 "Segoe UI","Trebuchet MS",sans-serif;color:#f5f5f5}
        #ywbColumnsManager *{box-sizing:border-box}
        #ywbColumnsManager .ywb-shell{position:relative;width:min(620px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));background:#1a1a1a;border:2px solid #ffc107;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.7);padding:16px;overflow:hidden;pointer-events:auto;display:flex;flex-direction:column}
        .ywb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;flex:0 0 auto}
        .ywb-title-row{display:inline-flex;align-items:center;gap:10px}
        .ywb-mark{width:30px;height:30px;display:block;flex:0 0 auto;filter:drop-shadow(0 6px 14px rgba(255,193,7,.18))}
        .ywb-head h2{margin:0;color:#ffc107;font-size:20px;line-height:1.08;letter-spacing:0}
        .ywb-build{font-size:12px;font-weight:600;color:#aaa;vertical-align:middle;margin-left:4px}
        .ywb-byline{display:block;font-size:12px;color:#ffc107;text-decoration:none;opacity:.7;margin-top:2px}
        .ywb-byline:hover{opacity:1;text-decoration:underline}
        .ywb-close{border:1px solid #ffc107;background:#2a2a2a;color:#ffc107;width:32px;height:32px;border-radius:6px;font-weight:900;cursor:pointer;flex:0 0 auto}
        .ywb-close:hover{background:#ffc107;color:#111}
        .ywb-content{min-height:0;overflow:auto;padding-right:4px}
        .ywb-body{display:grid;gap:12px}
        .ywb-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .ywb-tab{border:1px solid #444;background:#2a2a2a;color:#f5f5f5;border-radius:6px;padding:9px 12px;font-weight:800;cursor:pointer}
        .ywb-tab.active{background:#ffc107;color:#111;border-color:#ffc107}
        .ywb-panel{display:grid;gap:10px}
        .ywb-panel[hidden]{display:none}
        .ywb-field{display:grid;gap:5px}
        .ywb-field span{color:#aaa;font-size:12px}
        .ywb-field select{width:100%;border:1px solid #555;border-radius:6px;background:#2a2a2a;color:#f5f5f5;padding:9px 12px;font-size:13px}
        .ywb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
        .ywb-row button,.ywb-file,#ywbColumnsRefresh{border:1px solid #ffc107;background:#ffc107;color:#111;border-radius:6px;padding:9px 12px;font-weight:800;cursor:pointer}
        .ywb-row button.primary,.ywb-file.primary{background:#ffc107;color:#111}
        #ywbColumnsRefresh{background:#2a2a2a;color:#ffc107}
        .ywb-row button:hover:not(:disabled),.ywb-file:hover,#ywbColumnsRefresh:hover{filter:brightness(1.08)}
        .ywb-row button:disabled,.ywb-file.disabled{opacity:.48;cursor:not-allowed}
        .ywb-check{display:flex;gap:8px;align-items:center;color:#aaa}
        .ywb-presets-head{display:flex;justify-content:space-between;gap:12px;align-items:center;color:#aaa;border-bottom:1px solid #444;padding-bottom:8px}
        .ywb-presets{display:grid;gap:6px;max-height:clamp(118px,22vh,178px);overflow:auto;border:1px solid #444;background:#222;border-radius:8px;padding:8px}
        .ywb-preset{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:7px 8px;border:1px solid #333;border-radius:6px;background:#1a1a1a}
        .ywb-preset strong{display:block;color:#f5f5f5;font-size:13px}
        .ywb-preset small{display:block;color:#aaa;font-size:11px;margin-top:2px}
        .ywb-empty{color:#aaa;padding:12px;text-align:center}
        .ywb-note{color:#aaa;font-size:12px}
        .ywb-logs{border:1px solid #444;background:#141414;border-radius:8px;overflow:hidden}
        .ywb-logs-head{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid #333}
        .ywb-logs-title{display:flex;align-items:center;gap:8px;color:#ffc107;font-weight:800}
        .ywb-log-count{min-width:22px;height:20px;border:1px solid #5f4b00;border-radius:999px;display:inline-grid;place-items:center;color:#aaa;font-size:11px;font-weight:700}
        .ywb-log-last{grid-column:1/-1;min-width:0;color:#aaa;font:11px/1.35 Consolas,"Courier New",monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #ywbColumnsLogToggle{border:1px solid #ffc107;background:#2a2a2a;color:#ffc107;border-radius:6px;padding:6px 10px;font-weight:800;cursor:pointer}
        #ywbColumnsLogToggle:hover{background:#ffc107;color:#111}
        .ywb-log-body{display:none;border-top:1px solid #222}
        .ywb-logs.open .ywb-log-body{display:block}
        #ywbColumnsLog{height:120px;overflow:auto;background:#101010;color:#ccc;padding:8px;font:11px/1.4 Consolas,"Courier New",monospace;white-space:pre-wrap}
        .ywb-log-row.success{color:#9ef59e}.ywb-log-row.error{color:#ff9e9e}.ywb-log-row.warning{color:#ffd86b}
        @media(max-width:720px){#ywbColumnsManager{padding:10px}.ywb-shell{width:calc(100vw - 20px);max-height:calc(100vh - 20px)}.ywb-row{flex-direction:column;align-items:stretch}.ywb-row button,.ywb-file,#ywbColumnsRefresh{width:100%}.ywb-head h2{font-size:18px}.ywb-build{display:block;margin:2px 0 0}}
      </style>
      <div class="ywb-shell">
        <div class="ywb-head">
          <div>
            <div class="ywb-title-row">${APP_MARK_SVG}<h2>${APP_TITLE} <span class="ywb-build">build ${escapeHtml(Config.VERSION)}</span></h2></div>
            <a class="ywb-byline" href="https://yellowweb.top" target="_blank" rel="noopener">by Yellow Web</a>
          </div>
          <button class="ywb-close" title="Close">&#x2715;</button>
        </div>
        <div class="ywb-content">
          <div class="ywb-body">
            <div class="ywb-tabs">
              <button class="ywb-tab active" data-tab="export">Export</button>
              <button class="ywb-tab" data-tab="import">Import</button>
            </div>

            <div class="ywb-panel" data-panel="export">
              <label class="ywb-field">
                <span>Account</span>
                <select id="ywbColumnsExportAccount">${renderAccountOptions(state.exportAccountId)}</select>
              </label>
              <div class="ywb-presets-head">
                <label class="ywb-check"><input id="ywbColumnsSelectAll" type="checkbox"> select all presets</label>
                <button id="ywbColumnsRefresh" type="button">Refresh</button>
              </div>
              <div id="ywbColumnsPresets" class="ywb-presets">${renderPresetList()}</div>
              <label class="ywb-check"><input id="ywbColumnsSingleFile" type="checkbox" checked> Export in single file</label>
              <div class="ywb-row">
                <button class="primary" id="ywbColumnsExport">Export selected</button>
              </div>
            </div>

            <div class="ywb-panel" data-panel="import" hidden>
              <label class="ywb-field">
                <span>Account</span>
                <select id="ywbColumnsImportAccount">${renderAccountOptions(state.importAccountId)}</select>
              </label>
              <div class="ywb-row">
                <label class="ywb-file primary">Import JSON<input id="ywbColumnsFile" type="file" accept=".json,application/json" hidden></label>
                <label class="ywb-check"><input id="ywbColumnsClear" type="checkbox"> clear existing first</label>
              </div>
              <div id="ywbColumnsPackageInfo" class="ywb-note">Choose JSON during import; no separate load step needed.</div>
            </div>

            <section class="ywb-logs" id="ywbColumnsLogs">
              <div class="ywb-logs-head">
                <div class="ywb-logs-title">Logs <span class="ywb-log-count" id="ywbColumnsLogCount">0</span></div>
                <button id="ywbColumnsLogToggle" type="button" aria-expanded="false">Show logs</button>
                <div class="ywb-log-last" id="ywbColumnsLogLast">No log entries yet.</div>
              </div>
              <div class="ywb-log-body">
                <div id="ywbColumnsLog"></div>
              </div>
            </section>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);

    root.querySelector(".ywb-close").onclick = () => root.remove();
    root.querySelector("#ywbColumnsLogToggle").onclick = () => {
      state.logsOpen = !state.logsOpen;
      renderUiState();
    };
    root.querySelectorAll("[data-tab]").forEach((button) => {
      button.onclick = () => {
        state.activeTab = button.dataset.tab || "export";
        renderUiState();
      };
    });
    root.querySelector("#ywbColumnsExportAccount").onchange = async (event) => {
      state.exportAccountId = cleanAccountId(event.target.value);
      try {
        await loadPresetsForAccount(state.exportAccountId);
      } catch (error) {
        log(error.message, "error");
      }
    };
    root.querySelector("#ywbColumnsImportAccount").onchange = (event) => {
      state.importAccountId = cleanAccountId(event.target.value);
      renderUiState();
    };
    root.querySelector("#ywbColumnsRefresh").onclick = async () => {
      try {
        await loadPresetsForAccount(state.exportAccountId);
      } catch (error) {
        log(error.message, "error");
      }
    };
    root.querySelector("#ywbColumnsSelectAll").onchange = (event) => {
      state.selectedPresetIds = event.target.checked
        ? new Set(state.exportPresets.map((preset) => preset.key))
        : new Set();
      renderUiState();
    };
    root.querySelector("#ywbColumnsSingleFile").onchange = (event) => {
      state.exportInSingleFile = event.target.checked;
      renderUiState();
    };
    root.querySelector("#ywbColumnsPresets").onchange = (event) => {
      const input = event.target.closest("input[data-preset-key]");
      if (!input) return;
      if (input.checked) state.selectedPresetIds.add(input.dataset.presetKey);
      else state.selectedPresetIds.delete(input.dataset.presetKey);
      renderUiState();
    };
    root.querySelector("#ywbColumnsExport").onclick = async () => {
      state.busy = true;
      state.activeTab = "export";
      renderUiState();
      try {
        await exportColumnPresets(state.exportAccountId, state.selectedPresetIds);
      } catch (error) {
        log(error.message, "error");
      } finally {
        state.busy = false;
        renderUiState();
      }
    };
    root.querySelector("#ywbColumnsFile").onchange = async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      state.busy = true;
      state.activeTab = "import";
      renderUiState();
      try {
        await importSelectedJson(file, state.importAccountId, root.querySelector("#ywbColumnsClear").checked);
      } catch (error) {
        log(`Cannot import JSON: ${error.message}`, "error");
      } finally {
        state.busy = false;
        renderUiState();
      }
    };

    try {
      const cached = JSON.parse(localStorage.getItem(Config.CACHE_KEY) || "null");
      if (cached?.presets) state.package = cached;
    } catch (error) {
      // Ignore malformed cache.
    }
    renderUiState();
    log("Ready.");
    loadAccounts()
      .then(() => {
        if (state.exportAccountId) return loadPresetsForAccount(state.exportAccountId);
        return null;
      })
      .catch((error) => log(error.message, "error"));
  }

  window.showColumnsManager = async () => createUi();
  window.ColumnsManager = {
    Config,
    state,
    exportColumnPresets,
    importColumnPresets,
    loadAccounts,
    loadPresetsForAccount,
    debug: { getAccessToken, cleanAccountId, getCurrentAccountId },
  };

  createUi();
})();
