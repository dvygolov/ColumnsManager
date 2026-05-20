#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const SOURCE = path.join(ROOT, "columns-manager.js");
const LOADER_SOURCE = path.join(ROOT, "columns-loader.js");
const LANDING_SCREENSHOT = path.join(ROOT, "target-current.png");
const OUT_ROOT = path.join(ROOT, "dist", "columns");
const CHUNK_SIZE = 350000;
const APP_MARK_FILE = "assets/columns-mark.svg";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitString(input, chunkSize) {
  if (chunkSize <= 0) throw new Error("chunkSize must be positive");
  const chunks = [];
  for (let index = 0; index < input.length; index += chunkSize) {
    chunks.push(input.slice(index, index + chunkSize));
  }
  return chunks;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildAppMarkSvg() {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="ColumnsManager mark">',
    '  <defs>',
    '    <linearGradient id="columns-gold" x1="0%" x2="100%" y1="0%" y2="100%">',
    '      <stop offset="0%" stop-color="#ffe16a"/>',
    '      <stop offset="55%" stop-color="#ffd000"/>',
    '      <stop offset="100%" stop-color="#ffab00"/>',
    '    </linearGradient>',
    '  </defs>',
    '  <rect x="4" y="4" width="88" height="88" rx="22" fill="#151515" stroke="url(#columns-gold)" stroke-width="6"/>',
    '  <text x="48" y="61" text-anchor="middle" font-family="Trebuchet MS, Verdana, sans-serif" font-size="34" font-weight="900" letter-spacing="-3" fill="url(#columns-gold)">RM</text>',
  '</svg>',
  ].join("\n");
}

function parseListArg(name) {
  return readArg(name, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function detectBuild(source) {
  const match = source.match(/VERSION:\s*"([^"]+)"/);
  if (!match) {
    throw new Error("Cannot detect ColumnsManager VERSION in source file.");
  }
  return match[1];
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function pruneOldBuildDirs(outRoot, currentBuild) {
  if (!fs.existsSync(outRoot)) return;
  for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "latest" || entry.name === currentBuild) continue;
    if (!/^\d{6}b\d+$/i.test(entry.name)) continue;
    fs.rmSync(path.join(outRoot, entry.name), { recursive: true, force: true });
  }
}

function buildOgHtml({ appName, build, chunk, index, total }) {
  const title = `${appName} ${build} chunk ${index + 1}/${total}`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="robots" content="noindex,nofollow" />',
    '  <meta property="og:type" content="website" />',
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(chunk)}" />`,
    `  <title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `  <pre>${escapeHtml(title)}</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildManifestHtml({ appName, build, manifestBase64 }) {
  const title = `${appName} ${build} manifest`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="robots" content="noindex,nofollow" />',
    '  <meta property="og:type" content="website" />',
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(manifestBase64)}" />`,
    `  <title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    `  <pre>${escapeHtml(title)}</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildLandingHtml({ appName, build, bookmarklet, manifestUrl, screenshotUrl, iconUrl }) {
  const title = `${appName} Loader`;
  const inlineMark = buildAppMarkSvg();
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <meta name="robots" content="noindex,nofollow" />',
    `  <meta name="description" content="${escapeHtml(appName)} bookmarklet loader for Facebook Ads Manager column preset export and import." />`,
    `  <link rel="icon" href="${escapeHtml(iconUrl)}" type="image/svg+xml" />`,
    "  <style>",
    "    :root {",
    "      --bg: #141414;",
    "      --panel: #202020;",
    "      --panel-2: #292929;",
    "      --ink: #f8f0c8;",
    "      --muted: #a5a08f;",
    "      --gold: #ffd000;",
    "      --gold-2: #ffab00;",
    "      --line: rgba(255, 208, 0, 0.34);",
    "      --soft: rgba(255, 208, 0, 0.11);",
    "    }",
    "    * { box-sizing: border-box; }",
    "    html { scroll-behavior: smooth; }",
    "    body {",
    "      margin: 0;",
    "      min-height: 100vh;",
    "      color: var(--ink);",
    "      font-family: 'Trebuchet MS', Verdana, sans-serif;",
    "      background:",
    "        radial-gradient(circle at 16% 12%, rgba(255, 208, 0, 0.28) 0 10rem, transparent 26rem),",
    "        radial-gradient(circle at 92% 18%, rgba(255, 171, 0, 0.18) 0 12rem, transparent 30rem),",
    "        linear-gradient(135deg, #101010, #1b1b1b 52%, #111);",
    "      overflow-x: hidden;",
    "    }",
    "    body::before {",
    "      content: '';",
    "      position: fixed;",
    "      inset: 0;",
    "      pointer-events: none;",
    "      opacity: 0.12;",
    "      background-image: linear-gradient(90deg, var(--gold) 1px, transparent 1px), linear-gradient(var(--gold) 1px, transparent 1px);",
    "      background-size: 44px 44px;",
    "      mask-image: linear-gradient(to bottom, black, transparent 85%);",
    "    }",
    "    a { color: inherit; }",
    "    main {",
    "      width: min(1180px, calc(100vw - 36px));",
    "      margin: 0 auto;",
    "      padding: 38px 0 72px;",
    "    }",
    "    .nav {",
    "      display: flex;",
    "      align-items: center;",
    "      justify-content: space-between;",
    "      gap: 20px;",
    "      margin-bottom: 24px;",
    "      color: var(--muted);",
    "      font-size: 13px;",
    "    }",
    "    .brand-wrap { display: grid; gap: 2px; }",
    "    .brand-line { display: inline-flex; align-items: center; gap: 12px; }",
    "    .brand-mark { width: 42px; height: 42px; display: block; flex: 0 0 auto; filter: drop-shadow(0 8px 18px rgba(255, 208, 0, 0.14)); }",
    "    .brand { color: var(--gold); font-size: 30px; font-weight: 900; letter-spacing: -0.05em; }",
    "    .byline { color: var(--muted); font-size: 13px; }",
    "    .byline a { color: var(--gold); text-decoration: none; }",
    "    .byline a:hover, .nav-links a:hover { text-decoration: underline; }",
    "    .nav-links { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }",
    "    .nav-links a { color: var(--muted); text-decoration: none; }",
    "    .tg-link {",
    "      display: inline-grid;",
    "      place-items: center;",
    "      width: 32px;",
    "      height: 32px;",
    "      border: 1px solid var(--line);",
    "      border-radius: 999px;",
    "      background: rgba(255, 208, 0, 0.08);",
    "      color: var(--gold);",
    "    }",
    "    .tg-link svg { width: 16px; height: 16px; display: block; }",
    "    .hero {",
    "      width: 100%;",
    "      border: 2px solid var(--gold);",
    "      border-radius: 22px;",
    "      background: linear-gradient(145deg, rgba(32, 32, 32, 0.98), rgba(18, 18, 18, 0.96));",
    "      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.44), 0 0 0 8px rgba(255, 208, 0, 0.05);",
    "      padding: clamp(24px, 4vw, 54px);",
    "      position: relative;",
    "      overflow: hidden;",
    "    }",
    "    .hero::after {",
    "      content: '';",
    "      position: absolute;",
    "      right: -80px;",
    "      top: -80px;",
    "      width: 220px;",
    "      height: 220px;",
    "      border-radius: 999px;",
    "      background: var(--soft);",
    "      border: 1px solid var(--line);",
    "    }",
    "    .eyebrow {",
    "      display: inline-flex;",
    "      gap: 10px;",
    "      align-items: center;",
    "      padding: 8px 12px;",
    "      border: 1px solid var(--gold);",
    "      border-radius: 999px;",
    "      background: rgba(255, 208, 0, 0.08);",
    "      color: var(--gold);",
    "      font: 800 12px/1.2 Verdana, sans-serif;",
    "      letter-spacing: 0.12em;",
    "      text-transform: uppercase;",
    "    }",
    "    .hero-grid {",
    "      display: grid;",
    "      grid-template-columns: minmax(0, 0.9fr) minmax(420px, 1.1fr);",
    "      gap: clamp(28px, 5vw, 64px);",
    "      align-items: center;",
    "      position: relative;",
    "      z-index: 1;",
    "    }",
    "    h1 {",
    "      max-width: 680px;",
    "      margin: 26px 0 16px;",
    "      color: #fff6c8;",
    "      font-size: clamp(50px, 7vw, 102px);",
    "      line-height: 0.88;",
    "      letter-spacing: -0.08em;",
    "    }",
    "    .lead {",
    "      max-width: 660px;",
    "      margin: 0;",
    "      color: #c9c1a5;",
    "      font: 18px/1.55 Verdana, sans-serif;",
    "    }",
    "    .shot {",
    "      margin: 0;",
    "      border: 1px solid var(--line);",
    "      border-radius: 18px;",
    "      background: #0f0f0f;",
    "      padding: 10px;",
    "      box-shadow: 18px 18px 0 rgba(255, 208, 0, 0.08);",
    "      transform: rotate(1deg);",
    "    }",
    "    .shot img {",
    "      display: block;",
    "      width: 100%;",
    "      border-radius: 10px;",
    "      border: 1px solid rgba(255, 255, 255, 0.08);",
    "    }",
    "    .install {",
    "      display: grid;",
    "      grid-template-columns: 1fr;",
    "      gap: 18px;",
    "      align-items: start;",
    "      margin-top: 34px;",
    "      max-width: 560px;",
    "    }",
    "    .bookmarklet {",
    "      display: inline-flex;",
    "      align-items: center;",
    "      justify-content: center;",
    "      min-height: 74px;",
    "      padding: 0 28px;",
    "      border: 3px solid #050505;",
    "      border-radius: 14px;",
    "      color: #111;",
    "      background: linear-gradient(135deg, var(--gold), var(--gold-2));",
    "      box-shadow: 8px 8px 0 #050505;",
    "      text-decoration: none;",
    "      font: 900 24px/1 Verdana, sans-serif;",
    "      cursor: pointer;",
    "      user-select: none;",
    "      transform: rotate(-1.2deg);",
    "      transition: transform 160ms ease, box-shadow 160ms ease;",
    "    }",
    "    .bookmarklet:hover { transform: rotate(0deg) translate(-2px, -2px); box-shadow: 11px 11px 0 #050505; }",
    "    .install .bookmarklet { width: min(320px, 100%); }",
    "    .hint {",
    "      margin: 0;",
    "      color: var(--muted);",
    "      font: 15px/1.6 Verdana, sans-serif;",
    "    }",
    "    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }",
    "    button:not(.bookmarklet) {",
      "      border: 1px solid var(--line);",
      "      border-radius: 999px;",
      "      background: rgba(255, 208, 0, 0.08);",
      "      color: var(--gold);",
    "      padding: 12px 16px;",
    "      font: 700 14px/1 Verdana, sans-serif;",
    "      cursor: pointer;",
    "    }",
    "    code {",
    "      display: inline-block;",
    "      margin-top: 22px;",
    "      color: #4f472f;",
    "      font: 13px/1.4 Consolas, monospace;",
    "      word-break: break-word;",
    "    }",
    "    .section { margin-top: 28px; }",
    "    .cards {",
    "      display: grid;",
    "      grid-template-columns: repeat(3, minmax(0, 1fr));",
    "      gap: 14px;",
    "    }",
    "    .card {",
    "      min-height: 154px;",
    "      border: 1px solid rgba(255, 208, 0, 0.25);",
    "      border-radius: 18px;",
    "      background: rgba(32, 32, 32, 0.82);",
    "      padding: 20px;",
    "    }",
    "    .card strong { display: block; color: var(--gold); font-size: 18px; margin-bottom: 10px; }",
    "    .card p { margin: 0; color: #c9c1a5; font: 14px/1.55 Verdana, sans-serif; }",
    "    .steps {",
    "      display: grid;",
    "      grid-template-columns: repeat(3, 1fr);",
    "      gap: 1px;",
    "      overflow: hidden;",
    "      border: 1px solid rgba(255, 208, 0, 0.25);",
    "      border-radius: 18px;",
    "      background: rgba(255, 208, 0, 0.25);",
    "    }",
    "    .step { background: #1d1d1d; padding: 18px; color: #d7cfb3; font: 14px/1.55 Verdana, sans-serif; }",
    "    .step b { color: var(--gold); display: block; margin-bottom: 8px; }",
    "    .footer { margin-top: 22px; color: var(--muted); font: 13px/1.5 Verdana, sans-serif; }",
    "    @media (max-width: 760px) {",
    "      .hero-grid { grid-template-columns: 1fr; }",
    "      .cards, .steps { grid-template-columns: 1fr; }",
    "      .install { grid-template-columns: 1fr; }",
    "      .bookmarklet { width: 100%; }",
    "      .shot { transform: none; }",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <nav class=\"nav\">",
    "      <div class=\"brand-wrap\">",
    `        <div class="brand-line"><span class="brand-mark">${inlineMark}</span><div class="brand">${escapeHtml(appName)}</div></div>`,
    "        <div class=\"byline\">by <a href=\"https://yellowweb.top\" target=\"_blank\" rel=\"noopener\">Yellow Web</a></div>",
    "      </div>",
    "      <div class=\"nav-links\"><a href=\"#install\">Install</a><a href=\"#features\">Features</a><a href=\"#how\">How it works</a><a class=\"tg-link\" href=\"https://t.me/yellow_web\" target=\"_blank\" rel=\"noopener\" aria-label=\"Yellow Web Telegram\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M21.8 4.6 18.6 19.7c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.2 1.1 11.7c-1.1-.3-1.1-1.1.2-1.6L20.5 2.7c.9-.3 1.7.2 1.3 1.9Z\"/></svg></a></div>",
    "    </nav>",
    "    <section class=\"hero\" id=\"install\">",
    "      <div class=\"hero-grid\">",
    "        <div>",
    `          <div class="eyebrow">${escapeHtml(appName)} build ${escapeHtml(build)}</div>`,
    "          <h1>Column presets migration without leaving Ads Manager.</h1>",
    "          <p class=\"lead\">ColumnsManager is a browser-side tool for exporting Facebook Ads Manager column presets from one ad account and importing them into one or many other ad accounts.</p>",
    "          <div class=\"install\">",
    `            <a class="bookmarklet" id="bookmarkletLink" href="${escapeHtml(bookmarklet)}">Columns</a>`,
    "            <p class=\"hint\">Drag the yellow button to your bookmarks bar. If dragging is awkward in your browser, use the copy button below and paste the loader into a bookmark URL manually.</p>",
    "          </div>",
    "          <div class=\"actions\">",
    `            <button id="copyBookmarklet" type="button" data-bookmarklet="${escapeHtml(bookmarklet)}">Copy to clipboard</button>`,
    "            <button id=\"copyUrl\" type=\"button\">Copy page URL</button>",
    "          </div>",
    `          <code>manifest URL: ${escapeHtml(manifestUrl || "not configured")}</code>`,
    "        </div>",
    "        <figure class=\"shot\">",
    `          <img src="${escapeHtml(screenshotUrl)}" alt="ColumnsManager running inside Facebook Ads Manager" />`,
    "        </figure>",
    "      </div>",
    "    </section>",
    "    <section class=\"section cards\" id=\"features\">",
    "      <div class=\"card\"><strong>Export</strong><p>Save column preset names and column lists from a selected ad account to a reusable JSON package.</p></div>",
    "      <div class=\"card\"><strong>Import</strong><p>Upload a saved presets JSON into one or many accounts through Ads Manager Graph requests.</p></div>",
    "      <div class=\"card\"><strong>Clean first</strong><p>Optionally delete existing presets before import when an account needs a clean set instead of duplicates.</p></div>",
    "      <div class=\"card\"><strong>Browser-side</strong><p>Runs inside the current Facebook session and does not require a separate backend.</p></div>",
    "      <div class=\"card\"><strong>Visible log</strong><p>Keeps every account and preset operation visible in the in-page panel.</p></div>",
    "      <div class=\"card\"><strong>JSON package</strong><p>Exports a readable package that can be reused, archived, and loaded back later.</p></div>",
    "      <div class=\"card\"><strong>Versioned loader</strong><p>The bookmarklet carries build metadata, verifies payload SHA-256, and caches the latest payload locally.</p></div>",
    "    </section>",
    "    <section class=\"section steps\" id=\"how\">",
    "      <div class=\"step\"><b>1. Install</b>Drag the Columns button to your bookmarks bar, or use Copy to clipboard and paste the loader into a bookmark URL.</div>",
    "      <div class=\"step\"><b>2. Open Ads Manager</b>Use the Facebook profile and ad account you want to work with, then click the bookmark.</div>",
    "      <div class=\"step\"><b>3. Manage columns</b>The loader checks the versioned payload, uses cache when current, and opens the ColumnsManager panel in-page.</div>",
    "    </section>",
    "    <p class=\"footer\">by <a href=\"https://yellowweb.top\" target=\"_blank\" rel=\"noopener\">Yellow Web</a> · <a href=\"https://t.me/yellow_web\" target=\"_blank\" rel=\"noopener\">Telegram</a>. The tool runs in your current Facebook Ads Manager session. No external direct payload fetch is attempted from Ads Manager; runtime loading uses Facebook OG metadata through Ads Manager Graph.</p>",
    "  </main>",
    "  <script>",
    "    window.setStatus = function(message) {",
    "      var hint = document.querySelector('.hint');",
    "      if (hint) hint.textContent = message;",
    "    };",
    "    document.getElementById('copyBookmarklet').addEventListener('click', async function() {",
    "      try {",
    "        await navigator.clipboard.writeText(document.getElementById('copyBookmarklet').dataset.bookmarklet || '');",
    "        window.setStatus('Bookmarklet copied. Create a new bookmark and paste it into the URL field.');",
    "      } catch (error) {",
    "        window.setStatus('Copy failed. Try again from a secure browser tab with clipboard access enabled.');",
    "      }",
    "    });",
    "    document.getElementById('copyUrl').addEventListener('click', async function() {",
    "      await navigator.clipboard.writeText(location.href);",
    "      window.setStatus('Page URL copied.');",
    "    });",
    "  </script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildBookmarkletLoader(loaderManifest) {
  const configJson = JSON.stringify({
    a: loaderManifest.app,
    v: loaderManifest.version,
    s: loaderManifest.payload.sha256,
    b: loaderManifest.payload.byteLength,
    u: loaderManifest.chunks.map((chunk) => chunk.url),
    k: "columnsmanager.loader.cache.v1",
  });
  return `(async c=>{const G="__ColumnsManagerLoader",D=document,A="ColumnsManager";let box;const show=(m,e)=>{box=box||D.body.appendChild(Object.assign(D.createElement("div"),{id:"ywbColumnsLoaderStatus"}));box.textContent=m;box.style.cssText="position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#fff200;color:#111;border:2px solid #111;border-radius:10px;padding:12px 14px;font:700 13px Verdana,sans-serif;box-shadow:0 8px 24px #0005;max-width:360px";if(e)box.style.background="#ffd6d6"};try{if(!/(^|\\.)facebook\\.com$/.test(location.hostname)){location.href="https://adsmanager.facebook.com/";return}if(window[G]?.loading)return show(A+" is already loading...");window[G]={loading:true,build:c.v,startedAt:Date.now(),source:""};show(A+" loading "+c.v+"...");const dec=x=>new TextDecoder().decode(Uint8Array.from(atob(String(x||"").replace(/\\s+/g,"")),q=>q.charCodeAt(0))),tok=()=>{if(window.__accessToken)return window.__accessToken;for(const n of performance.getEntriesByType("resource").map(x=>x.name||""))if(n.includes("adsmanager-graph.facebook.com")&&n.includes("access_token="))try{const t=new URL(n).searchParams.get("access_token");if(t)return t}catch(e){}return""},json=async u=>{const r=await fetch(u,{credentials:"include",cache:"no-store"}),t=await r.text();if(!r.ok)throw Error(r.status+" "+t.slice(0,160));return JSON.parse(t.replace(/^for\\s*\\(;;\\);\\s*/,""))},sha=async t=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t)))).map(b=>b.toString(16).padStart(2,"0")).join(""),run=s=>new Promise((ok,fail)=>{const u=URL.createObjectURL(new Blob([s,"\\n//# sourceURL=columnsmanager://"+c.v+"/payload.js"],{type:"application/javascript"})),j=D.createElement("script");j.src=u;j.onload=()=>{setTimeout(()=>URL.revokeObjectURL(u),1e4);j.remove();ok()};j.onerror=()=>{URL.revokeObjectURL(u);j.remove();fail(Error("Payload injection failed"))};(D.head||D.documentElement).appendChild(j)});let cache;try{cache=JSON.parse(localStorage.getItem(c.k)||"null")}catch(e){}let src=cache?.version===c.v&&cache.source;if(src)window[G].source="cache";else{const t=tok();if(!t)throw Error("Open Ads Manager and wait until it fully loads, then click Columns again.");const enc=encodeURIComponent,ids=await Promise.all(c.u.map(async u=>(await json("https://graph.facebook.com/?id="+enc(u)+"&fields=og_object&access_token="+enc(t)))?.og_object?.id));src=dec((await Promise.all(ids.map(id=>json("https://adsmanager-graph.facebook.com/v23.0/"+enc(id)+"?fields=description&access_token="+enc(t))))).map(o=>o.description||"").join(""));const h=await sha(src);if(c.s&&h!==c.s)throw Error("Payload checksum mismatch for "+c.v);localStorage.setItem(c.k,JSON.stringify({app:A,version:c.v,sha256:h,byteLength:src.length,source:src,savedAt:new Date().toISOString()}));window[G].source="remote"}if(window.__ColumnsManagerPayloadBuild&&window.__ColumnsManagerPayloadBuild!==c.v)throw Error("ColumnsManager "+window.__ColumnsManagerPayloadBuild+" is already loaded. Reload Ads Manager to update to "+c.v+".");if(window.__ColumnsManagerPayloadBuild===c.v&&typeof window.showColumnsManager=="function"){await window.showColumnsManager();window[G].source="existing"}else await run(src);window[G].loading=false;window[G].finishedAt=Date.now();show(A+" loaded "+c.v+" from "+window[G].source);setTimeout(()=>box?.remove(),2500)}catch(e){if(window[G]){window[G].loading=false;window[G].error=String(e?.message||e)}console.error("["+A+" loader] Failed.",e);show(A+" failed: "+(e?.message||e),true);alert(A+" failed: "+(e?.message||e))}})(${configJson})`;
}

function main() {
  const sourcePath = path.resolve(readArg("source", SOURCE));
  const outRoot = path.resolve(readArg("out", OUT_ROOT));
  const distRoot = path.dirname(outRoot);
  const baseUrl = readArg("base-url", "");
  const appName = readArg("app", "ColumnsManager");
  const chunkOgObjectIds = parseListArg("chunk-og-object-ids");
  const source = fs.readFileSync(sourcePath, "utf8");
  const build = readArg("build", detectBuild(source));
  const buildDir = path.join(outRoot, build);
  const latestDir = path.join(outRoot, "latest");
  const ogDir = path.join(buildDir, "og");
  const latestOgDir = path.join(latestDir, "og");
  const base64 = Buffer.from(source, "utf8").toString("base64");
  const chunks = splitString(base64, CHUNK_SIZE);
  const generatedAt = new Date().toISOString();

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.rmSync(latestDir, { recursive: true, force: true });
  writeFile(path.join(buildDir, "payload.js"), source);
  writeFile(path.join(latestDir, "payload.js"), source);
  chunks.forEach((chunk, index) => {
    const chunkFileName = `chunk-${String(index + 1).padStart(3, "0")}.html`;
    const html = buildOgHtml({
      appName,
      build,
      chunk,
      index,
      total: chunks.length,
    });
    writeFile(path.join(ogDir, chunkFileName), html);
    writeFile(path.join(latestOgDir, chunkFileName), html);
  });

  const publicUrl = (relativePath) => {
    if (!baseUrl) return "";
    return `${baseUrl.replace(/\/+$/, "")}/${relativePath.replace(/\\/g, "/")}`;
  };
  const manifest = {
    app: appName,
    build,
    version: build,
    generatedAt,
    payload: {
      encoding: "base64",
      sha256: sha256Hex(source),
      byteLength: Buffer.byteLength(source, "utf8"),
    },
    chunks: chunks.map((chunk, index) => ({
      index: index + 1,
      file: `og/chunk-${String(index + 1).padStart(3, "0")}.html`,
      url: publicUrl(`${build}/og/chunk-${String(index + 1).padStart(3, "0")}.html`),
      latestUrl: publicUrl(`latest/og/chunk-${String(index + 1).padStart(3, "0")}.html`),
      ogObjectId: chunkOgObjectIds[index] || "",
      base64Length: chunk.length,
      base64Sha256: sha256Hex(chunk),
    })),
  };
  const manifestJson = JSON.stringify(manifest);
  const manifestBase64 = Buffer.from(manifestJson, "utf8").toString("base64");
  const manifestHtml = buildManifestHtml({ appName, build, manifestBase64 });
  writeFile(path.join(buildDir, "manifest.html"), manifestHtml);
  writeFile(path.join(latestDir, "manifest.html"), manifestHtml);

  const packageInfo = {
    ...manifest,
    source: path.relative(ROOT, sourcePath).replace(/\\/g, "/"),
    chunkSize: CHUNK_SIZE,
    payloadFile: "payload.js",
    payloadUrl: publicUrl(`${build}/payload.js`),
    latestPayloadUrl: publicUrl("latest/payload.js"),
    manifestFile: "manifest.html",
    manifestUrl: publicUrl(`${build}/manifest.html`),
    latestManifestUrl: publicUrl("latest/manifest.html"),
  };
  writeFile(path.join(buildDir, "package-info.json"), `${JSON.stringify(packageInfo, null, 2)}\n`);
  const loaderManifest = {
    app: appName,
    build,
    version: build,
    generatedAt,
    payload: manifest.payload,
    chunks: manifest.chunks.map((chunk) => ({
      index: chunk.index,
      latestUrl: chunk.url,
      url: chunk.url,
      ogObjectId: chunk.ogObjectId,
    })),
  };
  const loaderSource = buildBookmarkletLoader(loaderManifest);
  const bookmarklet = `javascript:${encodeURIComponent(loaderSource)}`;
  const screenshotUrl = fs.existsSync(LANDING_SCREENSHOT) ? "assets/columns-ui.png" : APP_MARK_FILE;
  const iconUrl = APP_MARK_FILE;
  if (fs.existsSync(LANDING_SCREENSHOT)) {
    fs.mkdirSync(path.join(distRoot, "assets"), { recursive: true });
    fs.copyFileSync(LANDING_SCREENSHOT, path.join(distRoot, screenshotUrl));
  }
  writeFile(path.join(distRoot, APP_MARK_FILE), `${buildAppMarkSvg()}\n`);
  writeFile(path.join(distRoot, "index.html"), buildLandingHtml({
    appName,
    build,
    bookmarklet,
    manifestUrl: publicUrl("latest/manifest.html"),
    screenshotUrl,
    iconUrl,
  }));
  writeFile(path.join(distRoot, "_headers"), [
    "/",
    "  Cache-Control: no-store",
    "",
    "/*",
    "  Cache-Control: no-store",
    "",
    "/columns/*",
    "  Access-Control-Allow-Origin: *",
    "  Cache-Control: no-store",
    "",
  ].join("\n"));
  writeFile(path.join(distRoot, "_redirects"), [
    "/ /index.html 200",
    "/* /index.html 200",
    "",
  ].join("\n"));
  pruneOldBuildDirs(outRoot, build);

  console.log(`ColumnsManager ${build} packaged.`);
  console.log(`Payload: ${path.join(buildDir, "payload.js")}`);
  console.log(`Latest payload: ${path.join(latestDir, "payload.js")}`);
  console.log(`OG chunks: ${chunks.length}`);
  if (baseUrl) {
    console.log(`Manifest latest URL: ${packageInfo.latestManifestUrl}`);
    console.log("Scrape the build-specific OG chunk URLs in Meta Sharing Debugger after deploy:");
    for (const chunk of packageInfo.chunks) {
      console.log(`- ${chunk.url}`);
    }
  }
}

main();
