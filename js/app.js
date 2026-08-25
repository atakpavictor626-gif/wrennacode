/**
 * WRENNA — app.js (FIXED)
 * The bug: EditorState.appendConfig.of() was invalid.
 * The fix: include updateListener in initial extensions.
 */

// ============================================================
// IMPORTS
// ============================================================
import { EditorView, basicSetup } from 'https://esm.sh/codemirror';
import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state';
import { keymap } from 'https://esm.sh/@codemirror/view';
import { html } from 'https://esm.sh/@codemirror/lang-html';
import { css as cssLang } from 'https://esm.sh/@codemirror/lang-css';
import { javascript } from 'https://esm.sh/@codemirror/lang-javascript';
import { json as jsonLang } from 'https://esm.sh/@codemirror/lang-json';
import { markdown as mdLang } from 'https://esm.sh/@codemirror/lang-markdown';

import LZString from 'https://esm.sh/lz-string@1.5.0';

// Warn if opened via file:// (ES modules won't load)
if (location.protocol === 'file:') {
    console.warn(
        '%c⚠ Wrenna requires an HTTP server.',
        'font-size:14px;color:#e8734a;font-weight:bold;'
    );
    console.warn('ES modules are blocked by CORS on file:// protocol.');
    console.warn('Run: npx serve .   or   python -m http.server 8000');
}


// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    LIVE_DEBOUNCE: 500,
    SAVE_DEBOUNCE: 1000,
    AI_MAX_FREE: 10,
    AD_COOLDOWN_MS: 90 * 1000,
    SANDBOX: 'allow-scripts allow-forms allow-popups allow-modals',
    KEYS: {
        DRAFTS: 'wrenna_drafts',
        ACTIVE: 'wrenna_active_draft',
        AI_QUOTA: 'wrenna_ai_quota',
        AI_DATE: 'wrenna_ai_date'
    }
};

const $ = (id) => document.getElementById(id);


// ============================================================
// UTILITIES
// ============================================================
const Utils = {
    debounce(fn, delay) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    },
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    },
    
    langFromFilename(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const map = {
            'html': 'html', 'htm': 'html', 'css': 'css',
            'js': 'javascript', 'mjs': 'javascript', 'jsx': 'javascript',
            'json': 'json', 'md': 'markdown'
        };
        return map[ext] || 'plaintext';
    },
    
    langLabel(lang) {
        const labels = { html: 'HTML', css: 'CSS', javascript: 'JS', json: 'JSON', markdown: 'MD' };
        return labels[lang] || 'TXT';
    }
};


// ============================================================
// TOAST
// ============================================================
class Toast {
    constructor() {
        this.container = $('toast-container');
    }
    
    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        this.container.appendChild(toast);
        
        const timer = setTimeout(() => this.close(toast), duration);
        toast.addEventListener('click', () => {
            clearTimeout(timer);
            this.close(toast);
        });
    }
    
    close(toast) {
        if (toast.classList.contains('closing')) return;
        toast.classList.add('closing');
        toast.addEventListener('animationend', () => toast.remove());
    }
}


// ============================================================
// STATE
// ============================================================
class State {
    constructor() {
        this.files = new Map();
        this.activeFile = 'index.html';
        this.device = 'mobile';
        this.livePreview = true;
        this.openTabs = ['index.html'];
        this.load();
    }
    
    load() {
        try {
            const raw = localStorage.getItem(CONFIG.KEYS.DRAFTS);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.files) {
                    Object.entries(parsed.files).forEach(([name, data]) => {
                        this.files.set(name, data);
                    });
                }
            }
            const active = localStorage.getItem(CONFIG.KEYS.ACTIVE);
            if (active && this.files.has(active)) {
                this.activeFile = active;
                this.openTabs = [active];
            }
        } catch (e) {
            console.warn('Load failed:', e);
        }
        
        if (this.files.size === 0) {
            this.files.set('index.html', {
                content: '<!-- Paste your code here -->\n',
                lang: 'html'
            });
        }
    }
    
    save() {
        try {
            const files = {};
            this.files.forEach((data, name) => { files[name] = data; });
            localStorage.setItem(CONFIG.KEYS.DRAFTS, JSON.stringify({ files }));
            localStorage.setItem(CONFIG.KEYS.ACTIVE, this.activeFile);
        } catch (e) {
            console.warn('Save failed:', e);
        }
    }
    
    getFile(name) { return this.files.get(name); }
    
    setFile(name, content) {
        const existing = this.files.get(name) || {};
        this.files.set(name, {
            content,
            lang: existing.lang || Utils.langFromFilename(name)
        });
    }
    
    deleteFile(name) {
        this.files.delete(name);
        if (this.activeFile === name) {
            this.activeFile = this.files.keys().next().value || null;
        }
        this.openTabs = this.openTabs.filter(t => t !== name);
    }
    
    getAllContent() {
        const out = {};
        this.files.forEach((data, name) => { out[name] = data.content; });
        return out;
    }
}


// ============================================================
// FILE MANAGER
// ============================================================
class FileManager {
    constructor(state, toast) {
        this.state = state;
        this.toast = toast;
        this.treeBody = $('file-tree-body');
        this.tabsEl = $('tabs');
        this.searchInput = $('file-search');
        this.onFileOpen = null;
        
        this.bindEvents();
    }
    
    bindEvents() {
        $('btn-file-tree').addEventListener('click', () => this.toggleTree());
        $('btn-file-tree-close').addEventListener('click', () => this.toggleTree(false));
        $('btn-new-file').addEventListener('click', () => this.createNewFile());
        $('btn-tab-new').addEventListener('click', () => this.createNewFile());
        $('btn-open-folder').addEventListener('click', () => this.openLocalFiles());
        
        this.searchInput.addEventListener('input', () => this.renderTree());
        
        this.tabsEl.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;
            const filename = tab.dataset.file;
            
            if (e.target.closest('.tab-close')) {
                this.closeTab(filename);
            } else {
                this.openFile(filename);
            }
        });
    }
    
    toggleTree(force) {
        const tree = $('file-tree');
        const isOpen = tree.classList.contains('open');
        const shouldOpen = force !== undefined ? force : !isOpen;
        tree.classList.toggle('open', shouldOpen);
        tree.setAttribute('aria-hidden', String(!shouldOpen));
        if (shouldOpen) this.renderTree();
    }
    
    createNewFile() {
        const name = prompt('File name (e.g., style.css, app.js):');
        if (!name || !name.includes('.')) {
            if (name) this.toast.show('Please include an extension (e.g., .html)', 'error');
            return;
        }
        if (this.state.files.has(name)) {
            this.toast.show(`"${name}" already exists`, 'error');
            return;
        }
        
        this.state.setFile(name, '');
        this.state.openTabs.push(name);
        this.state.activeFile = name;
        this.state.save();
        this.renderTree();
        this.renderTabs();
        if (this.onFileOpen) this.onFileOpen(name);
        this.toast.show(`Created ${name}`, 'success');
    }
    
    openLocalFiles() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.html,.htm,.css,.js,.mjs,.jsx,.json,.md,.txt';
        
        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.state.setFile(file.name, ev.target.result);
                    this.state.openTabs.push(file.name);
                    this.state.save();
                    this.renderTree();
                    this.renderTabs();
                };
                reader.readAsText(file);
            });
            if (files.length) this.toast.show(`Imported ${files.length} file(s)`, 'success');
        };
        
        input.click();
    }
    
    openFile(name) {
        if (!this.state.files.has(name)) return;
        this.state.activeFile = name;
        if (!this.state.openTabs.includes(name)) {
            this.state.openTabs.push(name);
        }
        this.state.save();
        this.renderTree();
        this.renderTabs();
        if (this.onFileOpen) this.onFileOpen(name);
    }
    
    closeTab(name) {
        if (this.state.openTabs.length <= 1) return;
        
        this.state.openTabs = this.state.openTabs.filter(t => t !== name);
        
        if (this.state.activeFile === name) {
            this.state.activeFile = this.state.openTabs[0];
            if (this.onFileOpen) this.onFileOpen(this.state.activeFile);
        }
        
        this.state.save();
        this.renderTabs();
    }
    
    renderTree() {
        const query = this.searchInput.value.toLowerCase();
        this.treeBody.innerHTML = '';
        
        this.state.files.forEach((data, name) => {
            if (query && !name.toLowerCase().includes(query)) return;
            
            const item = document.createElement('div');
            item.className = `file-item ${name === this.state.activeFile ? 'active' : ''}`;
            item.textContent = name;
            item.addEventListener('click', () => {
                this.openFile(name);
                this.toggleTree(false);
            });
            this.treeBody.appendChild(item);
        });
    }
    
    renderTabs() {
        this.tabsEl.innerHTML = '';
        
        this.state.openTabs.forEach(name => {
            if (!this.state.files.has(name)) return;
            
            const tab = document.createElement('div');
            tab.className = `tab ${name === this.state.activeFile ? 'active' : ''}`;
            tab.dataset.file = name;
            tab.innerHTML = `<span class="tab-label">${name}</span><button class="tab-close" aria-label="Close">×</button>`;
            this.tabsEl.appendChild(tab);
        });
    }
}


// ============================================================
// CODEMIRROR MANAGER (FIXED)
// ============================================================
class CodeMirrorManager {
    constructor(state) {
        this.state = state;
        this.view = null;
        this.langCompartment = new Compartment();
        this.onContentChange = null;
        this.onRun = null;
    }
    
    getLangExtension(filename) {
        const lang = Utils.langFromFilename(filename);
        switch (lang) {
            case 'html': return html();
            case 'css': return cssLang();
            case 'javascript': return javascript({ jsx: true });
            case 'json': return jsonLang();
            case 'markdown': return mdLang();
            default: return [];
        }
    }
    
    init(container) {
        const file = this.state.getFile(this.state.activeFile);
        
        // Build ALL extensions upfront — including the update listener
        const extensions = [
            basicSetup,
            keymap.of([{
                key: 'Mod-Enter',
                run: () => {
                    if (this.onRun) this.onRun();
                    return true;
                }
            }]),
            this.langCompartment.of(this.getLangExtension(this.state.activeFile)),
            EditorView.lineWrapping,
            EditorView.theme({
                '&': { backgroundColor: 'var(--bg-0)', color: 'var(--fg-0)' },
                '.cm-content': { caretColor: 'var(--accent)' },
                '.cm-gutters': { backgroundColor: 'var(--bg-0)', color: 'var(--fg-3)', border: 'none' },
                '.cm-activeLine': { backgroundColor: 'var(--bg-1)' },
                '.cm-activeLineGutter': { backgroundColor: 'var(--bg-1)', color: 'var(--fg-1)' },
                '.cm-cursor': { borderLeft: '2px solid var(--accent)' },
                '.cm-selectionBackground': { backgroundColor: 'rgba(232, 115, 74, 0.18)' }
            }),
            // THE FIX: update listener goes here, in the extensions array
            EditorView.updateListener.of((update) => {
                if (update.docChanged && this.onContentChange) {
                    this.onContentChange(update.state.doc.toString());
                }
                if (update.selectionSet || update.docChanged) {
                    this.updateStatus();
                }
            })
        ];
        
        this.view = new EditorView({
            state: EditorState.create({
                doc: file ? file.content : '',
                extensions: extensions
            }),
            parent: container
        });
    }
    
    openFile(filename) {
        const file = this.state.getFile(filename);
        if (!file) return;
        
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: file.content },
            effects: this.langCompartment.reconfigure(this.getLangExtension(filename))
        });
        
        $('editor-welcome').classList.add('hidden');
        this.updateStatus();
        this.updateFileStatus(filename, file.content);
    }
    
    setContent(content) {
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: content }
        });
    }
    
    getContent() {
        return this.view.state.doc.toString();
    }
    
    getSelectedText() {
        const sel = this.view.state.selection.main;
        if (sel.empty) return '';
        return this.view.state.doc.sliceString(sel.from, sel.to);
    }
    
    insertAtCursor(text) {
        const sel = this.view.state.selection.main;
        this.view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length }
        });
    }
    
    updateStatus() {
        if (!this.view) return;
        const state = this.view.state;
        const sel = state.selection.main;
        const line = state.doc.lineAt(sel.head);
        $('status-pos').textContent = `Ln ${line.number}, Col ${sel.head - line.from + 1}`;
    }
    
    updateFileStatus(filename, content) {
        $('status-lang').textContent = Utils.langLabel(Utils.langFromFilename(filename));
        $('status-size').textContent = Utils.formatBytes(new Blob([content]).size);
    }
}


// ============================================================
// PREVIEW MANAGER
// ============================================================
class PreviewManager {
    constructor(state, toast) {
        this.state = state;
        this.toast = toast;
        this.iframes = {
            mobile: $('iframe-mobile'),
            tablet: $('iframe-tablet'),
            desktop: $('iframe-desktop')
        };
        this.devices = {
            mobile: $('device-mobile'),
            tablet: $('device-tablet'),
            desktop: $('device-desktop')
        };
        this.isEmpty = true;
        this.onStateChange = null;
        
        this.bindEvents();
    }
    
    bindEvents() {
        document.querySelectorAll('.pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setDevice(btn.dataset.device);
            });
        });
        
        $('btn-refresh').addEventListener('click', () => {
            this.render();
            this.toast.show('Preview refreshed', 'info', 1500);
        });
    }
    
    setDevice(device) {
        this.state.device = device;
        document.body.dataset.device = device;
        
        document.querySelectorAll('.pill-btn').forEach(btn => {
            const isActive = btn.dataset.device === device;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
        
        Object.entries(this.devices).forEach(([name, el]) => {
            el.classList.toggle('active', name === device);
        });
        
        if (!this.isEmpty) this.render();
    }
    
    buildDocument() {
        const files = this.state.getAllContent();
        let html = files['index.html'] || '';
        
        let css = '';
        Object.entries(files).forEach(([name, content]) => {
            if (name.endsWith('.css')) css += `\n${content}`;
        });
        
        let js = '';
        Object.entries(files).forEach(([name, content]) => {
            if (name.endsWith('.js') || name.endsWith('.mjs')) js += `\n${content}`;
        });
        
        if (css && html.includes('</head>') && !html.includes('<style>')) {
            html = html.replace('</head>', `<style>${css}</style></head>`);
        }
        
        if (js && html.includes('</body>') && !html.includes('<script>')) {
            html = html.replace('</body>', `<script>${js}<\/script></body>`);
        }
        
        return html;
    }
    
    render() {
        const content = this.buildDocument();
        
        // Check if there's actual content (not just comments/whitespace)
        const stripped = content.replace(/<!--[\s\S]*?-->/g, '').trim();
        
        if (!stripped || stripped === '') {
            this.showEmpty();
            return;
        }
        
        this.hideEmpty();
        
        Object.values(this.iframes).forEach(iframe => {
            iframe.srcdoc = content;
        });
    }
    
    showEmpty() {
        this.isEmpty = true;
        $('preview-empty').classList.remove('hidden');
        if (this.onStateChange) this.onStateChange('empty');
    }
    
    hideEmpty() {
        this.isEmpty = false;
        $('preview-empty').classList.add('hidden');
        if (this.onStateChange) this.onStateChange('active');
    }
}


// ============================================================
// AD MANAGER
// ============================================================
class AdManager {
    constructor() {
        this.lastHidden = 0;
        this.isActive = false;
        this.video = $('ad-video');
        this.slot = $('ad-slot');
        this.retryTimer = null;
        this.videoSources = []; // Add video URLs here when ready
        
        this.bindEvents();
    }
    
    bindEvents() {
        $('btn-ad-mute').addEventListener('click', () => {
            this.video.muted = !this.video.muted;
            const btn = $('btn-ad-mute');
            const iconOn = btn.querySelector('.icon-sound-on');
            const iconOff = btn.querySelector('.icon-sound-off');
            if (iconOn && iconOff) {
                iconOn.style.display = this.video.muted ? 'none' : 'block';
                iconOff.style.display = this.video.muted ? 'block' : 'none';
            }
        });
    }
    
    onPreviewEmpty() {
        if (this.videoSources.length === 0) return;
        
        const elapsed = Date.now() - this.lastHidden;
        
        if (elapsed >= CONFIG.AD_COOLDOWN_MS) {
            this.show();
        } else {
            const wait = CONFIG.AD_COOLDOWN_MS - elapsed;
            this.retryTimer = setTimeout(() => {
                if (!this.isActive) this.show();
            }, wait);
        }
    }
    
    onPreviewActive() {
        this.hide();
        this.lastHidden = Date.now();
        clearTimeout(this.retryTimer);
    }
    
    show() {
        if (this.isActive || this.videoSources.length === 0) return;
        this.isActive = true;
        
        const src = this.videoSources[Math.floor(Math.random() * this.videoSources.length)];
        this.video.src = src;
        this.video.muted = true;
        
        this.slot.classList.add('active');
        this.video.play().catch(() => {});
    }
    
    hide() {
        if (!this.isActive) return;
        this.isActive = false;
        this.slot.classList.remove('active');
        this.video.pause();
    }
}


// ============================================================
// AI MANAGER
// ============================================================
class AIManager {
    constructor(state, toast, editor) {
        this.state = state;
        this.toast = toast;
        this.editor = editor;
        this.modal = $('ai-modal');
        this.quotaEl = $('ai-quota');
        this.contextEl = $('ai-context-code');
        this.promptEl = $('ai-prompt-input');
        this.generateBtn = $('btn-ai-generate');
        this.isGenerating = false;
        
        this.bindEvents();
        this.updateQuotaDisplay();
    }
    
    get quota() {
        const today = new Date().toDateString();
        const savedDate = localStorage.getItem(CONFIG.KEYS.AI_DATE);
        
        if (savedDate !== today) {
            localStorage.setItem(CONFIG.KEYS.AI_DATE, today);
            localStorage.setItem(CONFIG.KEYS.AI_QUOTA, String(CONFIG.AI_MAX_FREE));
            return CONFIG.AI_MAX_FREE;
        }
        
        return parseInt(localStorage.getItem(CONFIG.KEYS.AI_QUOTA) || '0', 10);
    }
    
    set quota(value) {
        localStorage.setItem(CONFIG.KEYS.AI_QUOTA, String(value));
        this.updateQuotaDisplay();
    }
    
    updateQuotaDisplay() {
        this.quotaEl.textContent = `${this.quota} left today`;
    }
    
    bindEvents() {
        $('btn-ai').addEventListener('click', () => this.open());
        $('btn-ai-close').addEventListener('click', () => this.close());
        
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
        
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', () => {
                this.promptEl.value = chip.dataset.prompt;
                this.promptEl.focus();
            });
        });
        
        this.generateBtn.addEventListener('click', () => this.generate());
    }
    
    open() {
        const selected = this.editor.getSelectedText();
        this.contextEl.textContent = selected || '// Select code for context';
        
        this.modal.classList.add('open');
        this.modal.setAttribute('aria-hidden', 'false');
        this.promptEl.focus();
    }
    
    close() {
        this.modal.classList.remove('open');
        this.modal.setAttribute('aria-hidden', 'true');
    }
    
    async generate() {
        if (this.isGenerating) return;
        
        const prompt = this.promptEl.value.trim();
        if (!prompt) {
            this.toast.show('Please enter a prompt', 'error');
            return;
        }
        
        if (this.quota <= 0) {
            this.toast.show('Daily AI limit reached. Upgrade to Pro for unlimited.', 'error');
            return;
        }
        
        this.isGenerating = true;
        this.generateBtn.disabled = true;
        this.generateBtn.textContent = 'Generating...';
        
        try {
            const response = await fetch('/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    context: this.editor.getSelectedText(),
                    language: Utils.langFromFilename(this.state.activeFile)
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            const code = data.response || data.output || data.code || '';
            
            if (code) {
                this.editor.insertAtCursor(code);
                this.quota -= 1;
                this.toast.show('AI code inserted at cursor', 'success');
                this.close();
            } else {
                this.toast.show('AI returned empty response', 'error');
            }
        } catch (err) {
            console.error('AI request failed:', err);
            this.toast.show('AI unavailable — is /api/ai deployed?', 'error');
        } finally {
            this.isGenerating = false;
            this.generateBtn.disabled = false;
            this.generateBtn.textContent = 'Generate';
        }
    }
}


// ============================================================
// SHARE MANAGER
// ============================================================
class ShareManager {
    constructor(state, toast) {
        this.state = state;
        this.toast = toast;
        this.modal = $('share-modal');
        this.urlInput = $('share-url');
        this.copyBtn = $('btn-copy-link');
        
        this.bindEvents();
    }
    
    bindEvents() {
        $('btn-share').addEventListener('click', () => this.open());
        $('btn-share-close').addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
        
        $('btn-generate-link').addEventListener('click', () => this.generate());
        this.copyBtn.addEventListener('click', () => this.copy());
    }
    
    open() {
        this.modal.classList.add('open');
        this.modal.setAttribute('aria-hidden', 'false');
    }
    
    close() {
        this.modal.classList.remove('open');
        this.modal.setAttribute('aria-hidden', 'true');
    }
    
    generate() {
        try {
            const files = this.state.getAllContent();
            const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(files));
            const url = `${location.origin}${location.pathname}#code=${compressed}`;
            
            this.urlInput.value = url;
            this.copyBtn.disabled = false;
            this.toast.show('Share link generated', 'success');
        } catch (err) {
            console.error('Share generation failed:', err);
            this.toast.show('Failed to generate link', 'error');
        }
    }
    
    async copy() {
        const url = this.urlInput.value;
        if (!url) return;
        
        try {
            await navigator.clipboard.writeText(url);
            this.toast.show('Link copied to clipboard', 'success');
        } catch (err) {
            this.urlInput.select();
            document.execCommand('copy');
            this.toast.show('Link copied', 'success');
        }
    }
    
    loadFromHash() {
        const hash = location.hash;
        if (!hash.startsWith('#code=')) return false;
        
        try {
            const encoded = hash.substring(6);
            const decompressed = LZString.decompressFromEncodedURIComponent(encoded);
            if (!decompressed) return false;
            
            const files = JSON.parse(decompressed);
            
            this.state.files.clear();
            Object.entries(files).forEach(([name, content]) => {
                this.state.setFile(name, content);
            });
            
            this.state.activeFile = Object.keys(files)[0] || 'index.html';
            this.state.openTabs = [this.state.activeFile];
            this.state.save();
            
            return true;
        } catch (err) {
            console.warn('Failed to load shared code:', err);
            return false;
        }
    }
}


// ============================================================
// GESTURES
// ============================================================
class GestureHandler {
    constructor() {
        this.startX = 0;
        this.startY = 0;
        this.threshold = 60;
        this.init();
    }
    
    init() {
        if (!('ontouchstart' in window)) return;
        
        const workspace = $('workspace');
        
        workspace.addEventListener('touchstart', (e) => {
            this.startX = e.touches[0].clientX;
            this.startY = e.touches[0].clientY;
        }, { passive: true });
        
        workspace.addEventListener('touchend', (e) => {
            const deltaX = e.changedTouches[0].clientX - this.startX;
            const deltaY = e.changedTouches[0].clientY - this.startY;
            
            if (Math.abs(deltaX) > this.threshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
                const body = document.body;
                body.classList.add('mobile-view');
                
                if (deltaX > 0) {
                    body.classList.add('show-code');
                    body.classList.remove('show-preview');
                } else {
                    body.classList.add('show-preview');
                    body.classList.remove('show-code');
                }
            }
        }, { passive: true });
    }
}


// ============================================================
// BOOTSTRAP
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🪶 Wrenna booting...');
    
    const toast = new Toast();
    const state = new State();
    
    // Check for shared code in URL
    const share = new ShareManager(state, toast);
    share.loadFromHash();
    
    // File manager
    const fileManager = new FileManager(state, toast);
    
    // Preview manager
    const preview = new PreviewManager(state, toast);
    
    // Ad manager
    const ads = new AdManager();
    
    // Connect preview state to ads
    preview.onStateChange = (previewState) => {
        if (previewState === 'empty') {
            ads.onPreviewEmpty();
        } else {
            ads.onPreviewActive();
        }
    };
    
    // CodeMirror — THE CRITICAL PIECE
    try {
        const editor = new CodeMirrorManager(state);
        editor.init($('editor-container'));
        
        // Wire up content changes
        const debouncedSave = Utils.debounce(() => state.save(), CONFIG.SAVE_DEBOUNCE);
        const debouncedRender = Utils.debounce(() => {
            if (state.livePreview) preview.render();
        }, CONFIG.LIVE_DEBOUNCE);
        
        editor.onContentChange = (content) => {
            state.setFile(state.activeFile, content);
            editor.updateFileStatus(state.activeFile, content);
            debouncedSave();
            debouncedRender();
        };
        
        editor.onRun = () => {
            preview.render();
        };
        
        fileManager.onFileOpen = (filename) => {
            editor.openFile(filename);
            if (state.livePreview) preview.render();
        };
        
        // AI Manager
        const ai = new AIManager(state, toast, editor);
        
        // Run button
        $('btn-run').addEventListener('click', () => {
            state.setFile(state.activeFile, editor.getContent());
            state.save();
            preview.render();
        });
        
        // Live toggle
        $('btn-live').addEventListener('click', (e) => {
            state.livePreview = !state.livePreview;
            const btn = e.currentTarget;
            btn.classList.toggle('active', state.livePreview);
            btn.setAttribute('aria-pressed', String(state.livePreview));
            
            const liveEl = $('status-live');
            liveEl.style.opacity = state.livePreview ? '1' : '0.3';
            
            toast.show(state.livePreview ? 'Live preview on' : 'Live preview off', 'info', 1500);
        });
        
        // Import button
        $('btn-import').addEventListener('click', () => {
            fileManager.openLocalFiles();
        });
        
        // Keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                state.setFile(state.activeFile, editor.getContent());
                state.save();
                preview.render();
            }
        });
        
        // Open initial file
        editor.openFile(state.activeFile);
        preview.render();
        
        // Gestures
        new GestureHandler();
        
        // Debug handle
        window.Wrenna = { state, editor, preview, toast, fileManager, ai, share, ads };
        
        console.log('✅ Wrenna ready');
        
    } catch (err) {
        console.error('❌ Wrenna failed to initialize:', err);
        
        // Show a visible error in the UI
        const container = $('editor-container');
        container.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;padding:24px;text-align:center;">
                <p style="color:#e8734a;font-weight:600;">Editor failed to load</p>
                <p style="color:rgba(242,234,217,0.5);font-size:0.85rem;">${err.message}</p>
                <p style="color:rgba(242,234,217,0.3);font-size:0.75rem;">
                    Make sure you're serving via HTTP (not file://) and your internet connection allows esm.sh CDN access.
                </p>
            </div>
        `;
    }
});
