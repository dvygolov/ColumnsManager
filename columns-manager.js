(() => {
  "use strict";

  const Config = {
    VERSION: "200526b1",
    APP: "ColumnsManager",
    API_URL: "https://adsmanager-graph.facebook.com/v23.0/",
    CACHE_KEY: "columnsmanager.lastPackage.v1",
  };

  if (window.__ColumnsManagerPayloadBuild === Config.VERSION && typeof window.showColumnsManager === "function") {
    window.showColumnsManager();
    return;
  }
  window.__ColumnsManagerPayloadBuild = Config.VERSION;

  const state = {
    package: null,
    logs: [],
  };

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

  function splitAccountIds(value) {
    return String(value || "")
      .split(/[\s,;]+/)
      .map(cleanAccountId)
      .filter(Boolean);
  }

  function log(message, type = "info") {
    const item = { ts: new Date().toISOString(), type, message };
    state.logs.push(item);
    if (state.logs.length > 300) state.logs.shift();
    const box = document.querySelector("#ywbColumnsLog");
    if (box) {
      const row = document.createElement("div");
      row.className = `ywb-log-row ${type}`;
      row.textContent = `[${item.ts.slice(11, 19)}] ${message}`;
      box.appendChild(row);
      box.scrollTop = box.scrollHeight;
    }
    (type === "error" ? console.error : console.log)(`[${Config.APP}] ${message}`);
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

  async function exportColumnPresets(accountId) {
    const cleanId = cleanAccountId(accountId);
    if (!cleanId) throw new Error("Source account id is required.");
    const api = new GraphApi();
    log(`Exporting column presets from act_${cleanId}...`);
    const response = await api.get(`act_${cleanId}`, {
      fields: "name,account_id,user_settings{column_presets{columns,id,name}}",
    });
    const presets = response?.user_settings?.column_presets?.data || [];
    const pack = {
      app: Config.APP,
      version: Config.VERSION,
      exportedAt: new Date().toISOString(),
      sourceAccountId: cleanId,
      sourceAccountName: response.name || "",
      presets: presets.map((preset) => ({
        id: preset.id || "",
        name: preset.name || "Columns preset",
        columns: preset.columns || [],
      })),
      raw: response,
    };
    state.package = pack;
    localStorage.setItem(Config.CACHE_KEY, JSON.stringify(pack));
    downloadJson(`columns_${cleanId}_${new Date().toISOString().slice(0, 10)}.json`, pack);
    log(`Exported ${pack.presets.length} preset(s).`, "success");
    updatePackageInfo();
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

  async function importPresetsToAccount(accountId, pack, clearExisting) {
    const api = new GraphApi();
    const userSettingsId = await ensureUserSettings(api, accountId);
    if (clearExisting) {
      log(`Deleting existing presets in act_${accountId}...`, "warning");
      await api.delete(`${userSettingsId}/column_presets`);
    }
    let ok = 0;
    for (const preset of pack.presets || []) {
      try {
        await api.post(`${userSettingsId}/column_presets`, {
          name: preset.name || "Columns preset",
          columns: JSON.stringify(preset.columns || []),
        });
        ok += 1;
        log(`Imported "${preset.name}" into act_${accountId}.`, "success");
      } catch (error) {
        log(`Failed to import "${preset.name}" into act_${accountId}: ${error.message}`, "error");
      }
    }
    return { accountId, imported: ok, total: (pack.presets || []).length };
  }

  async function importColumnPresets(accountIds, pack, clearExisting = false) {
    const ids = splitAccountIds(accountIds);
    if (!ids.length) throw new Error("Target account id is required.");
    if (!pack?.presets?.length) throw new Error("Import package has no presets.");
    const results = [];
    for (const accountId of ids) {
      log(`Importing ${pack.presets.length} preset(s) into act_${accountId}...`);
      results.push(await importPresetsToAccount(accountId, pack, clearExisting));
    }
    log(`Import finished for ${results.length} account(s).`, "success");
    return results;
  }

  function updatePackageInfo() {
    const el = document.querySelector("#ywbColumnsPackageInfo");
    if (!el) return;
    const pack = state.package;
    el.textContent = pack
      ? `${pack.presets?.length || 0} preset(s) loaded from act_${pack.sourceAccountId || "unknown"}`
      : "No package loaded.";
  }

  function createUi() {
    const old = document.querySelector("#ywbColumnsManager");
    if (old) old.remove();
    const root = document.createElement("div");
    root.id = "ywbColumnsManager";
    root.innerHTML = `
      <style>
        #ywbColumnsManager{position:fixed;inset:24px 24px auto auto;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 48px);z-index:2147483647;background:#181818;color:#f8f0c8;border:2px solid #ffd000;border-radius:8px;box-shadow:0 24px 80px #0009;font:14px/1.45 Verdana,sans-serif;overflow:hidden}
        #ywbColumnsManager *{box-sizing:border-box}
        .ywb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:#ffd000;color:#111;font-weight:900}
        .ywb-close{border:0;background:#111;color:#ffd000;width:30px;height:30px;border-radius:6px;font-weight:900;cursor:pointer}
        .ywb-body{padding:14px 16px;display:grid;gap:12px;overflow:auto;max-height:calc(100vh - 112px)}
        .ywb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .ywb-field{display:grid;gap:5px}
        .ywb-field span{color:#b9b09a;font-size:12px}
        .ywb-field input{width:100%;border:1px solid #504714;border-radius:6px;background:#111;color:#f8f0c8;padding:10px}
        .ywb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
        .ywb-row button,.ywb-file{border:1px solid #ffd000;background:#282300;color:#ffd000;border-radius:6px;padding:10px 12px;font-weight:800;cursor:pointer}
        .ywb-row button.primary{background:#ffd000;color:#111}
        .ywb-check{display:flex;gap:8px;align-items:center;color:#b9b09a}
        #ywbColumnsLog{height:180px;overflow:auto;border:1px solid #403810;background:#101010;border-radius:6px;padding:8px;font:12px/1.45 Consolas,monospace}
        .ywb-log-row.success{color:#9ef59e}.ywb-log-row.error{color:#ff9e9e}.ywb-log-row.warning{color:#ffd86b}
        @media(max-width:720px){#ywbColumnsManager{inset:12px;width:calc(100vw - 24px)}.ywb-grid{grid-template-columns:1fr}}
      </style>
      <div class="ywb-head"><div>ColumnsManager <span style="font-weight:400">${Config.VERSION}</span></div><button class="ywb-close" title="Close">X</button></div>
      <div class="ywb-body">
        <div class="ywb-grid">
          <label class="ywb-field"><span>Source account ID</span><input id="ywbColumnsSource" placeholder="1234567890 or act_1234567890"></label>
          <label class="ywb-field"><span>Target account IDs</span><input id="ywbColumnsTargets" placeholder="123,456,789"></label>
        </div>
        <div class="ywb-row">
          <button class="primary" id="ywbColumnsExport">Export presets</button>
          <label class="ywb-file">Load JSON<input id="ywbColumnsFile" type="file" accept=".json,application/json" hidden></label>
          <button id="ywbColumnsImport">Import presets</button>
          <label class="ywb-check"><input id="ywbColumnsClear" type="checkbox"> clear existing first</label>
        </div>
        <div id="ywbColumnsPackageInfo">No package loaded.</div>
        <div id="ywbColumnsLog"></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector(".ywb-close").onclick = () => root.remove();
    root.querySelector("#ywbColumnsExport").onclick = async () => {
      try { await exportColumnPresets(root.querySelector("#ywbColumnsSource").value); } catch (error) { log(error.message, "error"); }
    };
    root.querySelector("#ywbColumnsFile").onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        state.package = await readJsonFile(file);
        localStorage.setItem(Config.CACHE_KEY, JSON.stringify(state.package));
        updatePackageInfo();
        log(`Loaded package from ${file.name}.`, "success");
      } catch (error) {
        log(`Cannot load package: ${error.message}`, "error");
      }
    };
    root.querySelector("#ywbColumnsImport").onclick = async () => {
      try {
        await importColumnPresets(
          root.querySelector("#ywbColumnsTargets").value,
          state.package,
          root.querySelector("#ywbColumnsClear").checked
        );
      } catch (error) {
        log(error.message, "error");
      }
    };
    try {
      const cached = JSON.parse(localStorage.getItem(Config.CACHE_KEY) || "null");
      if (cached?.presets) state.package = cached;
    } catch (error) {
      // Ignore malformed cache.
    }
    updatePackageInfo();
    log("Ready.");
  }

  window.showColumnsManager = async () => createUi();
  window.ColumnsManager = {
    Config,
    state,
    exportColumnPresets,
    importColumnPresets,
    debug: { getAccessToken, cleanAccountId, splitAccountIds },
  };

  createUi();
})();
