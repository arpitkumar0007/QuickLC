const API_URL = "http://localhost:5000/templates";


let templates = [];
let currentTemplate = null;
let viewEditor = null;
let formEditor = null;
let monacoLoaded = false;


const languageConfig = {
  cpp: { monaco: 'cpp', ext: '.cpp' },
  python: { monaco: 'python', ext: '.py' },
  java: { monaco: 'java', ext: '.java' },
  javascript: { monaco: 'javascript', ext: '.js' },
  typescript: { monaco: 'typescript', ext: '.ts' },
  go: { monaco: 'go', ext: '.go' },
  rust: { monaco: 'rust', ext: '.rs' }
};


document.addEventListener('DOMContentLoaded', function() {
  setupEventListeners();
  loadTemplates();
  initializeMonaco();
});


function setupEventListeners() {
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = templates.filter(t => t.name.toLowerCase().includes(query));
    renderTemplatesList(filtered);
  });

  document.getElementById('addTemplateBtn').addEventListener('click', showAddForm);
  document.getElementById('reloadBtn').addEventListener('click', loadTemplates);
  document.getElementById('insertBtn').addEventListener('click', insertCurrentTemplate);


document.getElementById('languageSelect').addEventListener('change', (e) => {
  if (currentTemplate && viewEditor && monacoLoaded) {
    const lang = e.target.value;
    monaco.editor.setModelLanguage(viewEditor.getModel(), languageConfig[lang].monaco);
  }
});


  document.getElementById('closeFormBtn').addEventListener('click', hideForm);
  document.getElementById('cancelBtn').addEventListener('click', hideForm);
  document.getElementById('saveBtn').addEventListener('click', saveTemplate);

  document.getElementById('tplLanguage').addEventListener('change', (e) => {
  if (formEditor && monacoLoaded) {
    const lang = e.target.value;
    monaco.editor.setModelLanguage(formEditor.getModel(), languageConfig[lang].monaco);
  }
});
}



function initializeMonaco() {

  if (typeof window.monaco !== 'undefined' && monacoLoaded) {
    onMonacoLoaded();
    return;
  }


  if (typeof require === 'undefined') {
    const waitReq = setInterval(() => {
      if (typeof require !== 'undefined') {
        clearInterval(waitReq);
        require.config({
        paths: {
          'vs': chrome.runtime.getURL('vendor/monaco-editor/min/vs')
        }
      });
        require(['vs/editor/editor.main'], onMonacoLoaded);
      }
    }, 50);

    setTimeout(() => clearInterval(waitReq), 5000);
    return;
  }

  require.config({
  paths: {
    'vs': chrome.runtime.getURL('vendor/monaco-editor/min/vs')
  }
});
  require(['vs/editor/editor.main'], onMonacoLoaded);
}


require.config({
  paths: {
    'vs': chrome.runtime.getURL('vendor/monaco-editor/min/vs')
  }
});

require(['vs/editor/editor.main'], function () {
  monaco.editor.create(document.getElementById('formEditor'), {
    value: "// Start coding...",
    language: "cpp",
    theme: "vs-dark"
  });
});


function onMonacoLoaded() {
  if (monacoLoaded) return;

 
  const viewModel = monaco.editor.createModel('', 'cpp');
  viewEditor = monaco.editor.create(document.getElementById('monacoEditor'), {
    model: viewModel,
    theme: 'vs-dark',
    readOnly: true,
    minimap: { enabled: false },
    fontSize: 13,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 10 }
  });



  const formModel = monaco.editor.createModel('', 'cpp');
  formEditor = monaco.editor.create(document.getElementById('formEditor'), {
    model: formModel,
    theme: 'vs-dark',
    minimap: { enabled: false },
    fontSize: 13,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 10 }
  });

  monacoLoaded = true;


  if (currentTemplate) selectTemplate(currentTemplate, true);
}



async function loadTemplates() {
  const listContainer = document.getElementById('templatesList');
  listContainer.innerHTML = '<div class="loading">Loading templates...</div>';

  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Server responded with status ${res.status}`);
    templates = await res.json();
    renderTemplatesList(templates);
  } 
  catch (e) {
    listContainer.innerHTML = '<div class="empty-state">Failed to load.<br>Is the backend running?</div>';
  }
}




function renderTemplatesList(templateList) {
  const container = document.getElementById('templatesList');
  container.innerHTML = '';

  if (!templateList.length) {
    container.innerHTML = '<div class="empty-state">No templates found.</div>';
    return;
  }

  templateList.forEach(template => {
    const item = document.createElement('div');
    item.className = 'template-item';
    item.dataset.templateId = template._id;
    
    if (currentTemplate && currentTemplate._id === template._id) {
      item.classList.add('active');
    }

    const lang = template.language || 'cpp';
    item.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>
      </svg>
      <span class="template-name">${escapeHtml(template.name)}</span>
      <span class="template-lang">${lang.toUpperCase()}</span>
      <button class="delete-btn" title="Delete template">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>`;
    
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.delete-btn')) { selectTemplate(template); }
    });
    
    item.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTemplate(template._id);
    });
    
    container.appendChild(item);
  });
}




function selectTemplate(template, forceUpdate = false) {
  if (!forceUpdate && currentTemplate && currentTemplate._id === template._id) return;
  currentTemplate = template;

  document.querySelectorAll('.template-item').forEach(item => {
    item.classList.toggle('active', item.dataset.templateId === template._id);
  });

  document.querySelector('.welcome-screen').style.display = 'none';
  document.getElementById('editorContainer').style.display = 'flex';
  hideForm();

  const lang = template.language || 'cpp';
  const config = languageConfig[lang] || languageConfig.cpp;
  document.getElementById('tabName').textContent = template.name + config.ext;
  document.getElementById('languageSelect').value = lang;


  if (monacoLoaded && viewEditor) {
   
    viewEditor.getModel().setValue(template.code || '');
    monaco.editor.setModelLanguage(viewEditor.getModel(), config.monaco);
    requestAnimationFrame(() => {
      viewEditor.layout();
      viewEditor.focus();
    });
  } 
  else {
    const monacoHolder = document.getElementById('monacoEditor');
    monacoHolder.textContent = template.code || '';
  }
}



function insertCurrentTemplate() {

  if (!currentTemplate) return;
  chrome.runtime.sendMessage({ action: "insertTemplate", code: currentTemplate.code }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Injection failed:", chrome.runtime.lastError.message);
    } 
    else if (response && response.status === "injected") {
      window.close();
    }
  });

}



function showAddForm() {

  document.getElementById('formView').style.display = 'flex';
  document.getElementById('formTitle').textContent = 'New Template';
  document.getElementById('tplName').value = '';
  document.getElementById('tplLanguage').value = 'cpp';

  if (monacoLoaded && formEditor) {
    formEditor.getModel().setValue('');
    monaco.editor.setModelLanguage(formEditor.getModel(), 'cpp');

    requestAnimationFrame(() => {
      formEditor.layout();
      formEditor.focus();
    });
  } 
  else {
    document.getElementById('tplName').focus();
  }
}




function hideForm() {
  document.getElementById('formView').style.display = 'none';
}

async function saveTemplate() {

  const name = document.getElementById('tplName').value.trim();
  const language = document.getElementById('tplLanguage').value;
  const code = formEditor ? formEditor.getValue() : '';
  if (!name || !code) {
    alert('Name and code are required.');
    return;
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;

  try {
    const res = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, language, code })
    });
    if (!res.ok) throw new Error('Failed to save template.');
    const newTemplate = await res.json();
    hideForm();
    await loadTemplates();
    selectTemplate(newTemplate);
  } 
  catch (e) {
    alert('Error: ' + e.message);
  } 
  finally {
    btn.disabled = false;
  }

}



async function deleteTemplate(id) {

  if (!confirm('Are you sure you want to delete this template?')) return;
  try {
    const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete template.');
    if (currentTemplate && currentTemplate._id === id) {
      currentTemplate = null;
      document.querySelector('.welcome-screen').style.display = 'flex';
      document.getElementById('editorContainer').style.display = 'none';
    }
    await loadTemplates();
  } 
  catch (e) {
    alert('Error: ' + e.message);
  }

}


function escapeHtml(text) {

  const div = document.createElement('div');
  div.textContent = text;
  
  return div.innerHTML;

}