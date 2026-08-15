import { EditorView, keymap } from "https://esm.sh/codemirror";
import { basicSetup } from "https://esm.sh/codemirror";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript";
import { html } from "https://esm.sh/@codemirror/lang-html";
import { css } from "https://esm.sh/@codemirror/lang-css";

(function(){
  'use strict';
  console.log("Wrenna Engine Starting v9 (CodeMirror 6 + Resizable + Animations)...");

  const closeScriptTag = '</script>';
  const scriptSrcRegex = /<script((?:(?!type=)[^>])*)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi;
  const moduleScriptRegex = /<script\b[^>]*type=["']module["'][^>]*>\s*<\/script>/i;

  const editorHost = document.getElementById('editor-host');
  const runBtn = document.getElementById('run-btn');
  const buildState = document.getElementById('build-state');
  const editorStatus = document.getElementById('editor-status');
  const charCount = document.getElementById('char-count');
  const preview = document.getElementById('preview');
  const previewDevice = document.getElementById('preview-device');
  const previewEmpty = document.getElementById('preview-empty');
  const previewUrl = document.getElementById('preview-url');
  const previewFrame = document.getElementById('preview-frame');
  const projectName = document.getElementById('project-name');
  const projectState = document.getElementById('project-state');
  const toastsEl = document.getElementById('toasts');
  const sponsorBanner = document.getElementById('sponsor-banner');

  const filetree = document.getElementById('filetree');
  const treeRoot = document.getElementById('tree-root');
  const treeSearch = document.getElementById('tree-search');
  const treeCloseBtn = document.getElementById('tree-close-btn');
  const newFileBtn = document.getElementById('new-file-btn');
  const newFolderBtn = document.getElementById('new-folder-btn');
  function getActiveIndicator(){ return document.getElementById('active-indicator'); }
  const editorTabs = document.getElementById('editor-tabs');
  const workspace = document.getElementById('workspace');
  const resizer = document.getElementById('resizer');

  const LS = { draft: 'wrenna_v9_draft', runs: 'wrenna_v9_run_count', fuel: 'wrenna_v9_fuel_passes', pro: 'wrenna_v9_pro', ghToken: 'wrenna_v9_gh_token', aiUses: 'wrenna_v9_ai_uses' };
  let currentFilePath = null;
  let editedFiles = new Map();

  function toast(msg, kind){
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = msg;
    toastsEl.appendChild(el);
    setTimeout(()=>{ el.classList.add('exit'); setTimeout(()=> el.remove(), 240); }, 2600);
  }

  // === Drag-to-Resize Logic ===
  let isResizing = false;
  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const bounds = workspace.getBoundingClientRect();
    let percentage = ((e.clientX - bounds.left) / bounds.width) * 100;
    percentage = Math.max(20, Math.min(80, percentage)); // Clamp 20% to 80%
    workspace.style.gridTemplateColumns = `${percentage}% 4px ${100 - percentage}%`;
    fitDevice();
  });
  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  function fitDevice() {
    if (!previewFrame || !previewDevice) return;
    const frameW = previewDevice.clientWidth;
    const frameH = previewDevice.clientHeight;
    if (frameW <= 0 || frameH <= 0) return;

    let targetW = 1440, targetH = 900; 
    if (previewDevice.classList.contains('mobile')) { targetW = 412; targetH = 891; }
    if (previewDevice.classList.contains('tablet')) { targetW = 1024; targetH = 1366; }

    const scale = Math.min(frameW / targetW, frameH / targetH);
    const iframe = preview.querySelector('iframe');
    if (iframe) {
      iframe.style.width = targetW + 'px';
      iframe.style.height = targetH + 'px';
      iframe.style.transform = `scale(${scale})`;
      iframe.style.transformOrigin = 'top left';
    }
  }
  window.addEventListener('resize', fitDevice);

  function openModal(id){ const el = document.getElementById(id); if(el) el.classList.add('open'); }
  function closeModal(id){ const el = document.getElementById(id); if(el) el.classList.remove('open'); }
  document.querySelectorAll('[data-modal-close]').forEach(btn=> btn.addEventListener('click', ()=> { const ov = btn.closest('.modal-overlay'); if(ov) ov.classList.remove('open'); }));
  document.querySelectorAll('.modal-overlay').forEach(ov=> ov.addEventListener('click', e=>{ if (e.target === ov) ov.classList.remove('open'); }));
  document.addEventListener('keydown', e=>{ if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(ov=> ov.classList.remove('open')); });

  document.getElementById('gh-import-btn').addEventListener('click', ()=> openModal('modal-github'));
  document.getElementById('share-btn').addEventListener('click', openShareModal);
  document.getElementById('mobile-share-btn').addEventListener('click', openShareModal);
  document.getElementById('pro-btn').addEventListener('click', ()=> openModal('modal-pro'));

  document.querySelectorAll('.focus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.focus;
      const isFocused = workspace.classList.contains(`focus-${target}`);
      workspace.classList.remove('focus-editor', 'focus-preview');
      if (!isFocused) workspace.classList.add(`focus-${target}`);
      setTimeout(fitDevice, 50);
    });
  });

  document.querySelectorAll('.mtab-btn').forEach(btn=>{
    if (btn.id === 'mobile-share-btn') return;
    btn.addEventListener('click', ()=>{
      const panel = btn.dataset.panel;
      if (panel === 'files' && !workspace.classList.contains('has-tree')){ openModal('modal-github'); return; }
      document.querySelectorAll('.mtab-btn').forEach(b=> b.classList.remove('active'));
      btn.classList.add('active');
      workspace.dataset.panel = panel;
      setTimeout(fitDevice, 50); 
    });
  });

  const PRO_CHECKOUT_URLS = { annual: '', onetime: '' };
  let selectedPlan = 'annual';
  function selectPlan(plan){ selectedPlan = plan; document.querySelectorAll('.pro-plan').forEach(el=> el.classList.toggle('selected', el.dataset.plan === plan)); }
  document.querySelectorAll('.pro-plan').forEach(el=> el.addEventListener('click', ()=> selectPlan(el.dataset.plan)));
  selectPlan('annual');
  document.getElementById('pro-checkout-btn').addEventListener('click', ()=>{
    const url = PRO_CHECKOUT_URLS[selectedPlan];
    if (!url){ toast('Checkout isn\'t configured yet for this plan — placeholder'); return; }
    window.location.href = url;
  });

  // === CodeMirror 6 Setup ===
  const wrennaTheme = EditorView.theme({
    "&": { color: "var(--text-on-ink)", backgroundColor: "transparent" },
    ".cm-content": { caretColor: "var(--wren-soft)" },
    ".cm-cursor": { borderLeftColor: "var(--wren-soft)" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "rgba(181, 74, 38, 0.35)" },
    ".tok-keyword": { color: "var(--wren-soft)" },
    ".tok-string": { color: "#c5b88a" },
    ".tok-comment": { color: "var(--text-mute-ink)", fontStyle: "italic" },
    ".tok-function": { color: "#d8c5a0" }
  });

  const getEditorValue = () => editor.state.doc.toString();
  const setEditorValue = (val) => {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: val || '' } });
  };

  const editor = new EditorView({
    doc: localStorage.getItem(LS.draft) || '',
    extensions: [
      basicSetup,
      javascript({ jsx: true, typescript: true }),
      html(),
      css(),
      wrennaTheme,
      EditorView.lineWrapping,
      keymap.of([{
        key: "Mod-Enter",
        preventDefault: true,
        run: () => { attemptRun(); return true; }
      }]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          charCount.textContent = getEditorValue().length.toLocaleString() + ' chars';
          clearTimeout(editorHost._draftTimer);
          editorHost._draftTimer = setTimeout(()=> localStorage.setItem(LS.draft, getEditorValue()), 500);
          
          if (currentTreeData && currentFilePath){ 
            editedFiles.set(currentFilePath, getEditorValue()); 
            markDirty(currentFilePath); 
            setUnsaved(true); 
          } else { 
            setUnsaved(true); 
          }
          
          clearTimeout(editorHost._liveTimer);
          editorHost._liveTimer = setTimeout(livePreviewRefresh, 300);
        }
      })
    ],
    parent: editorHost
  });
  
  charCount.textContent = getEditorValue().length.toLocaleString() + ' chars';

  // === Wrenna AI Logic ===
  const aiBtn = document.getElementById('open-ai-btn');
  const aiPromptInput = document.getElementById('ai-prompt-input');
  const aiResponseArea = document.getElementById('ai-response-area');
  const aiGenerateBtn = document.getElementById('ai-generate-btn');
  const aiApplyBtn = document.getElementById('ai-apply-btn');
  let lastAiResponse = '';
  let isPro = localStorage.getItem(LS.pro) === 'true';
  if (isPro) sponsorBanner.style.display = 'none';

  aiBtn.addEventListener('click', () => {
    if (!getEditorValue().trim()) { toast('Write some code first!'); return; }
    openModal('modal-ai');
  });

  aiGenerateBtn.addEventListener('click', async () => {
    const prompt = aiPromptInput.value.trim();
    if (!prompt) { toast('Enter a prompt for the AI.'); return; }
    
    let usesToday = parseInt(localStorage.getItem(LS.aiUses) || '0', 10);
    if (!isPro && usesToday >= 10) {
      toast('Daily AI limit reached (10/10). Upgrade to Pro for unlimited!', 'err');
      return;
    }

    aiResponseArea.textContent = "Thinking...";
    aiGenerateBtn.disabled = true;
    aiApplyBtn.disabled = true;

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, code: getEditorValue() })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'AI request failed');
      
      lastAiResponse = data.response.trim();
      aiResponseArea.textContent = lastAiResponse;
      aiApplyBtn.disabled = false;

      if (!isPro) {
        localStorage.setItem(LS.aiUses, usesToday + 1);
      }
    } catch (e) {
      aiResponseArea.textContent = "Error: " + e.message;
      toast('AI Error: ' + e.message, 'err');
    } finally {
      aiGenerateBtn.disabled = false;
    }
  });

  aiApplyBtn.addEventListener('click', () => {
    if (!lastAiResponse) return;
    
    const start = editor.state.selection.main.from;
    const end = editor.state.selection.main.to;
    
    editor.dispatch({ changes: { from: start, to: end, insert: '\n' + lastAiResponse + '\n' } });
    
    closeModal('modal-ai');
    toast('AI code applied!', 'ok');
  });

  function buildDoc(code){
    const trimmed = code.trim();
    if (/^<!DOCTYPE|<html/i.test(trimmed)) return code;
    if (/<[a-z][\s\S]*>/i.test(trimmed)) return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${code}</body></html>`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;padding:16px;color:#222}</style></head><body><script>${code}${closeScriptTag}</body></html>`;
  }

  async function renderPreview(){
    if (!getEditorValue().trim() && !currentTreeData){ previewEmpty.style.display = 'grid'; previewDevice.style.display = 'none'; previewUrl.textContent = 'preview'; return; }
    if (currentTreeData){
      const finalDoc = await rebuildProject(currentTreeData.fileSource, currentTreeData.filePaths);
      preview.srcdoc = finalDoc; previewEmpty.style.display = 'none'; previewDevice.style.display = 'flex'; fitDevice(); previewUrl.textContent = currentTreeData.fileSource.label; return;
    }
    previewEmpty.style.display = 'none'; previewDevice.style.display = 'flex'; preview.srcdoc = buildDoc(getEditorValue()); fitDevice(); previewUrl.textContent = 'localhost:7331';
  }

  let runCount = parseInt(localStorage.getItem(LS.runs) || '0', 10);
  let fuelPasses = parseInt(localStorage.getItem(LS.fuel) || '0', 10);

  function shouldGate(){
    if (isPro) return false;
    const n = runCount + 1;
    if (n === 1) return false;
    if (nextGateAt === null) nextGateAt = 5 + Math.floor(Math.random() * 4);
    const wouldGate = n >= nextGateAt;
    if (wouldGate && fuelPasses > 0){ fuelPasses--; localStorage.setItem(LS.fuel, fuelPasses); toast('Used a free run pass (' + fuelPasses + ' left)'); nextGateAt = n + 5 + Math.floor(Math.random() * 4); return false; }
    if (wouldGate) nextGateAt = n + 5 + Math.floor(Math.random() * 4);
    return wouldGate;
  }
  let nextGateAt = null;

  function attemptRun(){ if (!getEditorValue().trim() && !currentTreeData){ toast('Nothing to run yet — write or drop some code first'); return; } if (shouldGate()) openGate(); else doRun(); }
  function doRun(){ editorStatus.classList.add('building'); buildState.textContent = 'bundling…'; renderPreview().catch(e=>{ console.error(e); toast('Run failed: ' + e.message, 'err'); }).finally(()=>{ editorStatus.classList.remove('building'); buildState.textContent = 'built · ready'; runCount++; localStorage.setItem(LS.runs, runCount); }); }
  runBtn.addEventListener('click', attemptRun);

  document.getElementById('live-toggle-btn').addEventListener('click', function(){ liveEnabled = !liveEnabled; this.classList.toggle('is-off', !liveEnabled); this.setAttribute('aria-pressed', String(liveEnabled)); toast(liveEnabled ? 'Live preview on' : 'Live preview off — use Run to update manually'); });
  let liveEnabled = true; let liveGeneration = 0;
  async function livePreviewRefresh(){
    if (!liveEnabled) return; if (!getEditorValue().trim() && !currentTreeData) return;
    const myGen = ++liveGeneration; buildState.textContent = 'live · updating…';
    try { await renderPreview(); } catch(e){ if (myGen === liveGeneration) buildState.textContent = 'live · error (see console)'; console.error(e); return; }
    if (myGen === liveGeneration) buildState.textContent = 'live · up to date';
  }

  const gateBackdrop = document.getElementById('modal-adgate');
  const gateSkipBtn = document.getElementById('gate-skip-btn');
  const gateVideoBtn = document.getElementById('gate-video-btn');
  function openGate(){ openModal('modal-adgate'); gateSkipBtn.style.visibility = 'hidden'; setTimeout(()=> gateSkipBtn.style.visibility = 'visible', 2000); }
  gateSkipBtn.addEventListener('click', ()=>{ closeModal('modal-adgate'); doRun(); });
  gateVideoBtn.addEventListener('click', ()=>{ toast('Rewarded video would play here (SDK not wired up yet)'); fuelPasses += 10; localStorage.setItem(LS.fuel, fuelPasses); toast('+10 free runs added', 'ok'); closeModal('modal-adgate'); doRun(); });

  function setViewport(mode, btn){
    document.querySelectorAll('[data-viewport]').forEach(b=> b.classList.remove('active'));
    btn.classList.add('active');
    previewDevice.classList.add('is-switching');
    setTimeout(() => {
      previewDevice.classList.remove('mobile', 'tablet', 'desktop');
      previewDevice.classList.add(mode);
      previewDevice.classList.remove('is-switching');
      fitDevice();
    }, 200);
  }
  document.getElementById('viewport-desktop-btn').addEventListener('click', function(){ setViewport('desktop', this); });
  document.getElementById('viewport-tablet-btn').addEventListener('click', function(){ setViewport('tablet', this); });
  document.getElementById('viewport-mobile-btn').addEventListener('click', function(){ setViewport('mobile', this); });

  document.getElementById('banner-watch-btn').addEventListener('click', ()=> openModal('modal-adgate'));

  function openShareModal(){
    if (!getEditorValue().trim()){ toast('Write or drop some code first'); return; }
    const compressed = LZString.compressToEncodedURIComponent(getEditorValue());
    const url = window.location.origin + window.location.pathname + '#code=' + compressed;
    document.getElementById('share-input').value = url;
    document.getElementById('share-meta').textContent = url.length > 8000 ? 'large snippet — Gist fallback not wired up yet' : 'ready to copy';
    history.replaceState(null, '', '#code=' + compressed);
    openModal('modal-share');
  }
  document.getElementById('copy-btn').addEventListener('click', function(){
    const input = document.getElementById('share-input');
    navigator.clipboard.writeText(input.value).then(()=>{ this.textContent = 'Copied'; this.classList.add('copied'); toast('Share link copied', 'ok'); setTimeout(()=>{ this.textContent = 'Copy'; this.classList.remove('copied'); }, 1600); }).catch(()=> toast('Could not copy automatically', 'err'));
  });
  document.getElementById('open-full-preview-btn').addEventListener('click', ()=>{
    if (previewEmpty.style.display !== 'none' || !preview.srcdoc){ toast('Nothing to preview yet — hit Run first'); return; }
    const compressed = LZString.compressToEncodedURIComponent(preview.srcdoc);
    const url = window.location.origin + window.location.pathname + '#doc=' + compressed;
    if (url.length > 12000){ toast('This build is large — the new tab may fail to load.', 'err'); }
    window.open(url, '_blank');
  });

  function loadFromHash(){
    const hash = window.location.hash;
    if (hash.startsWith('#doc=')){ try { const d = LZString.decompressFromEncodedURIComponent(hash.slice(5)); if (d){ preview.srcdoc = d; previewEmpty.style.display = 'none'; previewDevice.style.display = 'flex'; fitDevice(); previewUrl.textContent = 'shared preview'; toast('Loaded shared preview', 'ok'); return true; } } catch(e){ console.error(e); } }
    if (hash.startsWith('#code=')){ try { const d = LZString.decompressFromEncodedURIComponent(hash.slice(6)); if (d){ setEditorValue(d); toast('Loaded shared code', 'ok'); return true; } } catch(e){ console.error(e); } }
    return false;
  }
  if (!loadFromHash()) { /* CodeMirror loaded draft from LS already */ }
  if (getEditorValue().trim()) renderPreview();
  setTimeout(fitDevice, 100); 

  const MAX_FILES = 400;
  function parseRepoInput(input){
    input = input.trim().replace(/\.git$/, '');
    let m = input.match(/github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\/tree\/([^\/\s]+))?\/?$/);
    if (m) return { owner: m[1], repo: m[2], branch: m[3] || null };
    m = input.match(/^([^\/\s]+)\/([^\/\s]+)$/);
    if (m) return { owner: m[1], repo: m[2], branch: null };
    throw new Error('Could not parse that as a GitHub repo — try "owner/repo" or a full github.com URL.');
  }

  function makeGithubSource(owner, repo, branch){
    return { kind: 'github', label: `${owner}/${repo}`, owner, repo, branch, async read(path){ if (editedFiles.has(path)) return editedFiles.get(path); return getRawFile(owner, repo, branch, path); }, async assetUrl(path){ return rawFileUrl(owner, repo, branch, path); } };
  }
  function makeLocalSource(dirHandles, rootName){
    const blobCache = new Map();
    return { kind: 'local', label: rootName, async read(path){ if (editedFiles.has(path)) return editedFiles.get(path); const handle = dirHandles.get(path); if (!handle) throw new Error('File not found: ' + path); const file = await handle.getFile(); return file.text(); }, async assetUrl(path){ if (blobCache.has(path)) return blobCache.get(path); const handle = dirHandles.get(path); if (!handle) return ''; const file = await handle.getFile(); const url = URL.createObjectURL(file); blobCache.set(path, url); return url; } };
  }
  function makeVirtualSource(rootName) {
    return { kind: 'virtual', label: rootName, async read(path){ if (editedFiles.has(path)) return editedFiles.get(path); return ''; }, async assetUrl(path){ return ''; } };
  }

  async function ghApiFetch(path, token){
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('https://api.github.com/' + path, { headers });
    if (!res.ok){ if (res.status === 403) throw new Error('GitHub API rate limit hit. Add a token to raise the 60/hr limit.'); if (res.status === 404) throw new Error('Repo or branch not found — double check the URL.'); throw new Error('GitHub API error (' + res.status + ')'); }
    return res.json();
  }
  const rawCache = new Map();
  function rawFileUrl(owner, repo, branch, path){ return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`; }
  async function getRawFile(owner, repo, branch, path){ const key = owner+'/'+repo+'/'+branch+'/'+path; if (rawCache.has(key)) return rawCache.get(key); const res = await fetch(rawFileUrl(owner, repo, branch, path)); if (!res.ok) throw new Error('Failed to fetch ' + path + ' (' + res.status + ')'); const text = await res.text(); rawCache.set(key, text); return text; }

  function posixJoin(dir, rel){ const stack = dir ? dir.split('/') : []; for (const part of rel.split('/')){ if (part === '' || part === '.') continue; if (part === '..') stack.pop(); else stack.push(part); } return stack.join('/'); }
  function resolveLocal(importPath, importerDir, filePaths){ const combined = importPath.startsWith('.') ? posixJoin(importerDir, importPath) : importPath.replace(/^\//, ''); const bases = [combined]; for (const ext of ['.tsx','.ts','.jsx','.js','.mjs','.cjs','.json','.css']) bases.push(combined + ext); for (const ext of ['.tsx','.ts','.jsx','.js']) bases.push(combined + '/index' + ext); for (const b of bases) if (filePaths.has(b)) return b; return null; }

  async function fetchRepoTree(owner, repo, branchOverride, token){
    ghLog(`Looking up ${owner}/${repo}…`);
    const meta = await ghApiFetch(`repos/${owner}/${repo}`, token);
    const branch = branchOverride || meta.default_branch;
    ghLog(`Fetching file tree (branch: ${branch})…`);
    const treeData = await ghApiFetch(`repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token);
    if (treeData.truncated) ghLog('repo tree was truncated (very large repo) — some files may be missing', 'err');
    let files = treeData.tree.filter(f => f.type === 'blob' && !/^(node_modules|\.git|dist|build|coverage|\.next|out)\//.test(f.path));
    if (files.length > MAX_FILES){ ghLog(`${files.length} files found — only using the first ${MAX_FILES}`, 'err'); files = files.slice(0, MAX_FILES); } else { ghLog(`Found ${files.length} files.`, 'ok'); }
    return { branch, filePaths: new Set(files.map(f=>f.path)) };
  }

  let esbuildInstance = null;
  async function ensureEsbuild(){
    if (esbuildInstance) return esbuildInstance;
    ghLog('Loading in-browser bundler (esbuild-wasm, first time only)…');
    const esbuild = await import('https://esm.sh/esbuild-wasm@0.21.5');
    await esbuild.initialize({ wasmURL: 'https://esm.sh/esbuild-wasm@0.21.5/esbuild.wasm', worker: true });
    esbuildInstance = esbuild; return esbuild;
  }

  function virtualFsPlugin(fileSource, filePaths, npmVersions){
    return { name: 'wrenna-vfs', setup(build){
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith('.') || args.path.startsWith('/')){ const importerDir = args.importer ? (args.importer.includes('/') ? args.importer.split('/').slice(0,-1).join('/') : '') : ''; const resolved = resolveLocal(args.path, importerDir, filePaths); if (resolved) return { path: resolved, namespace: 'wrenna-vfs' }; return { errors: [{ text: `Could not resolve local import "${args.path}" from "${args.importer}"` }] }; }
        const pkgName = args.path.startsWith('@') ? args.path.split('/').slice(0,2).join('/') : args.path.split('/')[0];
        const rest = args.path.slice(pkgName.length); const version = npmVersions[pkgName] ? npmVersions[pkgName].replace(/^[\^~]/, '') : '';
        return { path: `https://esm.sh/${pkgName}${version ? '@'+version : ''}${rest}`, external: true };
      });
      build.onLoad({ filter: /.*/, namespace: 'wrenna-vfs' }, async (args) => { const content = await fileSource.read(args.path); const ext = args.path.split('.').pop().toLowerCase(); const loaderMap = { js:'jsx', jsx:'jsx', ts:'ts', tsx:'tsx', mjs:'js', cjs:'js', json:'json', css:'css' }; return { contents: content, loader: loaderMap[ext] || 'text' }; });
    }};
  }

  function findModuleEntryInHtml(html, htmlPath){ const dir = htmlPath.includes('/') ? htmlPath.split('/').slice(0,-1).join('/') : ''; const re = /<script\b[^>]*>/gi; let m; while ((m = re.exec(html))){ if (/type=["']module["']/i.test(m[0])){ const srcMatch = m[0].match(/src=["']([^"']+)["']/i); if (srcMatch && !/^https?:\/\//.test(srcMatch[1])) return posixJoin(dir, srcMatch[1].replace(/^\.?\//, '')); } } return null; }
  function findCommonEntry(filePaths){ const common = ['src/main.tsx','src/main.jsx','src/main.ts','src/main.js','src/index.tsx','src/index.jsx','src/index.ts','src/index.js','index.tsx','index.jsx','index.ts','index.js']; for (const c of common) if (filePaths.has(c)) return c; return null; }

  async function inlineStaticAssets(html, htmlPath, fileSource, filePaths){
    const dir = htmlPath.includes('/') ? htmlPath.split('/').slice(0,-1).join('/') : '';
    async function replaceAsync(str, regex, fn){ const matches = [...str.matchAll(regex)]; let result = str, offset = 0; for (const m of matches){ const replacement = await fn(...m); const idx = m.index + offset; result = result.slice(0, idx) + replacement + result.slice(idx + m[0].length); offset += replacement.length - m[0].length; } return result; }
    html = await replaceAsync(html, /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, async (match, href) => { if (/^https?:\/\//.test(href)) return match; const path = posixJoin(dir, href.replace(/^\.?\//, '')); if (!filePaths.has(path)) return match; return `<style>${await fileSource.read(path)}</style>`; });
    html = await replaceAsync(html, scriptSrcRegex, async (match, pre, src, post) => { if (/^https?:\/\//.test(src) || /type=["']module["']/i.test(pre+post)) return match; const path = posixJoin(dir, src.replace(/^\.?\//, '')); if (!filePaths.has(path)) return match; return `<script${pre}${post}>${await fileSource.read(path)}</script>`; });
    html = await replaceAsync(html, /(src|href)=["'](?!https?:\/\/|data:|#|mailto:)([^"']+)["']/gi, async (m, attr, val) => { const path = posixJoin(dir, val.replace(/^\.?\//, '')); if (!filePaths.has(path)) return m; return `${attr}="${await fileSource.assetUrl(path)}"`; });
    return html;
  }

  async function rebuildProject(fileSource, filePaths){
    let npmVersions = {};
    if (filePaths.has('package.json')){ try { const pkg = JSON.parse(await fileSource.read('package.json')); npmVersions = Object.assign({}, pkg.dependencies, pkg.devDependencies); } catch(e){ } }
    const htmlPath = filePaths.has('index.html') ? 'index.html' : [...filePaths].find(p => /(^|\/)index\.html$/.test(p));
    let html = htmlPath ? await fileSource.read(htmlPath) : null;
    let moduleEntry = html ? findModuleEntryInHtml(html, htmlPath) : null;
    if (!moduleEntry && !html) moduleEntry = findCommonEntry(filePaths);
    if (moduleEntry){
      const esbuild = await ensureEsbuild();
      const result = await esbuild.build({ entryPoints: [moduleEntry], bundle: true, format: 'esm', jsx: 'automatic', jsxImportSource: 'https://esm.sh/react' + (npmVersions.react ? '@'+npmVersions.react.replace(/^[\^~]/,'') : ''), write: false, logLevel: 'silent', plugins: [virtualFsPlugin(fileSource, filePaths, npmVersions)] });
      let jsOut = '', cssOut = '';
      for (const f of result.outputFiles){ if (f.path.endsWith('.css')) cssOut += f.text; else jsOut += f.text; }
      let shell = html || '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div id="root"></div></body></html>';
      shell = shell.replace(moduleScriptRegex, '');
      shell = await inlineStaticAssets(shell, htmlPath || 'index.html', fileSource, filePaths);
      shell = /<\/body>/i.test(shell) ? shell.replace('</body>', `<script type="module">\n${jsOut}\n</script></body>`) : shell + `<script type="module">${jsOut}</script>`;
      return shell;
    } else if (html) { return await inlineStaticAssets(html, htmlPath, fileSource, filePaths); }
    else { throw new Error('No index.html and no recognizable entry point for this project layout.'); }
  }

  const ghLogWrap = document.getElementById('gh-log-wrap'); const ghLogTitle = document.getElementById('gh-log-title'); const ghLogBody = document.getElementById('gh-log-body'); const ghProgress = document.getElementById('gh-progress');
  function ghLog(msg, cls){ ghLogWrap.style.display = 'block'; const line = document.createElement('span'); line.className = 'log-line ' + (cls || 'info'); line.textContent = msg; ghLogBody.appendChild(line); ghLogBody.scrollTop = ghLogBody.scrollHeight; }

  document.getElementById('gh-fetch-btn').addEventListener('click', async ()=>{
    const input = document.getElementById('gh-repo-input').value.trim(); if (!input){ toast('Paste a repo URL or owner/repo first'); return; }
    const branch = document.getElementById('gh-branch-input').value.trim() || null; const token = document.getElementById('gh-token-input').value.trim();
    if (token) localStorage.setItem(LS.ghToken, token);
    ghLogBody.innerHTML = ''; ghLogTitle.textContent = 'importing…'; ghProgress.style.display = 'block';
    try {
      const { owner, repo } = parseRepoInput(input); const { branch: resolvedBranch, filePaths } = await fetchRepoTree(owner, repo, branch, token); const fileSource = makeGithubSource(owner, repo, resolvedBranch);
      ghLog('Building preview (detecting static vs. bundled, resolving imports)…'); const finalDoc = await rebuildProject(fileSource, filePaths);
      preview.srcdoc = finalDoc; previewEmpty.style.display = 'none'; previewDevice.style.display = 'flex'; fitDevice(); previewUrl.textContent = `${owner}/${repo}`;
      ghLogTitle.textContent = 'done'; ghLog(`github.com/${owner}/${repo} (${resolvedBranch}) is live in the preview`, 'ok'); projectName.textContent = repo; setUnsaved(false);
      renderFileTree(fileSource, filePaths); closeModal('modal-github'); toast('Repo imported', 'ok');
    } catch(err){ console.error(err); ghLog(err.message, 'err'); ghLogTitle.textContent = 'failed'; toast(err.message, 'err'); }
  });

  let currentTreeData = null;
  function pathsToTree(paths){ const root = { name: '', children: {}, isFile: false }; for (const p of paths){ const parts = p.split('/'); let node = root; parts.forEach((part, i)=>{ const isFile = i === parts.length - 1; if (!node.children[part]) node.children[part] = { name: part, children: {}, isFile, fullPath: parts.slice(0, i+1).join('/') }; node = node.children[part]; }); } return root; }
  function fileIconSvg(){ return '<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>'; }
  function folderIconSvg(){ return '<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>'; }
  function chevronSvg(){ return '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'; }

  function renderNode(node, depth){
    const entries = Object.values(node.children).sort((a,b)=>{ if (!!a.isFile !== !!b.isFile) return a.isFile ? 1 : -1; return a.name.localeCompare(b.name); });
    if (!entries.length) return ''; let html = '<ul>';
    for (const child of entries){
      if (child.isFile){ html += `<li><button class="row file-row" data-path="${child.fullPath}">${fileIconSvg()}<span class="file-name">${child.name}</span></button></li>`; }
      else { const collapsed = depth >= 1; html += `<li class="folder ${collapsed ? 'collapsed' : 'expanded'}"><button class="row folder-row">${chevronSvg()}${folderIconSvg()}<span class="folder-name">${child.name}</span></button><div class="folder-children">${renderNode(child, depth+1)}</div></li>`; }
    } html += '</ul>'; return html;
  }
  function wireTreeInteractions(){
    treeRoot.querySelectorAll('.folder-row').forEach(row=> row.addEventListener('click', e=>{ e.stopPropagation(); const folder = row.parentElement; folder.classList.toggle('collapsed'); folder.classList.toggle('expanded'); }));
    treeRoot.querySelectorAll('.file-row').forEach(row=> row.addEventListener('click', ()=> openTreeFile(row)));
  }
  async function openTreeFile(row){
    treeRoot.querySelectorAll('.file-row.active').forEach(r=> r.classList.remove('active')); row.classList.add('active');
    requestAnimationFrame(()=>{ getActiveIndicator().style.top = (row.offsetTop + 6) + 'px'; });
    const path = row.dataset.path; if (!currentTreeData) return;
    try { const content = editedFiles.has(path) ? editedFiles.get(path) : await currentTreeData.fileSource.read(path); currentFilePath = path; setEditorValue(content); projectName.textContent = path; editorTabs.style.display = 'flex'; const dot = editedFiles.has(path) ? '<span class="edit-dot"></span>' : ''; editorTabs.innerHTML = `<div class="tab active"><span>${path.split('/').pop()}</span>${dot}</div>`; } catch(e){ toast('Could not load ' + path, 'err'); }
  }
  function markDirty(path){ const row = treeRoot.querySelector(`.file-row[data-path="${CSS.escape(path)}"]`); if (row && !row.querySelector('.edit-dot')) row.appendChild(Object.assign(document.createElement('span'), { className: 'edit-dot' })); const tab = editorTabs.querySelector('.tab.active'); if (tab && !tab.querySelector('.edit-dot')) tab.appendChild(Object.assign(document.createElement('span'), { className: 'edit-dot' })); }
  function clearDirty(path){ const row = treeRoot.querySelector(`.file-row[data-path="${CSS.escape(path)}"]`); if(row) { const dot = row.querySelector('.edit-dot'); if(dot) dot.remove(); } if (currentFilePath === path) { const t = editorTabs.querySelector('.tab.active .edit-dot'); if(t) t.remove(); } }

  function renderFileTree(fileSource, filePaths){
    currentTreeData = { fileSource, filePaths }; currentFilePath = null; editedFiles.clear();
    const tree = pathsToTree([...filePaths].sort()); treeRoot.innerHTML = '';
    const indicator = document.createElement('div'); indicator.className = 'active-indicator'; indicator.id = 'active-indicator'; treeRoot.appendChild(indicator);
    const wrap = document.createElement('div'); wrap.innerHTML = renderNode(tree, 0);
    while (wrap.firstChild) treeRoot.appendChild(wrap.firstChild);
    wireTreeInteractions(); hasProject = true; updateLayout();
    ghPushBtn.textContent = fileSource.kind === 'local' ? 'Save' : 'Push'; ghPushBtn.title = fileSource.kind === 'local' ? 'Save changes to the local folder' : 'Push commits to GitHub';
  }
  
  function createNewNode(isFolder) {
    if (!currentTreeData) {
      currentTreeData = { fileSource: makeVirtualSource('untitled'), filePaths: new Set() };
      hasProject = true; updateLayout();
    }
    const name = isFolder ? 'new-folder' : 'new-file.js';
    let path = name;
    let counter = 1;
    while(currentTreeData.filePaths.has(path)) {
      path = isFolder ? `new-folder-${counter}` : `new-file-${counter}.js`;
      counter++;
    }
    currentTreeData.filePaths.add(path);
    if (!isFolder) { editedFiles.set(path, ''); }
    renderFileTree(currentTreeData.fileSource, currentTreeData.filePaths);
    if (!isFolder) {
      const newRow = treeRoot.querySelector(`.file-row[data-path="${path}"]`);
      if (newRow) openTreeFile(newRow);
    }
  }

  newFileBtn.addEventListener('click', () => createNewNode(false));
  newFolderBtn.addEventListener('click', () => createNewNode(true));

  treeSearch.addEventListener('input', ()=>{ const q = treeSearch.value.toLowerCase(); treeRoot.querySelectorAll('.file-row').forEach(row=>{ const path = (row.dataset.path || '').toLowerCase(); const match = !q || path.includes(q); row.closest('li').style.display = match ? '' : 'none'; if (match && q){ let el = row.closest('ul') ? row.closest('ul').closest('li.folder') : null; while (el){ el.classList.remove('collapsed'); el.classList.add('expanded'); el = el.parentElement ? el.parentElement.closest('li.folder') : null; } } }); });

  let hasProject = false; let treeManuallyHidden = false;
  function updateLayout(){
    const showTree = hasProject && !treeManuallyHidden;
    workspace.classList.toggle('has-tree', showTree);
    filetree.style.display = showTree ? 'flex' : 'none';
    setTimeout(fitDevice, 50); 
  }
  document.getElementById('layout-tree-btn').addEventListener('click', ()=>{ if (!hasProject){ openModal('modal-github'); return; } treeManuallyHidden = !treeManuallyHidden; updateLayout(); });
  treeCloseBtn.addEventListener('click', ()=>{ treeManuallyHidden = true; updateLayout(); });
  updateLayout();

  const ghConnectBtn = document.getElementById('gh-connect-btn'); const ghConnected = document.getElementById('gh-connected'); const ghAvatar = document.getElementById('gh-avatar'); const ghPushBtn = document.getElementById('gh-push-btn');
  async function checkGithubConnection(){
    const token = localStorage.getItem(LS.ghToken); if (!token){ ghConnectBtn.style.display = 'grid'; ghConnected.style.display = 'none'; return; }
    try { const user = await ghApiFetch('user', token); ghAvatar.textContent = (user.login || '?')[0].toUpperCase(); ghConnectBtn.style.display = 'none'; ghConnected.style.display = 'flex'; } catch(e){ localStorage.removeItem(LS.ghToken); ghConnectBtn.style.display = 'grid'; ghConnected.style.display = 'none'; }
  }
  ghConnectBtn.addEventListener('click', ()=> openModal('modal-github')); ghPushBtn.addEventListener('click', pushOrSaveChanges); checkGithubConnection();

  const GITHUB_OAUTH_CLIENT_ID = '';
  document.getElementById('gh-oauth-btn').addEventListener('click', ()=>{ if (!GITHUB_OAUTH_CLIENT_ID){ toast('OAuth isn\'t configured on this deployment yet — use the token field below for now'); return; } const params = new URLSearchParams({ client_id: GITHUB_OAUTH_CLIENT_ID, scope: 'repo' }); window.location.href = 'https://github.com/login/oauth/authorize?' + params.toString(); });
  async function handleOAuthCallback(){ const params = new URLSearchParams(window.location.search); const code = params.get('code'); if (!code) return; history.replaceState(null, '', window.location.origin + window.location.pathname + window.location.hash); toast('Finishing GitHub sign-in…'); try { const res = await fetch('/api/github-oauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }); const data = await res.json(); if (!res.ok || !data.access_token) throw new Error(data.error || 'Sign-in failed'); localStorage.setItem(LS.ghToken, data.access_token); await checkGithubConnection(); toast('Signed in with GitHub', 'ok'); closeModal('modal-github'); } catch(e){ toast('GitHub sign-in failed: ' + e.message, 'err'); } }
  handleOAuthCallback();

  async function pushOrSaveChanges(){ if (!currentTreeData){ toast('No project loaded'); return; } if (currentTreeData.fileSource.kind === 'local') return saveLocalChanges(); return pushChanges(); }
  async function pushChanges(){
    if (editedFiles.size === 0){ toast('Nothing to push — no unsaved changes'); return; } const token = localStorage.getItem(LS.ghToken); if (!token){ toast('Connect GitHub first'); openModal('modal-github'); return; }
    const { owner, repo, branch } = currentTreeData.fileSource; const total = editedFiles.size; toast(`Pushing ${total} file${total > 1 ? 's' : ''}…`); ghPushBtn.disabled = true; const originalPushLabel = ghPushBtn.textContent; ghPushBtn.textContent = '···';
    let pushedCount = 0; const failures = [];
    for (const [path, content] of [...editedFiles]){
      const apiPath = path.split('/').map(encodeURIComponent).join('/');
      try { const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}?ref=${branch}`, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } }); if (!getRes.ok) throw new Error(`couldn't read current state of ${path} (${getRes.status})`); const { sha } = await getRes.json(); const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Update ${path} via Wrenna`, content: btoa(unescape(encodeURIComponent(content))), sha, branch }) }); if (!putRes.ok){ const errBody = await putRes.json().catch(()=>({})); throw new Error(errBody.message || `push rejected (${putRes.status})`); } editedFiles.delete(path); clearDirty(path); pushedCount++; } catch(e){ failures.push(`${path}: ${e.message}`); }
    }
    ghPushBtn.disabled = false; ghPushBtn.textContent = originalPushLabel; setUnsaved(editedFiles.size > 0);
    if (failures.length){ toast(`Pushed ${pushedCount}/${total} — ${failures.length} failed`, 'err'); failures.forEach(f => toast(f, 'err')); } else { toast(`Pushed ${pushedCount} commit${pushedCount > 1 ? 's' : ''} to ${branch}`, 'ok'); }
  }

  async function walkLocalDirectory(dirHandle, dirHandles, prefix){ const filePaths = new Set(); for await (const [name, handle] of dirHandle.entries()){ if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build') continue; const path = prefix ? prefix + '/' + name : name; if (handle.kind === 'file'){ filePaths.add(path); dirHandles.set(path, handle); } else if (handle.kind === 'directory'){ const nested = await walkLocalDirectory(handle, dirHandles, path); for (const p of nested) filePaths.add(p); } } return filePaths; }
  document.getElementById('open-local-folder-btn').addEventListener('click', async ()=>{
    if (!window.showDirectoryPicker){ toast('Local folder access needs Chrome or Edge on desktop', 'err'); return; }
    toast('Opening folder picker…'); try { const dirHandle = await window.showDirectoryPicker(); toast('Reading folder…'); const dirHandles = new Map(); const filePaths = await walkLocalDirectory(dirHandle, dirHandles, ''); if (filePaths.size === 0){ toast('That folder looks empty', 'err'); return; } if (filePaths.size > MAX_FILES){ toast(`${filePaths.size} files found — only using the first ${MAX_FILES}`, 'err'); }
      const fileSource = makeLocalSource(dirHandles, dirHandle.name); const finalDoc = await rebuildProject(fileSource, filePaths); preview.srcdoc = finalDoc; previewEmpty.style.display = 'none'; previewDevice.style.display = 'flex'; fitDevice(); previewUrl.textContent = dirHandle.name; projectName.textContent = dirHandle.name; setUnsaved(false); renderFileTree(fileSource, filePaths); closeModal('modal-github'); toast(`Opened "${dirHandle.name}"`, 'ok');
    } catch(e){ if (e.name === 'AbortError'){ toast('Folder picker closed without choosing a folder'); return; } console.error(e); toast('Could not open that folder: ' + e.message, 'err'); }
  });
  async function saveLocalChanges(){
    if (editedFiles.size === 0){ toast('Nothing to save — no unsaved changes'); return; } const { dirHandles } = currentTreeData.fileSource; const total = editedFiles.size; ghPushBtn.disabled = true; const originalLabel = ghPushBtn.textContent; ghPushBtn.textContent = '···';
    let savedCount = 0; const failures = [];
    for (const [path, content] of [...editedFiles]){ try { const handle = dirHandles.get(path); if (!handle) throw new Error('file handle not found'); const writable = await handle.createWritable(); await writable.write(content); await writable.close(); editedFiles.delete(path); clearDirty(path); savedCount++; } catch(e){ failures.push(`${path}: ${e.message}`); } }
    ghPushBtn.disabled = false; ghPushBtn.textContent = originalLabel; setUnsaved(editedFiles.size > 0);
    if (failures.length){ toast(`Saved ${savedCount}/${total} — ${failures.length} failed`, 'err'); failures.forEach(f => toast(f, 'err')); } else { toast(`Saved ${savedCount} file${savedCount > 1 ? 's' : ''} to disk`, 'ok'); }
  }
  
  console.log("Wrenna Engine Ready.");
})();
