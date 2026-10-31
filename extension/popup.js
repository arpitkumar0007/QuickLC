'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEMPLATES_KEY = 'templates';
const SETTINGS_KEY = 'settings';
const LEETCODE_URL_RE = /^https:\/\/(?:[\w-]+\.)?leetcode\.(?:com|cn)\//;
const LEETCODE_TAB_PATTERNS = ['https://leetcode.com/*', 'https://leetcode.cn/*'];
const MONACO_BASE = 'vendor/monaco-editor/min/vs';
const MONACO_TIMEOUT_MS = 8000;

const params = new URLSearchParams(location.search);
// The same page runs as the toolbar popup and as a full tab ("?tab=1").
const IS_TAB_MODE = params.has('tab');

const LANGUAGES = {
  cpp:        { label: 'C++',        monaco: 'cpp',        ext: '.cpp' },
  c:          { label: 'C',          monaco: 'cpp',        ext: '.c' },
  java:       { label: 'Java',       monaco: 'java',       ext: '.java' },
  python:     { label: 'Python',     monaco: 'python',     ext: '.py' },
  javascript: { label: 'JavaScript', monaco: 'javascript', ext: '.js' },
  typescript: { label: 'TypeScript', monaco: 'typescript', ext: '.ts' },
  go:         { label: 'Go',         monaco: 'go',         ext: '.go' },
  rust:       { label: 'Rust',       monaco: 'rust',       ext: '.rs' },
  csharp:     { label: 'C#',         monaco: 'csharp',     ext: '.cs' },
  kotlin:     { label: 'Kotlin',     monaco: 'kotlin',     ext: '.kt' },
  swift:      { label: 'Swift',      monaco: 'swift',      ext: '.swift' }
};
const DEFAULT_LANGUAGE = 'cpp';

// Monaco language ids LeetCode may report, mapped to our language keys.
const EDITOR_LANGUAGE_ALIASES = {
  cpp: 'cpp', 'c++': 'cpp', c: 'c',
  java: 'java',
  python: 'python', python3: 'python',
  javascript: 'javascript', typescript: 'typescript',
  go: 'go', golang: 'go',
  rust: 'rust',
  csharp: 'csharp', 'c#': 'csharp',
  kotlin: 'kotlin', swift: 'swift'
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  templates: [],
  currentId: null,
  settings: { insertMode: 'top', lastTemplateId: null },
  editingId: null,      // id of the template being edited, null for "new"
  formSnapshot: null,   // form values when it opened, used for the unsaved-changes check
  viewEditor: null,
  formEditor: null
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function readTemplates() {
  const data = await chrome.storage.local.get(TEMPLATES_KEY);
  const list = data[TEMPLATES_KEY];
  return Array.isArray(list) ? list.filter(isValidTemplate) : [];
}

function writeTemplates(list) {
  return chrome.storage.local.set({ [TEMPLATES_KEY]: list });
}

async function readSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...state.settings, ...(data[SETTINGS_KEY] || {}) };
}

function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  return chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
}

function isValidTemplate(t) {
  return t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.code === 'string';
}

function normalizeLanguage(lang) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, lang) ? lang : DEFAULT_LANGUAGE;
}

function newId() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Code editors (Monaco, with a plain textarea fallback)
// ---------------------------------------------------------------------------

function loadMonaco() {
  return new Promise((resolve) => {
    const amdRequire = window.require;
    if (typeof amdRequire !== 'function' || typeof amdRequire.config !== 'function') {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(false), MONACO_TIMEOUT_MS);
    // Load workers straight from the extension. Monaco's default blob-worker
    // wrapper cannot importScripts() chrome-extension:// URLs.
    window.MonacoEnvironment = {
      getWorkerUrl: () => chrome.runtime.getURL(`${MONACO_BASE}/base/worker/workerMain.js`)
    };
    amdRequire.config({ paths: { vs: chrome.runtime.getURL(MONACO_BASE) } });
    amdRequire(
      ['vs/editor/editor.main'],
      () => { clearTimeout(timer); resolve(Boolean(window.monaco)); },
      (err) => {
        clearTimeout(timer);
        console.warn('QuickLC: Monaco failed to load, using plain editor.', err);
        resolve(false);
      }
    );
  });
}

function createMonacoEditor(container, { readOnly }) {
  const editor = monaco.editor.create(container, {
    value: '',
    language: LANGUAGES[DEFAULT_LANGUAGE].monaco,
    theme: 'vs-dark',
    readOnly,
    domReadOnly: readOnly,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 4,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderLineHighlight: readOnly ? 'none' : 'line',
    padding: { top: 10 }
  });
  return {
    getValue: () => editor.getValue(),
    setValue: (value) => editor.setValue(value),
    setLanguage: (lang) => monaco.editor.setModelLanguage(editor.getModel(), LANGUAGES[normalizeLanguage(lang)].monaco),
    focus: () => editor.focus(),
    layout: () => editor.layout()
  };
}

function createTextareaEditor(container, { readOnly }) {
  const textarea = document.createElement('textarea');
  textarea.className = 'fallback-editor';
  textarea.spellcheck = false;
  textarea.readOnly = readOnly;
  textarea.placeholder = readOnly ? '' : 'Paste or type your template code here...';
  textarea.addEventListener('keydown', (e) => {
    // Indent with Tab instead of moving focus.
    if (e.key === 'Tab' && !e.shiftKey && !readOnly) {
      e.preventDefault();
      textarea.setRangeText('    ', textarea.selectionStart, textarea.selectionEnd, 'end');
    }
  });
  container.appendChild(textarea);
  return {
    getValue: () => textarea.value,
    setValue: (value) => { textarea.value = value; },
    setLanguage: () => {},
    focus: () => textarea.focus(),
    layout: () => {}
  };
}

async function initEditors() {
  const hasMonaco = await loadMonaco();
  const create = hasMonaco ? createMonacoEditor : createTextareaEditor;
  const pendingFormValue = $('formEditor').dataset.pending;

  state.viewEditor = create($('viewEditor'), { readOnly: true });
  state.formEditor = create($('formEditor'), { readOnly: false });

  // Fill editors with whatever was opened before they were ready.
  const current = getCurrentTemplate();
  if (current) renderCurrentTemplate();
  if (!$('formView').hidden) {
    state.formEditor.setValue(pendingFormValue || '');
    state.formEditor.setLanguage($('tplLanguage').value);
    state.formSnapshot = readFormValues();
  }
}

// ---------------------------------------------------------------------------
// Template list
// ---------------------------------------------------------------------------

function getCurrentTemplate() {
  return state.templates.find((t) => t.id === state.currentId) || null;
}

function getFilteredTemplates() {
  const query = $('searchInput').value.trim().toLowerCase();
  const sorted = [...state.templates].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (!query) return sorted;
  return sorted.filter((t) => {
    const lang = LANGUAGES[normalizeLanguage(t.language)];
    return t.name.toLowerCase().includes(query) ||
      lang.label.toLowerCase() === query ||
      t.language === query;
  });
}

function renderTemplatesList() {
  const container = $('templatesList');
  const list = getFilteredTemplates();
  container.replaceChildren();

  if (!state.templates.length) {
    container.innerHTML = '<div class="empty-state">No templates yet.<br>Click + to create one.</div>';
    return;
  }
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No matching templates.</div>';
    return;
  }

  for (const template of list) {
    const lang = LANGUAGES[normalizeLanguage(template.language)];
    const item = document.createElement('div');
    item.className = 'template-item';
    item.dataset.templateId = template.id;
    item.title = template.name;
    item.classList.toggle('active', template.id === state.currentId);
    item.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>
      </svg>
      <span class="template-name"></span>
      <span class="template-lang"></span>
      <button class="delete-btn" title="Delete template">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>`;
    item.querySelector('.template-name').textContent = template.name;
    item.querySelector('.template-lang').textContent = lang.label;

    item.addEventListener('click', (e) => {
      if (!e.target.closest('.delete-btn')) selectTemplate(template.id);
    });
    item.addEventListener('dblclick', (e) => {
      if (!e.target.closest('.delete-btn')) insertCurrentTemplate();
    });
    item.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTemplate(template.id);
    });
    container.appendChild(item);
  }
}

function selectTemplate(id) {
  if (!state.templates.some((t) => t.id === id)) return;
  if (!$('formView').hidden && !closeForm()) return;
  state.currentId = id;
  updateSettings({ lastTemplateId: id });

  document.querySelectorAll('.template-item').forEach((item) => {
    const active = item.dataset.templateId === id;
    item.classList.toggle('active', active);
    if (active) item.scrollIntoView({ block: 'nearest' });
  });
  renderCurrentTemplate();
}

function clearSelection() {
  state.currentId = null;
  renderCurrentTemplate();
  renderTemplatesList();
}

function renderCurrentTemplate() {
  const template = getCurrentTemplate();
  $('welcomeScreen').hidden = Boolean(template);
  $('editorContainer').hidden = !template;
  $('welcomeText').textContent = state.templates.length
    ? 'Select a template from the sidebar to view and insert it.'
    : 'No templates yet. Create one, or import a JSON backup.';
  if (!template) return;

  const lang = LANGUAGES[normalizeLanguage(template.language)];
  $('tabName').textContent = template.name + lang.ext;
  if (state.viewEditor) {
    state.viewEditor.setValue(template.code);
    state.viewEditor.setLanguage(template.language);
    requestAnimationFrame(() => state.viewEditor.layout());
  }
}

function moveSelection(delta) {
  const list = getFilteredTemplates();
  if (!list.length) return;
  const index = list.findIndex((t) => t.id === state.currentId);
  const next = index === -1 ? 0 : Math.min(list.length - 1, Math.max(0, index + delta));
  selectTemplate(list[next].id);
}

function onSearchInput() {
  renderTemplatesList();
  const list = getFilteredTemplates();
  // Keep the preview on a visible result so Enter inserts what the user sees.
  if ($('formView').hidden && list.length && !list.some((t) => t.id === state.currentId)) {
    selectTemplate(list[0].id);
  }
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------

function readFormValues() {
  return {
    name: $('tplName').value.trim(),
    language: $('tplLanguage').value,
    code: state.formEditor ? state.formEditor.getValue() : ($('formEditor').dataset.pending || '')
  };
}

function isFormDirty() {
  if (!state.formSnapshot) return false;
  const now = readFormValues();
  return now.name !== state.formSnapshot.name ||
    now.language !== state.formSnapshot.language ||
    now.code !== state.formSnapshot.code;
}

function openForm(template = null) {
  state.editingId = template ? template.id : null;
  $('formTitle').textContent = template ? 'Edit Template' : 'New Template';
  $('saveBtn').textContent = template ? 'Save changes' : 'Save template';
  $('tplName').value = template ? template.name : '';
  const lastLanguage = getCurrentTemplate()?.language;
  $('tplLanguage').value = normalizeLanguage(template ? template.language : lastLanguage);
  const code = template ? template.code : '';

  $('formView').hidden = false;
  if (state.formEditor) {
    state.formEditor.setValue(code);
    state.formEditor.setLanguage($('tplLanguage').value);
    requestAnimationFrame(() => state.formEditor.layout());
  } else {
    $('formEditor').dataset.pending = code;
  }
  state.formSnapshot = readFormValues();

  if (template && state.formEditor) state.formEditor.focus();
  else $('tplName').focus();
}

/** Closes the form. Returns false if the user chose to keep editing. */
function closeForm({ force = false } = {}) {
  if ($('formView').hidden) return true;
  if (!force && isFormDirty() && !confirm('Discard unsaved changes?')) return false;
  $('formView').hidden = true;
  state.editingId = null;
  state.formSnapshot = null;
  return true;
}

async function saveForm() {
  const { name, language, code } = readFormValues();
  if (!name) {
    toast('Template name is required.', 'error');
    $('tplName').focus();
    return;
  }
  if (!code.trim()) {
    toast('Template code is empty.', 'error');
    state.formEditor?.focus();
    return;
  }

  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    const now = Date.now();
    const templates = await readTemplates();
    let id = state.editingId;
    if (id) {
      const existing = templates.find((t) => t.id === id);
      if (!existing) throw new Error('This template no longer exists.');
      Object.assign(existing, { name, language, code, updatedAt: now });
    } else {
      id = newId();
      templates.push({ id, name, language, code, createdAt: now, updatedAt: now });
    }
    await writeTemplates(templates);
    state.templates = templates;
    closeForm({ force: true });
    renderTemplatesList();
    selectTemplate(id);
    toast('Template saved.', 'success');
  } catch (e) {
    toast(`Could not save: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteTemplate(id) {
  const template = state.templates.find((t) => t.id === id);
  if (!template) return;
  if (!confirm(`Delete "${template.name}"? This cannot be undone.`)) return;
  try {
    const templates = (await readTemplates()).filter((t) => t.id !== id);
    await writeTemplates(templates);
    state.templates = templates;
    if (state.currentId === id) clearSelection();
    else renderTemplatesList();
    toast('Template deleted.');
  } catch (e) {
    toast(`Could not delete: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Inserting into LeetCode
// ---------------------------------------------------------------------------

async function findLeetCodeTab() {
  if (IS_TAB_MODE) {
    // Opened as a full tab: target the LeetCode tab the user used most recently.
    const tabs = await chrome.tabs.query({ url: LEETCODE_TAB_PATTERNS });
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs[0] || null;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && LEETCODE_URL_RE.test(tab.url || '') ? tab : null;
}

async function insertCurrentTemplate() {
  const template = getCurrentTemplate();
  if (!template) return;
  const btn = $('insertBtn');
  btn.disabled = true;
  try {
    const tab = await findLeetCodeTab();
    if (!tab) {
      toast('Open a LeetCode problem in this tab first.', 'error');
      return;
    }
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN', // LeetCode's `monaco` global lives in the page's own JS world.
      func: insertIntoLeetCodeEditor,
      args: [template.code, state.settings.insertMode]
    });
    const result = injection && injection.result;
    if (!result || !result.ok) {
      toast((result && result.error) || 'Insert failed.', 'error');
      return;
    }

    const warning = languageMismatchWarning(template.language, result.language);
    if (warning) {
      // Keep the popup open so the warning is visible. Ctrl+Z in LeetCode undoes the insert.
      toast(warning, 'warning', 6000);
      return;
    }
    if (IS_TAB_MODE) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      window.close();
    }
  } catch (e) {
    toast(`Insert failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function languageMismatchWarning(templateLang, editorLangId) {
  const editorLang = EDITOR_LANGUAGE_ALIASES[String(editorLangId || '').toLowerCase()];
  if (!editorLang || editorLang === templateLang) return null;
  const cFamily = ['c', 'cpp'];
  if (cFamily.includes(editorLang) && cFamily.includes(templateLang)) return null;
  return `Inserted, but this template is ${LANGUAGES[normalizeLanguage(templateLang)].label} ` +
    `and the LeetCode editor is set to ${LANGUAGES[editorLang].label}. Press Ctrl+Z in LeetCode to undo.`;
}

/**
 * Runs inside the LeetCode page (MAIN world). Must be self-contained: it is
 * serialized by chrome.scripting and cannot reference anything outside itself.
 * @returns {Promise<{ok: boolean, error?: string, language?: string}>}
 */
function insertIntoLeetCodeEditor(templateCode, mode) {
  const TIMEOUT_MS = 5000;
  const RETRY_MS = 150;

  function findTarget() {
    const m = window.monaco;
    if (!m || !m.editor) return null;
    const editors = typeof m.editor.getEditors === 'function' ? m.editor.getEditors() : [];
    const area = (ed) => {
      const node = ed.getDomNode();
      if (!node || !node.isConnected) return 0;
      const rect = node.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const writable = editors.filter((ed) => {
      if (!ed.getModel() || area(ed) === 0) return false;
      try {
        return !ed.getOption(m.editor.EditorOption.readOnly);
      } catch (e) {
        return true;
      }
    });
    if (writable.length) {
      // The solution editor is the largest writable editor on the page.
      writable.sort((a, b) => area(b) - area(a));
      return { editor: writable[0], model: writable[0].getModel() };
    }
    if (editors.length) return null; // Editors exist but none usable yet; keep waiting.
    const models = m.editor.getModels();
    return models.length ? { editor: null, model: models[0] } : null;
  }

  function insert({ editor, model }) {
    const m = window.monaco;
    let text = templateCode.replace(/\r\n/g, '\n');
    let range;
    const selection = editor && editor.getSelection();
    if (mode === 'cursor' && selection) {
      range = selection;
    } else {
      range = new m.Range(1, 1, 1, 1);
      if (!text.endsWith('\n')) text += '\n';
      if (model.getValue().trim()) text += '\n'; // Blank line between template and existing code.
    }
    const edit = { range, text, forceMoveMarkers: true };

    if (editor) {
      editor.pushUndoStop();
      editor.executeEdits('quicklc', [edit]);
      editor.pushUndoStop();
      const lines = text.split('\n');
      const lineNumber = range.startLineNumber + lines.length - 1;
      const column = lines.length === 1
        ? range.startColumn + lines[0].length
        : lines[lines.length - 1].length + 1;
      editor.setPosition({ lineNumber, column });
      editor.revealPositionInCenterIfOutsideViewport({ lineNumber, column });
      editor.focus();
    } else {
      model.pushEditOperations([], [edit], () => null);
    }
    const language = typeof model.getLanguageId === 'function' ? model.getLanguageId() : undefined;
    return { ok: true, language };
  }

  return new Promise((resolve) => {
    const deadline = Date.now() + TIMEOUT_MS;
    const attempt = () => {
      try {
        const target = findTarget();
        if (target) {
          resolve(insert(target));
          return;
        }
      } catch (e) {
        resolve({ ok: false, error: `Editor error: ${e.message}` });
        return;
      }
      if (Date.now() < deadline) {
        setTimeout(attempt, RETRY_MS);
      } else {
        resolve({ ok: false, error: "Couldn't find the code editor on this page. Open a problem page and try again." });
      }
    };
    attempt();
  });
}

async function copyCurrentTemplate() {
  const template = getCurrentTemplate();
  if (!template) return;
  try {
    await navigator.clipboard.writeText(template.code);
    toast('Copied to clipboard.', 'success');
  } catch (e) {
    toast('Clipboard access was blocked.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

function exportTemplates() {
  if (!state.templates.length) {
    toast('Nothing to export yet.');
    return;
  }
  const payload = {
    app: 'QuickLC',
    version: 1,
    exportedAt: new Date().toISOString(),
    templates: state.templates
  };
  // A data: URL (not a blob: URL) keeps the download valid even if the popup closes.
  const link = document.createElement('a');
  link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
  link.download = `quicklc-templates-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  toast(`Exported ${state.templates.length} template(s).`, 'success');
}

function startImport() {
  if (!IS_TAB_MODE) {
    // A file chooser can close the toolbar popup, so import from a full tab.
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1&import=1') });
    window.close();
    return;
  }
  $('importFile').click();
}

/**
 * Accepts a QuickLC export ({templates: [...]}) or a bare array, including the
 * output of the old backend's GET /templates (which used `_id`).
 */
function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('File is not valid JSON.');
  }
  const items = Array.isArray(data) ? data : data && Array.isArray(data.templates) ? data.templates : null;
  if (!items) throw new Error('No templates found in this file.');
  return items
    .filter((t) => t && typeof t.name === 'string' && t.name.trim() && typeof t.code === 'string')
    .map((t) => {
      const created = Number(new Date(t.createdAt)) || Date.now();
      return {
        id: newId(),
        name: t.name.trim().slice(0, 100),
        language: normalizeLanguage(t.language),
        code: t.code,
        createdAt: created,
        updatedAt: Number(new Date(t.updatedAt)) || created
      };
    });
}

async function importFromFile(file) {
  try {
    const incoming = parseImport(await file.text());
    const templates = await readTemplates();
    const key = (t) => `${t.name}\u0000${t.language}\u0000${t.code}`;
    const existing = new Set(templates.map(key));
    let added = 0;
    for (const t of incoming) {
      if (existing.has(key(t))) continue;
      existing.add(key(t));
      templates.push(t);
      added++;
    }
    await writeTemplates(templates);
    state.templates = templates;
    renderTemplatesList();
    renderCurrentTemplate();
    const skipped = incoming.length - added;
    toast(`Imported ${added} template(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ''}.`, 'success');
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

let toastTimer = null;

function toast(message, type = 'info', duration = 3000) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function populateLanguageSelect() {
  const select = $('tplLanguage');
  for (const [value, { label }] of Object.entries(LANGUAGES)) {
    select.add(new Option(label, value));
  }
}

function setupEventListeners() {
  $('searchInput').addEventListener('input', onSearchInput);
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); insertCurrentTemplate(); }
  });

  $('addTemplateBtn').addEventListener('click', () => openForm());
  $('welcomeAddBtn').addEventListener('click', () => openForm());
  $('editBtn').addEventListener('click', () => {
    const template = getCurrentTemplate();
    if (template) openForm(template);
  });
  $('copyBtn').addEventListener('click', copyCurrentTemplate);
  $('insertBtn').addEventListener('click', insertCurrentTemplate);
  $('insertMode').addEventListener('change', (e) => updateSettings({ insertMode: e.target.value }));

  $('closeFormBtn').addEventListener('click', () => closeForm());
  $('cancelBtn').addEventListener('click', () => closeForm());
  $('saveBtn').addEventListener('click', saveForm);
  $('tplLanguage').addEventListener('change', (e) => state.formEditor?.setLanguage(e.target.value));

  $('exportBtn').addEventListener('click', exportTemplates);
  $('importBtn').addEventListener('click', startImport);
  $('importFile').addEventListener('change', (e) => {
    const [file] = e.target.files;
    if (file) importFromFile(file);
    e.target.value = '';
  });

  $('openTabBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') });
    window.close();
  });

  // Bubble phase: Monaco stops propagation for keys it handles itself (e.g. Esc in its widgets).
  document.addEventListener('keydown', (e) => {
    const formOpen = !$('formView').hidden;
    const mod = e.ctrlKey || e.metaKey;
    if (formOpen && mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveForm();
    } else if (formOpen && e.key === 'Escape') {
      e.preventDefault();
      closeForm();
    } else if (!formOpen && mod && e.key === 'Enter') {
      e.preventDefault();
      insertCurrentTemplate();
    }
  });

  // Keep the popup and a full-tab instance in sync.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[TEMPLATES_KEY]) return;
    const list = changes[TEMPLATES_KEY].newValue;
    state.templates = Array.isArray(list) ? list.filter(isValidTemplate) : [];
    if (!getCurrentTemplate()) state.currentId = null;
    renderTemplatesList();
    renderCurrentTemplate();
  });
}

async function init() {
  if (IS_TAB_MODE) document.body.classList.add('tab-mode');
  populateLanguageSelect();
  setupEventListeners();
  const editorsReady = initEditors();

  try {
    [state.settings, state.templates] = await Promise.all([readSettings(), readTemplates()]);
  } catch (e) {
    toast(`Could not load templates: ${e.message}`, 'error');
  }
  $('insertMode').value = state.settings.insertMode === 'cursor' ? 'cursor' : 'top';
  if (state.templates.some((t) => t.id === state.settings.lastTemplateId)) {
    state.currentId = state.settings.lastTemplateId;
  }
  renderTemplatesList();
  renderCurrentTemplate();
  $('searchInput').focus();

  if (params.has('import')) {
    toast('Click the import button to choose a JSON file.', 'info', 6000);
    $('importBtn').classList.add('pulse');
  }
  await editorsReady;
}

document.addEventListener('DOMContentLoaded', init);
