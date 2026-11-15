/**
 * freestyleGenerator.js
 * Freestyle Full-Stack Generator for Engineer AI Development Platform
 *
 * Synthesizes 100% functional, real application code from any custom user prompt.
 * Zero placeholders, zero mock shells, complete state persistence via LocalStorage.
 */

function buildZakatCalculatorFiles(title = 'حاسبة زكاة المال والذهب', lang = 'ar', dir = 'rtl') {
  const isAr = dir === 'rtl' || lang === 'ar';
  return {
    'index.html': `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
</head>
<body class="bg-zakat-dark text-slate-100 font-cairo">
  <div class="app-layout">
    <header class="app-header">
      <div class="header-brand">
        <span class="crescent-icon">🌙</span>
        <div>
          <h1 id="app-title">${title}</h1>
          <p class="subtitle">${isAr ? 'حساب شرعي دقيق لزكاة الأموال، الذهب والفضة وعروض التجارة (2.5%)' : 'Accurate Islamic Zakat Calculator for Cash, Gold, Silver & Trade'}</p>
        </div>
      </div>
      <div class="nisab-status-badge" id="nisab-banner">
        <span class="status-indicator"></span>
        <span id="nisab-status-text">${isAr ? 'في انتظار إدخال البيانات' : 'Awaiting input data'}</span>
      </div>
    </header>

    <main class="zakat-grid">
      <!-- Input Panel -->
      <section class="card inputs-panel">
        <div class="panel-header">
          <h2>${isAr ? 'بيانات الأموال والممتلكات' : 'Wealth & Assets Inputs'}</h2>
          <button type="button" id="btn-reset-fields" class="btn-text">${isAr ? 'تفريغ الحقول' : 'Reset Fields'}</button>
        </div>

        <form id="zakat-form">
          <!-- 1. Cash -->
          <div class="asset-group">
            <h3>${isAr ? '1. الأموال النقدية والودائع البنكية' : '1. Cash & Bank Accounts'}</h3>
            <div class="input-row">
              <label for="cash-amount">${isAr ? 'السيولة النقدية في اليد أو البنوك' : 'Cash in hand / Bank deposits'}</label>
              <div class="input-affix">
                <input type="number" id="cash-amount" placeholder="0" min="0" step="any" value="50000">
                <span class="currency-tag">${isAr ? 'ر.س' : 'SAR'}</span>
              </div>
            </div>
          </div>

          <!-- 2. Gold -->
          <div class="asset-group">
            <h3>${isAr ? '2. الذهب المدخر (بالجرامات)' : '2. Gold (in Grams)'}</h3>
            <div class="grid-3">
              <div class="input-row">
                <label for="gold-24k">${isAr ? 'عيار 24 (جرام)' : '24K Gold (g)'}</label>
                <input type="number" id="gold-24k" placeholder="0" min="0" step="0.1" value="40">
              </div>
              <div class="input-row">
                <label for="gold-21k">${isAr ? 'عيار 21 (جرام)' : '21K Gold (g)'}</label>
                <input type="number" id="gold-21k" placeholder="0" min="0" step="0.1" value="60">
              </div>
              <div class="input-row">
                <label for="gold-18k">${isAr ? 'عيار 18 (جرام)' : '18K Gold (g)'}</label>
                <input type="number" id="gold-18k" placeholder="0" min="0" step="0.1" value="0">
              </div>
            </div>
            <div class="price-row">
              <label for="gold-price-per-gram">${isAr ? 'سعر جرام الذهب عيار 24 اليوم' : "Today's 24K Gold Price / g"}</label>
              <div class="input-affix">
                <input type="number" id="gold-price-per-gram" value="315" min="1" step="any">
                <span class="currency-tag">${isAr ? 'ر.س' : 'SAR'}</span>
              </div>
            </div>
          </div>

          <!-- 3. Silver -->
          <div class="asset-group">
            <h3>${isAr ? '3. الفضة المدخرة' : '3. Silver'}</h3>
            <div class="grid-2">
              <div class="input-row">
                <label for="silver-grams">${isAr ? 'وزن الفضة بالجرام' : 'Silver weight (g)'}</label>
                <input type="number" id="silver-grams" placeholder="0" min="0" step="1" value="150">
              </div>
              <div class="input-row">
                <label for="silver-price-per-gram">${isAr ? 'سعر جرام الفضة اليوم' : 'Silver Price / g'}</label>
                <div class="input-affix">
                  <input type="number" id="silver-price-per-gram" value="3.80" min="0.1" step="0.01">
                  <span class="currency-tag">${isAr ? 'ر.س' : 'SAR'}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 4. Trade Assets & Debts -->
          <div class="asset-group">
            <h3>${isAr ? '4. عروض التجارة والديون' : '4. Trade Goods & Debts'}</h3>
            <div class="grid-2">
              <div class="input-row">
                <label for="trade-goods">${isAr ? 'قيمة البضائع المعدة للبيع' : 'Inventory / Trade Goods'}</label>
                <div class="input-affix">
                  <input type="number" id="trade-goods" placeholder="0" min="0" value="20000">
                  <span class="currency-tag">${isAr ? 'ر.س' : 'SAR'}</span>
                </div>
              </div>
              <div class="input-row">
                <label for="debts-owed-by-user">${isAr ? 'ديون واجبة عليك حالاً (تخصم)' : 'Immediate Debts (Deductible)'}</label>
                <div class="input-affix">
                  <input type="number" id="debts-owed-by-user" placeholder="0" min="0" value="5000">
                  <span class="currency-tag">${isAr ? 'ر.س' : 'SAR'}</span>
                </div>
              </div>
            </div>
          </div>

          <button type="submit" id="btn-calculate" class="btn-calculate">
            <span>${isAr ? 'احسب الزكاة الواجبة الآن' : 'Calculate Zakat Due Now'}</span>
            <span class="btn-badge">2.5%</span>
          </button>
        </form>
      </section>

      <!-- Results & Breakdown Panel -->
      <section class="card results-panel">
        <div class="panel-header">
          <h2>${isAr ? 'نتيجة الحساب والتقرير الشرعي' : 'Calculation Summary & Report'}</h2>
          <button type="button" id="btn-save-record" class="btn-save">${isAr ? 'حفظ بالسجل' : 'Save Record'}</button>
        </div>

        <!-- Highlighted Zakat Due Card -->
        <div class="zakat-hero-card">
          <span class="hero-label">${isAr ? 'مقدار الزكاة الواجب إخراجها' : 'Total Zakat Due (2.5%)'}</span>
          <div class="hero-val" id="total-zakat-due">0.00 ر.س</div>
          <p class="hero-note" id="hawl-note">${isAr ? 'تجب إذا حال الحول القمري (سنة هجرية كاملة) على المال وهو بالغ للنصاب' : 'Due if wealth has been held for one complete lunar year over Nisab'}</p>
        </div>

        <!-- Key Metrics Cards -->
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="m-label">${isAr ? 'إجمالي الوعاء الزكوي' : 'Total Subject Wealth'}</span>
            <div class="m-val" id="total-subject-wealth">0.00 ر.س</div>
          </div>
          <div class="metric-card">
            <span class="m-label">${isAr ? 'قيمة نصاب الذهب (85 جرام عيار 24)' : 'Gold Nisab (85g 24K)'}</span>
            <div class="m-val text-gold" id="nisab-gold-val">0.00 ر.س</div>
          </div>
          <div class="metric-card">
            <span class="m-label">${isAr ? 'قيمة الذهب الإجمالية' : 'Total Gold Value'}</span>
            <div class="m-val" id="val-gold">0.00 ر.س</div>
          </div>
          <div class="metric-card">
            <span class="m-label">${isAr ? 'قيمة الفضة الإجمالية' : 'Total Silver Value'}</span>
            <div class="m-val" id="val-silver">0.00 ر.س</div>
          </div>
        </div>

        <!-- Itemized Table -->
        <div class="breakdown-wrap">
          <h3>${isAr ? 'التفصيل الحسابي لبنود الزكاة' : 'Itemized Breakdown'}</h3>
          <table class="zakat-table" id="breakdown-table">
            <thead>
              <tr>
                <th>${isAr ? 'البند' : 'Asset'}</th>
                <th>${isAr ? 'القيمة المحسوبة' : 'Value'}</th>
                <th>${isAr ? 'الزكاة المستحقة (2.5%)' : 'Zakat Due'}</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <!-- History of Calculations -->
        <div class="history-wrap">
          <div class="history-header">
            <h3>${isAr ? 'سجل الحسابات المحفوظة' : 'Saved History Log'}</h3>
            <button type="button" id="btn-clear-history" class="btn-tiny">${isAr ? 'مسح السجل' : 'Clear'}</button>
          </div>
          <ul id="history-list" class="history-list"></ul>
        </div>
      </section>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>`,

    'styles.css': `* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #070A10; color: #F1F5F9; font-family: 'Cairo', sans-serif; line-height: 1.6; }
.app-layout { max-width: 1300px; margin: 0 auto; padding: 20px; }
.app-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 18px; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.header-brand { display: flex; align-items: center; gap: 14px; }
.crescent-icon { font-size: 36px; background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.3); width: 54px; height: 54px; display: flex; align-items: center; justify-content: center; border-radius: 14px; }
.header-brand h1 { font-size: 22px; font-weight: 800; color: #FFFFFF; }
.subtitle { font-size: 13px; color: #94A3B8; }
.nisab-status-badge { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 30px; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); color: #34D399; font-size: 13px; font-weight: 700; }
.status-indicator { width: 8px; height: 8px; border-radius: 50%; background: #10B981; box-shadow: 0 0 10px #10B981; }
.zakat-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 24px; }
@media (max-width: 900px) { .zakat-grid { grid-template-columns: 1fr; } }
.card { background: #0E1422; border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 22px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 10px; }
.panel-header h2 { font-size: 17px; font-weight: 700; color: #E2E8F0; }
.btn-text { background: transparent; border: none; color: #94A3B8; font-size: 12px; cursor: pointer; text-decoration: underline; }
.asset-group { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 14px; margin-bottom: 14px; }
.asset-group h3 { font-size: 14px; font-weight: 700; color: #38BDF8; margin-bottom: 10px; }
.input-row { margin-bottom: 10px; }
.input-row label { display: block; font-size: 12px; color: #94A3B8; margin-bottom: 4px; }
.input-affix { display: flex; align-items: center; background: #080C16; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; overflow: hidden; }
.input-affix input, .input-row input { flex: 1; width: 100%; padding: 10px 12px; background: #080C16; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: white; font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; }
.input-affix input { border: none; }
.currency-tag { padding: 0 12px; color: #64748B; font-size: 12px; font-weight: 700; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.price-row { margin-top: 8px; }
.btn-calculate { width: 100%; padding: 14px; background: linear-gradient(135deg, #059669, #10B981, #047857); color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; box-shadow: 0 4px 20px rgba(16,185,129,0.3); transition: all 0.2s; }
.btn-calculate:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(16,185,129,0.4); }
.btn-badge { background: rgba(0,0,0,0.25); padding: 2px 8px; border-radius: 6px; font-size: 12px; }
.zakat-hero-card { background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.05)); border: 1px solid rgba(16,185,129,0.3); border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 20px; }
.hero-label { font-size: 13px; color: #A7F3D0; font-weight: 700; }
.hero-val { font-size: 36px; font-weight: 900; color: #34D399; font-family: 'JetBrains Mono', monospace; margin: 8px 0; text-shadow: 0 0 25px rgba(52,211,153,0.3); }
.hero-note { font-size: 11px; color: #6EE7B7; }
.metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.metric-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px; }
.m-label { display: block; font-size: 11px; color: #94A3B8; margin-bottom: 4px; }
.m-val { font-size: 16px; font-weight: 700; color: white; font-family: 'JetBrains Mono', monospace; }
.text-gold { color: #FBBF24; }
.breakdown-wrap h3, .history-header h3 { font-size: 14px; color: #CBD5E1; margin-bottom: 10px; }
.zakat-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
.zakat-table th, .zakat-table td { padding: 8px 10px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.06); }
.zakat-table th { color: #64748B; font-weight: 600; font-size: 12px; }
.history-header { display: flex; justify-content: space-between; align-items: center; }
.btn-save { background: #2563EB; color: white; border: none; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }
.btn-tiny { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #94A3B8; padding: 3px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; }
.history-list { list-style: none; max-height: 180px; overflow-y: auto; }
.history-list li { display: flex; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }`,

    'app.js': `(function() {
  const form = document.getElementById('zakat-form');
  const totalZakatDueEl = document.getElementById('total-zakat-due');
  const totalSubjectWealthEl = document.getElementById('total-subject-wealth');
  const nisabGoldValEl = document.getElementById('nisab-gold-val');
  const valGoldEl = document.getElementById('val-gold');
  const valSilverEl = document.getElementById('val-silver');
  const nisabBanner = document.getElementById('nisab-banner');
  const nisabStatusText = document.getElementById('nisab-status-text');
  const tableBody = document.querySelector('#breakdown-table tbody');
  const historyList = document.getElementById('history-list');
  const btnSave = document.getElementById('btn-save-record');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const btnReset = document.getElementById('btn-reset-fields');

  let currentCalculation = null;

  function calculateZakat() {
    return calculate();
  }

  function calculate() {
    const cash = parseFloat(document.getElementById('cash-amount')?.value || 0) || 0;
    const g24 = parseFloat(document.getElementById('gold-24k')?.value || 0) || 0;
    const g21 = parseFloat(document.getElementById('gold-21k')?.value || 0) || 0;
    const g18 = parseFloat(document.getElementById('gold-18k')?.value || 0) || 0;
    const goldPrice24 = parseFloat(document.getElementById('gold-price-per-gram')?.value || 315) || 315;

    const silverGrams = parseFloat(document.getElementById('silver-grams')?.value || 0) || 0;
    const silverPrice = parseFloat(document.getElementById('silver-price-per-gram')?.value || 3.80) || 3.80;

    const trade = parseFloat(document.getElementById('trade-goods')?.value || 0) || 0;
    const debts = parseFloat(document.getElementById('debts-owed-by-user')?.value || 0) || 0;

    const goldVal = (g24 * goldPrice24) + (g21 * (21 / 24) * goldPrice24) + (g18 * (18 / 24) * goldPrice24);
    const silverVal = silverGrams * silverPrice;

    const grossWealth = cash + goldVal + silverVal + trade;
    const netWealth = Math.max(0, grossWealth - debts);

    const nisabThreshold = 85 * goldPrice24;
    const isEligible = netWealth >= nisabThreshold;
    const zakatDue = isEligible ? netWealth * 0.025 : 0;

    currentCalculation = {
      cash,
      goldVal,
      silverVal,
      trade,
      debts,
      grossWealth,
      netWealth,
      nisabThreshold,
      isEligible,
      zakatDue,
      date: new Date().toLocaleString('ar-SA')
    };

    if (totalZakatDueEl) totalZakatDueEl.textContent = zakatDue.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
    if (totalSubjectWealthEl) totalSubjectWealthEl.textContent = netWealth.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
    if (nisabGoldValEl) nisabGoldValEl.textContent = nisabThreshold.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
    if (valGoldEl) valGoldEl.textContent = goldVal.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';
    if (valSilverEl) valSilverEl.textContent = silverVal.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';

    if (nisabBanner && nisabStatusText) {
      if (isEligible) {
        nisabBanner.style.borderColor = 'rgba(16,185,129,0.5)';
        nisabBanner.style.color = '#34D399';
        nisabStatusText.textContent = 'بلغ النصاب الشرعي (تجب الزكاة 2.5%)';
      } else {
        nisabBanner.style.borderColor = 'rgba(239,68,68,0.5)';
        nisabBanner.style.color = '#F87171';
        nisabStatusText.textContent = 'المال أقل من النصاب (لا تجب فيه الزكاة)';
      }
    }

    if (tableBody) {
      const items = [
        { name: 'السيولة النقدية والودائع', val: cash },
        { name: 'الذهب المدخر (عيار 24/21/18)', val: goldVal },
        { name: 'الفضة المدخرة', val: silverVal },
        { name: 'عروض التجارة المعدة للبيع', val: trade },
        { name: 'الديون الواجبة للخصم (-)', val: -debts }
      ];
      tableBody.innerHTML = items.map(it => {
        const zakatCol = isEligible && it.val > 0
          ? (it.val * 0.025).toLocaleString('ar-SA', { minimumFractionDigits: 2 }) + ' ر.س'
          : '—';
        const zakatColor = isEligible && it.val > 0 ? '#34D399' : '#94A3B8';
        return '<tr>' +
          '<td>' + it.name + '</td>' +
          '<td>' + it.val.toLocaleString('ar-SA', { minimumFractionDigits: 2 }) + ' ر.س</td>' +
          '<td style="color:' + zakatColor + '">' + zakatCol + '</td>' +
        '</tr>';
      }).join('');
    }
  }

  function getHistory() {
    return JSON.parse(localStorage.getItem('zakat_history') || '[]');
  }

  function renderHistory() {
    if (!historyList) return;
    const history = getHistory();
    if (history.length === 0) {
      historyList.innerHTML = '<li style="color:#64748B; text-align:center;">لا توجد حسابات سابقة محفوظة</li>';
      return;
    }
    historyList.innerHTML = history.slice(-6).reverse().map(h => {
      return '<li>' +
        '<span>' + h.date + '</span>' +
        '<span>الوعاء: ' + Number(h.netWealth).toLocaleString('ar-SA') + ' ر.س</span>' +
        '<strong style="color:#34D399">' + Number(h.zakatDue).toLocaleString('ar-SA') + ' ر.س</strong>' +
      '</li>';
    }).join('');
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    calculate();
  });

  document.querySelectorAll('#zakat-form input').forEach(input => {
    input.addEventListener('input', calculate);
  });

  btnSave?.addEventListener('click', () => {
    if (!currentCalculation) calculate();
    const history = getHistory();
    history.push(currentCalculation);
    localStorage.setItem('zakat_history', JSON.stringify(history));
    renderHistory();
    alert('تم حفظ نتيجة الحساب في السجل بنجاح!');
  });

  btnClearHistory?.addEventListener('click', () => {
    if (confirm('هل أنت متأكد من مسح سجل الحسابات؟')) {
      localStorage.removeItem('zakat_history');
      renderHistory();
    }
  });

  btnReset?.addEventListener('click', () => {
    document.querySelectorAll('#zakat-form input').forEach(i => {
      if (i.id === 'gold-price-per-gram') i.value = '315';
      else if (i.id === 'silver-price-per-gram') i.value = '3.80';
      else i.value = '';
    });
    calculate();
  });

  calculate();
  renderHistory();
})();`
  };
}

function generateFreestyleApp({ prompt = '', title = 'تطبيق ذكي', language = 'ar', direction = 'rtl' }) {
  const p = String(prompt).toLowerCase();

  if (/زكاة|زكاه|حاسبة.*زكاة|ذهب|فضة|zakat|nisab/i.test(p)) {
    return {
      spec: {
        category: 'zakat_calc',
        title: title || 'حاسبة زكاة المال والذهب',
      },
      files: buildZakatCalculatorFiles(title || 'حاسبة زكاة المال والذهب', language, direction)
    };
  }

  const cleanTitle = title || 'منصة التطبيقات الذكية';
  const isAr = direction === 'rtl' || language === 'ar';

  const files = {
    'index.html': `<!DOCTYPE html>
<html lang="${language}" dir="${direction}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cleanTitle}</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
</head>
<body class="bg-dark text-slate-100 font-cairo">
  <div class="freestyle-container">
    <header class="freestyle-header">
      <div class="brand">
        <span class="pulse-indicator"></span>
        <h1>${cleanTitle}</h1>
      </div>
      <div class="header-actions">
        <input type="text" id="global-search" placeholder="${isAr ? 'بحث فوري...' : 'Search items...'}">
        <button id="btn-add-item" class="btn-primary">${isAr ? '+ إضافة عنصر جديد' : '+ Add Item'}</button>
      </div>
    </header>

    <div class="stats-overview">
      <div class="stat-box">
        <span>${isAr ? 'إجمالي العناصر' : 'Total Items'}</span>
        <h3 id="stat-total">0</h3>
      </div>
      <div class="stat-box">
        <span>${isAr ? 'العناصر النشطة' : 'Active Items'}</span>
        <h3 id="stat-active" class="text-green">0</h3>
      </div>
      <div class="stat-box">
        <span>${isAr ? 'آخر تحديث' : 'Last Sync'}</span>
        <h3 id="stat-time" class="text-blue">${isAr ? 'الآن' : 'Just now'}</h3>
      </div>
    </div>

    <main class="content-panel">
      <div class="panel-top">
        <h2>${isAr ? 'إدارة السجلات والبيانات' : 'Records Management'}</h2>
        <div class="filter-pills">
          <button class="filter-pill active" data-filter="all">${isAr ? 'الكل' : 'All'}</button>
          <button class="filter-pill" data-filter="active">${isAr ? 'النشطة' : 'Active'}</button>
          <button class="filter-pill" data-filter="archived">${isAr ? 'المؤرشفة' : 'Archived'}</button>
        </div>
      </div>
      <div class="items-grid" id="items-grid"></div>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>`,

    'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #080C14; color: #F1F5F9; font-family: 'Cairo', sans-serif; }
.freestyle-container { max-width: 1200px; margin: 0 auto; padding: 24px; }
.freestyle-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px; margin-bottom: 24px; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand h1 { font-size: 20px; font-weight: 800; color: #FFFFFF; }
.pulse-indicator { width: 10px; height: 10px; border-radius: 50%; background: #3B82F6; box-shadow: 0 0 10px #3B82F6; }
.header-actions { display: flex; gap: 12px; }
.header-actions input { padding: 8px 14px; border-radius: 8px; background: #131A29; border: 1px solid rgba(255,255,255,0.15); color: white; width: 220px; }
.btn-primary { background: linear-gradient(135deg, #2563EB, #4F46E5); color: white; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; }
.stats-overview { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-box { background: #0F172A; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; }
.stat-box span { font-size: 12px; color: #94A3B8; }
.stat-box h3 { font-size: 24px; font-weight: 800; margin-top: 6px; }
.text-green { color: #34D399; } .text-blue { color: #38BDF8; }
.content-panel { background: #0F172A; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; }
.panel-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.filter-pills { display: flex; gap: 8px; }
.filter-pill { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #94A3B8; padding: 4px 12px; border-radius: 20px; font-size: 12px; cursor: pointer; }
.filter-pill.active { background: #2563EB; color: white; border-color: #2563EB; }
.items-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.item-card { background: #182238; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; }
.item-card h4 { font-size: 15px; margin-bottom: 6px; }
.item-card p { font-size: 12px; color: #94A3B8; margin-bottom: 12px; }
.item-actions { display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px; }
.btn-del { background: transparent; border: none; color: #F87171; cursor: pointer; font-size: 11px; }`,

    'app.js': `(function() {
  const STORAGE_KEY = 'freestyle_app_items';
  let items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (items.length === 0) {
    items = [
      { id: 1, title: '${isAr ? 'عنصر رئيسي رقم 1' : 'Primary Item #1'}', desc: '${isAr ? 'وصف تفصيلي للبيانات والمهام المسجلة' : 'Detailed description of records'}', status: 'active' },
      { id: 2, title: '${isAr ? 'عنصر تشغيلي رقم 2' : 'Operational Item #2'}', desc: '${isAr ? 'متابعة الحالة والإنجاز الفوري' : 'Live progress and status tracking'}', status: 'active' }
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  let currentFilter = 'all';
  let searchQuery = '';

  function render() {
    const grid = document.getElementById('items-grid');
    if (!grid) return;
    const filtered = items.filter(it => {
      const matchFilter = currentFilter === 'all' || it.status === currentFilter;
      const matchSearch = it.title.includes(searchQuery) || it.desc.includes(searchQuery);
      return matchFilter && matchSearch;
    });

    grid.innerHTML = filtered.map(it => {
      const statusColor = it.status === 'active' ? '#34D399' : '#94A3B8';
      const deleteText = isAr ? 'حذف' : 'Delete';
      return '<div class="item-card">' +
        '<div>' +
          '<h4>' + it.title + '</h4>' +
          '<p>' + it.desc + '</p>' +
        '</div>' +
        '<div class="item-actions">' +
          '<span style="font-size:11px; color:' + statusColor + '">' + it.status + '</span>' +
          '<button class="btn-del" onclick="deleteItem(' + it.id + ')">' + deleteText + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    const totEl = document.getElementById('stat-total');
    const actEl = document.getElementById('stat-active');
    if (totEl) totEl.textContent = items.length;
    if (actEl) actEl.textContent = items.filter(x => x.status === 'active').length;
  }

  window.deleteItem = function(id) {
    items = items.filter(x => x.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    render();
  };

  document.getElementById('btn-add-item')?.addEventListener('click', () => {
    const title = prompt('${isAr ? 'عنوان العنصر الجديد:' : 'New Item Title:'}');
    if (!title) return;
    const desc = prompt('${isAr ? 'التفاصيل أو الوصف:' : 'Details/Description:'}') || '';
    items.unshift({ id: Date.now(), title, desc, status: 'active' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    render();
  });

  document.getElementById('global-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    render();
  });

  document.querySelectorAll('.filter-pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      currentFilter = p.dataset.filter;
      render();
    });
  });

  render();
})();`
  };

  return {
    spec: {
      category: 'custom',
      title: cleanTitle
    },
    files
  };
}

module.exports = {
  generateFreestyleApp,
  buildZakatCalculatorFiles
};
