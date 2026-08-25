/**
 * WRENNA — app.js (v3 — FIXED null crashes)
 * Every DOM lookup is now null-safe. The previous version
 * crashed on $('btn-live') which killed the whole module.
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

// ============================================================
// SAFE DOM HELPER — this prevents the crash entirely
// ============================================================
const $ = (id) => document.getElementById(id);
const safeListen = (id, event, handler) => {
    const el = $(id);
    if (el) {
        el.addEventListener(event, handler);
    } else {
        console.warn(`⚠ Wrenna: element "${id}" not found — skipping listener`);
    }
    return el;
};

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    LIVE_DEBOUNCE: 500,
    SAVE_DEBOUNCE: 1000,
    AI_MAX_FREE: 10,
    AD_COOLDOWN_MS: 90 * 1000,
    KEYS: {
        DRAFTS: 'wrenna_drafts',
        ACTIVE: 'wrenna_active_draft',
        AI_QUOTA: 'wrenna_ai_quota',
        AI_DATE: 'wrenna_ai_date'
    }
};

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
        if (!this.container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        this.container.appendChild(toast);
        const timer = setTimeout(() => this.close(toast), duration);
        toast.addEventListener('click', () => { clearTimeout(timer); this.close(toast); });
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
        } catch (e) { console.warn('Load failed:', e); }
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
        } catch (e) { console.warn('Save failed:', e); }
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
        safeListen('btn-file-tree', 'click', () => this.toggleTree());
        safeListen('btn-file-tree-close', 'click', () => this.toggleTree(false));
        safeListen('btn-new-file', 'click', () => this.createNewFile());
        safeListen('btn-tab-new', 'click', () => this.createNewFile());
        safeListen('btn-open-folder', 'click', () => this.openLocalFiles());
        safeListen('btn-import', 'click', () => this.openLocalFiles());
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.renderTree());
        }
        if (this.tabsEl) {
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
    }
    toggleTree(force) {
        const tree = $('file-tree');
        if (!tree) return;
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
        if (!this.treeBody) return;
        const query = this.searchInput ? this.searchInput.value.toLowerCase() : '';
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
        if (!this.tabsEl) return;
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
// CODEMIRROR MANAGER
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
        const extensions = [
            basicSetup,
            keymap.of([{
                key: 'Mod-Enter',
                run: () => { if (this.onRun) this.onRun(); return true; }
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
        if (!file || !this.view) return;
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: file.content },
            effects: this.langCompartment.reconfigure(this.getLangExtension(filename))
        });
        const welcome = $('editor-welcome');
        if (welcome) welcome.classList.add('hidden');
        this.updateStatus();
        this.updateFileStatus(filename, file.content);
    }
    setContent(content) {
        if (!this.view) return;
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: content }
        });
    }
    getContent() {
        return this.view ? this.view.state.doc.toString() : '';
    }
    getSelectedText() {
        if (!this.view) return '';
        const sel = this.view.state.selection.main;
        if (sel.empty) return '';
        return this.view.state.doc.sliceString(sel.from, sel.to);
    }
    insertAtCursor(text) {
        if (!this.view) return;
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
        const posEl = $('status-pos');
        if (posEl) posEl.textContent = `Ln ${line.number}, Col ${sel.head - line.from + 1}`;
    }
    updateFileStatus(filename, content) {
        const langEl = $('status-lang');
        const sizeEl = $('status-size');
        if (langEl) langEl.textContent = Utils.langLabel(Utils.langFromFilename(filename));
        if (sizeEl) sizeEl.textContent = Utils.formatBytes(new Blob([content]).size);
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
        safeListen('btn-refresh', 'click', () => {
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
            if (el) el.classList.toggle('active', name === device);
        });
        if (!this.isEmpty) this.render();
    }
    buildDocument() {
        const files = this.state.getAllContent();
        let doc = files['index.html'] || '';
        let css = '';
        let js = '';
        Object.entries(files).forEach(([name, content]) => {
            if (name.endsWith('.css')) css += `\n${content}`;
        });
        Object.entries(files).forEach(([name, content]) => {
            if (name.endsWith('.js') || name.endsWith('.mjs')) js += `\n${content}`;
        });
        if (css && doc.includes('</head>')) {
            doc = doc.replace('</head>', `<style>${css}</style></head>`);
        }
        if (js && doc.includes('</body>')) {
            doc = doc.replace('</body>', `<script>${js}<\/script></body>`);
        }
        return doc;
    }
    render() {
        const content = this.buildDocument();
        const stripped = content.replace(/<!--[\s\S]*?-->/g, '').trim();
        if (!stripped) {
            this.showEmpty();
            return;
        }
        this.hideEmpty();
        Object.values(this.iframes).forEach(iframe => {
            if (iframe) iframe.srcdoc = content;
        });
    }
    showEmpty() {
        this.isEmpty = true;
        const empty = $('preview-empty');
        if (empty) empty.classList.remove('hidden');
        if (this.onStateChange) this.onStateChange('empty');
    }
    hideEmpty() {
        this.isEmpty = false;
        const empty = $('preview-empty');
        if (empty) empty.classList.add('hidden');
        if (this.onStateChange) this.onStateChange('active');
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
        if (this.quotaEl) this.quotaEl.textContent = `${this.quota} left today`;
    }
    bindEvents() {
        safeListen('btn-ai', 'click', () => this.open());
        safeListen('btn-ai-close', 'click', () => this.close());
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) this.close();
            });
        }
        document.querySelectorAll('.chip').forEach(chip => {
            chip.addEventListener('click', () => {
                if (this.promptEl) {
                    this.promptEl.value = chip.dataset.prompt;
                    this.promptEl.focus();
                }
            });
        });
        safeListen('btn-ai-generate', 'click', () => this.generate());
    }
    open() {
        if (!this.modal) return;
        const selected = this.editor.getSelectedText();
        if (this.contextEl) this.contextEl.textContent = selected || '// Select code for context';
        this.modal.classList.add('open');
        this.modal.setAttribute('aria-hidden', 'false');
        if (this.promptEl) this.promptEl.focus();
    }
    close() {
        if (!this.modal) return;
        this.modal.classList.remove('open');
        this.modal.setAttribute('aria-hidden', 'true');
    }
    async generate() {
        if (this.isGenerating) return;
        const prompt = this.promptEl ? this.promptEl.value.trim() : '';
        if (!prompt) {
            this.toast.show('Please enter a prompt', 'error');
            return;
        }
        if (this.quota <= 0) {
            this.toast.show('Daily AI limit reached. Upgrade to Pro for unlimited.', 'error');
            return;
        }
        this.isGenerating = true;
        if (this.generateBtn) {
            this.generateBtn.disabled = true;
            this.generateBtn.textContent = 'Generating...';
        }
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
            this.toast.show('AI unavailable — deploy /api/ai function', 'error');
        } finally {
            this.isGenerating = false;
            if (this.generateBtn) {
                this.generateBtn.disabled = false;
                this.generateBtn.textContent = 'Generate';
            }
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
        safeListen('btn-share', 'click', () => this.open());
        safeListen('btn-share-close', 'click', () => this.close());
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) this.close();
            });
        }
        safeListen('btn-generate-link', 'click', () => this.generate());
        safeListen('btn-copy-link', 'click', () => this.copy());
    }
    open() {
        if (!this.modal) return;
        this.modal.classList.add('open');
        this.modal.setAttribute('aria-hidden', 'false');
    }
    close() {
        if (!this.modal) return;
        this.modal.classList.remove('open');
        this.modal.setAttribute('aria-hidden', 'true');
    }
    generate() {
        try {
            const files = this.state.getAllContent();
            const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(files));
            const url = `${location.origin}${location.pathname}#code=${compressed}`;
            if (this.urlInput) this.urlInput.value = url;
            if (this.copyBtn) this.copyBtn.disabled = false;
            this.toast.show('Share link generated', 'success');
        } catch (err) {
            console.error('Share generation failed:', err);
            this.toast.show('Failed to generate link', 'error');
        }
    }
    async copy() {
        const url = this.urlInput ? this.urlInput.value : '';
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            this.toast.show('Link copied to clipboard', 'success');
        } catch (err) {
            if (this.urlInput) this.urlInput.select();
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
// BOOTSTRAP
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🪶 Wrenna v3 booting...');
    try {
        const toast = new Toast();
        const state = new State();

        const share = new ShareManager(state, toast);
        share.loadFromHash();

        const fileManager = new FileManager(state, toast);
        const preview = new PreviewManager(state, toast);

        const editor = new CodeMirrorManager(state);
        editor.init($('editor-container'));

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
        editor.onRun = () => preview.render();
        fileManager.onFileOpen = (filename) => {
            editor.openFile(filename);
            if (state.livePreview) preview.render();
        };

        const ai = new AIManager(state, toast, editor);

        safeListen('btn-run', 'click', () => {
            state.setFile(state.activeFile, editor.getContent());
            state.save();
            preview.render();
        });

        // Live toggle — null-safe now
        const liveBtn = $('btn-live');
        if (liveBtn) {
            liveBtn.addEventListener('click', (e) => {
                state.livePreview = !state.livePreview;
                liveBtn.classList.toggle('active', state.livePreview);
                liveBtn.setAttribute('aria-pressed', String(state.livePreview));
                const liveEl = $('status-live');
                if (liveEl) liveEl.style.opacity = state.livePreview ? '1' : '0.3';
                toast.show(state.livePreview ? 'Live preview on' : 'Live preview off', 'info', 1500);
            });
        }

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                state.setFile(state.activeFile, editor.getContent());
                state.save();
                preview.render();
            }
        });

        editor.openFile(state.activeFile);
        preview.render();

        console.log('✅ Wrenna v3 ready');
        window.Wrenna = { state, editor, preview, toast, fileManager, ai, share };

    } catch (err) {
        console.error('❌ Wrenna failed to initialize:', err);
        const container = $('editor-container');
        if (container) {
            container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:12px;padding:24px;text-align:center;font-family:sans-serif;">
                <p style="color:#e8734a;font-weight:600;">Editor failed to load</p>
                <p style="color:rgba(242,234,217,0.5);font-size:0.85rem;">${err.message}</p>
            </div>`;
        }
    }
});
