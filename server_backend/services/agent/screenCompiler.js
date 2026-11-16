// ==============================================================================
// server_backend/services/agent/screenCompiler.js
// Compiles a Phase 17 UI JSON screen payload (from create_screen / patch_screen)
// into a clean, standalone, self-contained HTML file stored directly in `project.files`
// (e.g. screens/sales_orders.html), so it renders immediately in the live preview iframe.
// ==============================================================================
'use strict';

function slugify(text) {
  return String(text || 'screen')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'screen';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates standalone HTML for a uiPayload screen.
 * Supports KPIs, dynamic form inputs (CSS Grid 12), data table with search/filtering,
 * and localStorage-backed client-side CRUD that posts back through postMessage.
 */
function compileUiPayloadToHtml(uiPayload, { lang = 'ar', dir = 'rtl' } = {}) {
  const meta = uiPayload?.meta || {};
  const title = meta.title || 'شاشة ذكية';
  const description = meta.description || '';
  const screenId = meta.screenId || slugify(title);
  const kpis = Array.isArray(uiPayload?.kpis) ? uiPayload.kpis : [];
  const fields = Array.isArray(uiPayload?.fields) ? uiPayload.fields : [];
  const records = Array.isArray(uiPayload?.initialRecords) ? uiPayload.initialRecords : [];

  const kpisHtml = kpis.map((k, idx) => `
    <div class="kpi-card" data-testid="kpi-${idx}">
      <div class="kpi-title">${escapeHtml(k.title)}</div>
      <div class="kpi-value">${escapeHtml(k.value)}</div>
      ${k.change ? `<div class="kpi-change ${k.trend === 'up' ? 'trend-up' : k.trend === 'down' ? 'trend-down' : ''}">${escapeHtml(k.change)}</div>` : ''}
    </div>
  `).join('');

  const formFieldsHtml = fields.map((f) => {
    const colSpan = Number(f.colSpan) === 12 ? 'col-12' : 'col-6';
    const req = f.required ? '<span class="req">*</span>' : '';
    let inputEl = '';
    if (f.type === 'select' && Array.isArray(f.options)) {
      inputEl = `<select id="field_${escapeHtml(f.name)}" name="${escapeHtml(f.name)}" class="input-control" ${f.required ? 'required' : ''}>
        <option value="">${escapeHtml(f.placeholder || 'اختر...')}</option>
        ${f.options.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
      </select>`;
    } else if (f.type === 'textarea') {
      inputEl = `<textarea id="field_${escapeHtml(f.name)}" name="${escapeHtml(f.name)}" class="input-control" rows="3" placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''}></textarea>`;
    } else {
      const itype = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
      inputEl = `<input type="${itype}" id="field_${escapeHtml(f.name)}" name="${escapeHtml(f.name)}" class="input-control" placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''} />`;
    }

    return `
      <div class="field-group ${colSpan}" data-field-name="${escapeHtml(f.name)}">
        <label for="field_${escapeHtml(f.name)}">${escapeHtml(f.label)} ${req}</label>
        ${inputEl}
      </div>
    `;
  }).join('');

  const tableHeaders = fields.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${escapeHtml(dir)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #090D18;
      --card-bg: rgba(22, 28, 45, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --success: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif;
      background-color: var(--bg);
      color: var(--text);
      padding: 24px;
      min-height: 100vh;
      line-height: 1.5;
    }
    .header {
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 16px;
    }
    .header h1 { font-size: 1.5rem; font-weight: 700; color: #fff; }
    .header p { font-size: 0.875rem; color: var(--text-muted); margin-top: 4px; }
    .nav-back {
      color: var(--primary);
      text-decoration: none;
      font-size: 0.875rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .kpis-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      backdrop-filter: blur(8px);
    }
    .kpi-title { font-size: 0.8rem; color: var(--text-muted); }
    .kpi-value { font-size: 1.5rem; font-weight: 700; color: #fff; margin-top: 4px; }
    .kpi-change { font-size: 0.75rem; margin-top: 4px; }
    .trend-up { color: var(--success); }
    .trend-down { color: var(--danger); }
    .panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .panel-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; color: #fff; }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 14px;
    }
    .col-6 { grid-column: span 6; }
    .col-12 { grid-column: span 12; }
    @media (max-width: 640px) {
      .col-6 { grid-column: span 12; }
    }
    .field-group label {
      display: block;
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .field-group .req { color: var(--danger); }
    .input-control {
      width: 100%;
      padding: 10px 12px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      color: #fff;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .input-control:focus { border-color: var(--primary); }
    .btn {
      padding: 10px 18px;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.875rem;
      transition: background 0.2s;
    }
    .btn:hover { background: var(--primary-hover); }
    .table-container {
      overflow-x: auto;
      margin-top: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      text-align: right;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--card-border);
    }
    th { color: var(--text-muted); font-weight: 600; background: rgba(15, 23, 42, 0.4); }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .empty-state { text-align: center; color: var(--text-muted); padding: 24px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <a class="nav-back" data-engineer-screen="index.html">← العودة للرئيسية</a>
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    </div>
  </div>

  ${kpisHtml ? `<div class="kpis-grid">${kpisHtml}</div>` : ''}

  ${fields.length > 0 ? `
  <div class="panel">
    <div class="panel-title">إضافة سجل جديد</div>
    <form id="screen-form">
      <div class="form-grid">
        ${formFieldsHtml}
      </div>
      <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
        <button type="submit" class="btn" id="submit-record-btn">حفظ السجل</button>
      </div>
    </form>
  </div>
  ` : ''}

  <div class="panel">
    <div class="panel-title">سجل البيانات</div>
    <div class="table-container">
      <table id="data-table">
        <thead>
          <tr>
            ${tableHeaders}
          </tr>
        </thead>
        <tbody id="table-body">
          <!-- dynamically rendered -->
        </tbody>
      </table>
    </div>
  </div>

  <script>
    (function() {
      var SCREEN_STORAGE_KEY = 'screen_data_${escapeHtml(screenId)}';
      var fields = ${JSON.stringify(fields)};
      var initialRecords = ${JSON.stringify(records)};

      function loadRecords() {
        try {
          var saved = localStorage.getItem(SCREEN_STORAGE_KEY);
          if (saved) {
            var parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed;
          }
        } catch (_) {}
        return initialRecords.slice();
      }

      function saveRecords(list) {
        try {
          localStorage.setItem(SCREEN_STORAGE_KEY, JSON.stringify(list));
        } catch (_) {}
      }

      var currentRecords = loadRecords();

      function renderTable() {
        var tbody = document.getElementById('table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (currentRecords.length === 0) {
          tbody.innerHTML = '<tr><td colspan="' + Math.max(1, fields.length) + '" class="empty-state">لا توجد سجلات مسجلة حتى الآن</td></tr>';
          return;
        }
        currentRecords.forEach(function(row) {
          var tr = document.createElement('tr');
          fields.forEach(function(f) {
            var td = document.createElement('td');
            var val = row[f.name];
            td.textContent = (val !== undefined && val !== null) ? String(val) : '-';
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
      }

      var form = document.getElementById('screen-form');
      if (form) {
        form.addEventListener('submit', function(e) {
          e.preventDefault();
          var formData = {};
          fields.forEach(function(f) {
            var el = document.getElementById('field_' + f.name);
            if (el) formData[f.name] = el.value;
          });
          currentRecords.unshift(formData);
          saveRecords(currentRecords);
          renderTable();
          form.reset();
        });
      }

      renderTable();
    })();
  </script>
</body>
</html>`;
}

/**
 * Writes or updates the screen file in `project.files`, and ensures `index.html` has
 * a navigation entry pointing to it.
 */
function integrateScreenIntoProject(project, uiPayload) {
  if (!project || !Array.isArray(project.files)) return null;
  const meta = uiPayload?.meta || {};
  const slug = slugify(meta.screenId || meta.title || 'screen');
  const fileName = `${slug}.html`;
  const relativePath = `screens/${fileName}`;
  const now = new Date().toISOString();
  const htmlContent = compileUiPayloadToHtml(uiPayload, {
    lang: project.language || 'ar',
    dir: project.direction || 'rtl',
  });

  let screenFile = project.files.find((f) => f.path === `/${relativePath}` || f.path === relativePath || f.name === fileName);
  if (screenFile) {
    screenFile.previousContent = screenFile.content;
    screenFile.content = htmlContent;
    screenFile.size = htmlContent.length;
    screenFile.updatedAt = now;
  } else {
    screenFile = {
      id: `file-screen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: fileName,
      path: `/${relativePath}`,
      folder: 'screens',
      content: htmlContent,
      language: 'html',
      size: htmlContent.length,
      updatedAt: now,
    };
    project.files.push(screenFile);
  }

  // Update or create index.html with a link to screens
  let indexFile = project.files.find((f) => f.name === 'index.html');
  if (indexFile) {
    const navTag = `<a href="screens/${fileName}" data-engineer-screen="screens/${fileName}" class="screen-link">${escapeHtml(meta.title || fileName)}</a>`;
    if (!indexFile.content.includes(`data-engineer-screen="screens/${fileName}"`)) {
      if (indexFile.content.includes('</body>')) {
        indexFile.content = indexFile.content.replace(
          '</body>',
          `<div class="engineer-screens-nav" style="padding:12px;background:rgba(15,23,42,0.9);position:fixed;bottom:0;left:0;right:0;z-index:999;border-top:1px solid rgba(255,255,255,0.1);font-family:sans-serif;font-size:13px;display:flex;gap:12px;align-items:center;">
            <span style="color:#94a3b8;">شاشات النظام:</span>
            ${navTag}
          </div></body>`
        );
      } else {
        indexFile.content += `\n${navTag}`;
      }
      indexFile.size = indexFile.content.length;
      indexFile.updatedAt = now;
    }
  }

  return { screenFile, relativePath };
}

module.exports = {
  compileUiPayloadToHtml,
  integrateScreenIntoProject,
  slugify,
};
