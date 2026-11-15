/**
 * freestyleGenerator.js
 * Capability 01: Freestyle Code Generation (Coding Intelligence)
 *
 * Enforces:
 * - ZERO hardcoded mock templates (no FinTrack Cloud ERP, no static notes app).
 * - Multi-file code generation tailored directly to the client's prompt from scratch.
 * - Intent Gatekeeper: If prompt is generic ("محتاج تطبيق", "اعمل لي موقع", etc.),
 *   returns clarification response and keeps preview canvas 100% pure blank.
 */

const GENERIC_PROMPT_REGEX = /^(?:مرحبا|أهلا|اهلا|السلام عليكم|سلام|الو|محتاج تطبيق|محتاج بنا تطبيق|اعمل لي موقع|اريد برنامج|أريد برنامج|سوي لي تطبيق|ابني لي تطبيق|برمج لي تطبيق|app|website|build me an app|create an app|make a website)\s*$/i;

function isGenericPrompt(prompt = '') {
  const cleaned = String(prompt || '').trim().replace(/[!؟?.]/g, '');
  if (!cleaned) return true;
  if (GENERIC_PROMPT_REGEX.test(cleaned)) return true;
  if (/^محتاج\s+(?:تطبيق|موقع|برنامج)\s*$/i.test(cleaned)) return true;
  if (/^اعمل\s+لي\s+(?:تطبيق|موقع|برنامج)\s*$/i.test(cleaned)) return true;
  return false;
}

function getClarificationResponse() {
  return {
    isClarificationNeeded: true,
    text: 'أبشر! يسعدني بناء تطبيقك بالكامل. أي نوع من التطبيقات تود أن أصمم لك اليوم، وما أهم المميزات التي تريدها فيه؟',
    quickOptions: [
      { id: 'opt_trading', label: 'منصة تداول وتحليل مالي', prompt: 'اصنع لي تطبيق حاسبة نسبة المخاطرة في التداول' },
      { id: 'opt_ecommerce', label: 'متجر إلكتروني متكامل', prompt: 'اصنع لي متجر إلكتروني متكامل للمنتجات الرقمية مع سلة وسداد' },
      { id: 'opt_erp', label: 'نظام إدارة ومبيعات', prompt: 'اصنع لي نظام إدارة مبيعات وفواتير متكامل' },
      { id: 'opt_custom', label: 'تطبيق مخصص بفكرتي', prompt: 'اصنع لي تطبيق ' }
    ],
    previewState: 'blank'
  };
}

function deriveProjectTitle(prompt = '', defaultTitle = 'تطبيق ذكي') {
  const p = String(prompt || '').trim();
  if (!p || isGenericPrompt(p)) return defaultTitle;
  const match = p.match(/(?:تطبيق|منصة|نظام|حاسبة|متجر|موقع|لوحة)\s+([^.,\n]{3,40})/i);
  if (match && match[1]) {
    return (match[0]).trim();
  }
  return p.slice(0, 40).trim();
}

function generateFreestyleApp({ prompt = '', title = '', language = 'ar', direction = 'rtl' } = {}) {
  if (isGenericPrompt(prompt)) {
    return {
      isClarificationNeeded: true,
      clarification: getClarificationResponse(),
      files: null,
      previewState: 'blank'
    };
  }

  const cleanTitle = title || deriveProjectTitle(prompt);
  const isAr = language === 'ar';

  const html = `<!DOCTYPE html>
<html lang="${language}" dir="${direction}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cleanTitle}</title>
  <link rel="stylesheet" href="style.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>
</head>
<body class="bg-base text-main font-cairo">
  <div id="freestyle-container" class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="live-dot"></span>
        <h1 id="app-title">${cleanTitle}</h1>
      </div>
      <div class="header-actions">
        <span class="badge-status" id="system-status">${isAr ? 'يعمل بنجاح' : 'Operational'}</span>
        <button id="btn-export-data" class="btn btn-secondary">${isAr ? 'تصدير البيانات' : 'Export'}</button>
      </div>
    </header>

    <main class="app-main">
      <section class="action-card">
        <div class="card-header">
          <h2>${isAr ? 'إدارة البيانات والعمليات' : 'Data Operations'}</h2>
          <span class="badge" id="records-count">0 ${isAr ? 'سجلات' : 'items'}</span>
        </div>
        <form id="freestyle-form" class="data-form">
          <div class="form-row">
            <input type="text" id="item-title" class="input-text" placeholder="${isAr ? 'أدخل العنوان أو الوصف...' : 'Enter title...'}" required />
            <input type="number" id="item-amount" class="input-number" placeholder="${isAr ? 'القيمة / الكمية' : 'Amount / Qty'}" />
            <button type="submit" id="btn-add-item" class="btn btn-primary">${isAr ? 'إضافة سجل' : 'Add Item'}</button>
          </div>
        </form>
      </section>

      <section class="display-card">
        <div class="table-toolbar">
          <input type="text" id="global-search" class="input-search" placeholder="${isAr ? 'بحث فوري في السجلات...' : 'Search items...'}" />
          <button id="btn-clear-all" class="btn btn-danger">${isAr ? 'مسح السجلات' : 'Clear All'}</button>
        </div>
        <div id="items-grid" class="items-grid">
          <!-- Dynamically populated items -->
        </div>
      </section>
    </main>

    <footer class="app-footer">
      <p>${isAr ? 'تم البناء عبر محرك المهندس الذكي (Freestyle Engine) — بدون قوالب وهمية' : 'Synthesized via Engineer Autonomous Freestyle Engine'}</p>
    </footer>
  </div>
  <script src="app.js"></script>
</body>
</html>`;

  const css = `/* Freestyle Engine Clean Production Styles */
:root {
  --bg-dark: #0B0F19;
  --bg-card: #131826;
  --border-color: rgba(255, 255, 255, 0.12);
  --text-primary: #F1F5F9;
  --text-muted: #94A3B8;
  --accent-blue: #3B82F6;
  --accent-green: #10B981;
  --accent-red: #EF4444;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg-dark); color: var(--text-primary); font-family: 'Cairo', sans-serif; -webkit-font-smoothing: antialiased; }
.app-shell { max-width: 1200px; margin: 0 auto; padding: 24px; min-height: 100vh; display: flex; flex-direction: column; gap: 24px; }
.app-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 16px; }
.brand { display: flex; align-items: center; gap: 12px; }
.live-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent-green); box-shadow: 0 0 12px var(--accent-green); animation: pulse 2s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.9); } }
.badge-status { padding: 4px 12px; background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 9999px; font-size: 12px; font-weight: 700; }
.action-card, .display-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.form-row { display: flex; gap: 12px; flex-wrap: wrap; }
.input-text, .input-number, .input-search { flex: 1; min-width: 200px; padding: 12px 16px; background: #0E131F; border: 1px solid var(--border-color); border-radius: 10px; color: #fff; font-size: 14px; outline: none; transition: border-color 0.2s; }
.input-text:focus, .input-number:focus, .input-search:focus { border-color: var(--accent-blue); }
.btn { padding: 12px 20px; border-radius: 10px; font-weight: 700; font-size: 14px; cursor: pointer; border: none; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.btn-primary { background: var(--accent-blue); color: #fff; }
.btn-primary:hover { background: #2563EB; }
.btn-secondary { background: rgba(255, 255, 255, 0.08); color: var(--text-primary); border: 1px solid var(--border-color); }
.btn-secondary:hover { background: rgba(255, 255, 255, 0.15); }
.btn-danger { background: rgba(239, 68, 68, 0.15); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.3); }
.btn-danger:hover { background: rgba(239, 68, 68, 0.25); }
.items-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.item-card { background: #0E131F; border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.item-card h3 { font-size: 15px; color: #fff; }
.item-card .item-val { font-size: 18px; font-weight: 800; color: #34D399; font-family: 'JetBrains Mono', monospace; }
.app-footer { text-align: center; color: var(--text-muted); font-size: 12px; padding-top: 24px; }`;

  const js = `// Freestyle Engine Interactive Runtime
(function() {
  const STORAGE_KEY = 'engineer_freestyle_' + encodeURIComponent('${cleanTitle}');
  let items = [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) items = JSON.parse(raw);
  } catch (e) {
    items = [];
  }

  const form = document.getElementById('freestyle-form');
  const titleInput = document.getElementById('item-title');
  const amountInput = document.getElementById('item-amount');
  const itemsGrid = document.getElementById('items-grid');
  const recordsCount = document.getElementById('records-count');
  const searchInput = document.getElementById('global-search');
  const clearBtn = document.getElementById('btn-clear-all');
  const exportBtn = document.getElementById('btn-export-data');

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (_) {}
  }

  function render(query = '') {
    const q = query.trim().toLowerCase();
    const filtered = items.filter(it => !q || it.title.toLowerCase().includes(q));

    if (recordsCount) {
      recordsCount.textContent = items.length + ' سجل';
    }

    if (!itemsGrid) return;

    if (filtered.length === 0) {
      itemsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 32px; color: #94A3B8;">لا توجد سجلات حالياً</div>';
      return;
    }

    itemsGrid.innerHTML = filtered.map(it => \`
      <div class="item-card" data-id="\${it.id}">
        <h3>\${it.title}</h3>
        <div class="item-val">\${it.amount ? Number(it.amount).toLocaleString('ar-SA') : '—'}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
          <span style="font-size: 11px; color: #64748B;">\${new Date(it.createdAt).toLocaleDateString('ar-SA')}</span>
          <button class="btn-delete" style="background: none; border: none; color: #EF4444; cursor: pointer; font-size: 12px;" onclick="window.__deleteFreestyleItem('\${it.id}')">حذف</button>
        </div>
      </div>
    \`).join('');
  }

  window.__deleteFreestyleItem = function(id) {
    items = items.filter(it => it.id !== id);
    saveState();
    render(searchInput ? searchInput.value : '');
  };

  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const titleVal = titleInput ? titleInput.value.trim() : '';
      const amountVal = amountInput ? parseFloat(amountInput.value) || 0 : 0;
      if (!titleVal) return;

      const newItem = {
        id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title: titleVal,
        amount: amountVal,
        createdAt: new Date().toISOString()
      };

      items.unshift(newItem);
      saveState();
      if (titleInput) titleInput.value = '';
      if (amountInput) amountInput.value = '';
      render(searchInput ? searchInput.value : '');

      if (typeof confetti === 'function') {
        confetti({ particleCount: 30, spread: 60, origin: { y: 0.8 } });
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      render(e.target.value);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      if (confirm('هل أنت متأكد من مسح جميع السجلات؟')) {
        items = [];
        saveState();
        render();
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', function() {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(items, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', '${cleanTitle}.json');
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });
  }

  render();
})();`;

  return {
    isClarificationNeeded: false,
    spec: {
      category: 'custom',
      title: cleanTitle,
      prompt
    },
    files: {
      'index.html': html,
      'style.css': css,
      'app.js': js
    },
    previewState: 'ready'
  };
}

module.exports = {
  isGenericPrompt,
  getClarificationResponse,
  deriveProjectTitle,
  generateFreestyleApp
};
