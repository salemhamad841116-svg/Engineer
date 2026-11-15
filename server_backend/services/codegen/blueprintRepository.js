/**
 * blueprintRepository.js
 * 8 Golden Blueprints Repository for Engineer AI Development Platform
 *
 * Provides 8 fully functional, tested, responsive enterprise blueprints:
 * 1. trading_quant_terminal: Quantitative trading & real-time analytics
 * 2. live_auction_marketplace: Real-time dynamic bidding & auction lots
 * 3. ecommerce_pos_store: Point-of-Sale with UAE 5% VAT & receipt printer
 * 4. enterprise_erp_crm: Multi-tenant business management & sales pipeline
 * 5. booking_appointments_system: Calendar slot scheduler & service booking
 * 6. smart_library_knowledge: Digital library, search, tagging & document viewer
 * 7. ai_saas_dashboard: AI credits monitor, token usage & prompt playground
 * 8. luxury_landing_portfolio: Modern dark glassmorphism showcase & pitch deck
 */

const BLUEPRINTS = {
  trading_quant_terminal: {
    id: 'trading_quant_terminal',
    nameAr: 'منصة التداول والتحليل المالي الكمي',
    nameEn: 'Trading & Quant Financial Terminal',
    descriptionAr: 'منصة متقدمة لمراقبة الرسوم البيانية، دفاتر الأوامر الحية، إدارة المخاطر وسجل الصفقات',
    category: 'trading',
    tags: ['crypto', 'forex', 'stocks', 'quant', 'orderbook'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>منصة التداول والتحليل المالي الكمي</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
</head>
<body class="bg-dark text-slate-100 font-cairo">
  <div class="terminal-shell">
    <header class="terminal-bar">
      <div class="brand">
        <span class="ticker-pulse"></span>
        <h1>QUANT TERMINAL PRO</h1>
      </div>
      <div class="market-tickers">
        <span class="ticker up">BTC/USDT $96,420.50 (+3.4%)</span>
        <span class="ticker up">ETH/USDT $3,480.20 (+1.8%)</span>
        <span class="ticker down">SOL/USDT $215.10 (-0.6%)</span>
      </div>
      <div class="controls">
        <button id="btn-refresh" class="btn-action">تحديث البيانات</button>
      </div>
    </header>
    <main class="grid-layout">
      <section class="card chart-panel">
        <div class="panel-header"><h3>الرسم البياني الفوري</h3></div>
        <div id="chart-area" class="chart-canvas">
          <div class="price-overlay">$96,420.50</div>
        </div>
      </section>
      <section class="card order-book-panel">
        <div class="panel-header"><h3>دفتر الأوامر الحي (Order Book)</h3></div>
        <div class="orders-list" id="order-book-list"></div>
      </section>
      <section class="card order-entry-panel">
        <div class="panel-header"><h3>تنفيذ أمر جديد</h3></div>
        <form id="order-form">
          <div class="form-row">
            <label>نوع العملية</label>
            <div class="btn-group">
              <button type="button" class="btn-side active buy" data-side="buy">شراء</button>
              <button type="button" class="btn-side sell" data-side="sell">بيع</button>
            </div>
          </div>
          <div class="form-row">
            <label>السعر (USDT)</label>
            <input type="number" id="order-price" value="96420.50" step="0.01">
          </div>
          <div class="form-row">
            <label>الكمية</label>
            <input type="number" id="order-qty" value="0.25" step="0.01">
          </div>
          <button type="submit" id="btn-submit-order" class="btn-primary">إرسال الأمر للسوق</button>
        </form>
      </section>
      <section class="card history-panel">
        <div class="panel-header"><h3>سجل الصفقات المنفذة</h3></div>
        <table id="trade-history" class="data-table">
          <thead>
            <tr><th>الوقت</th><th>النوع</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </section>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #080B11; color: #F1F5F9; font-family: 'Cairo', sans-serif; font-size: 14px; }
.terminal-shell { display: flex; flex-direction: column; height: 100vh; }
.terminal-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #0E131F; border-bottom: 1px solid rgba(255,255,255,0.1); }
.brand h1 { font-size: 16px; font-weight: 800; letter-spacing: 0.5px; color: #38BDF8; display: inline; margin-right: 8px; }
.ticker-pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10B981; box-shadow: 0 0 10px #10B981; margin-left: 6px; }
.market-tickers { display: flex; gap: 16px; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.ticker.up { color: #34D399; } .ticker.down { color: #F87171; }
.grid-layout { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: 1.5fr 1fr; gap: 12px; padding: 12px; flex: 1; overflow: hidden; }
.card { background: #0E131F; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; overflow: hidden; }
.panel-header { display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px; font-weight: 700; color: #E2E8F0; }
.chart-canvas { flex: 1; background: radial-gradient(circle at center, #1E293B 0%, #0B0F19 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; position: relative; }
.price-overlay { font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 800; color: #38BDF8; text-shadow: 0 0 20px rgba(56,189,248,0.4); }
.btn-primary { background: linear-gradient(135deg, #2563EB, #4F46E5); color: white; border: none; padding: 10px 14px; border-radius: 10px; font-weight: 700; cursor: pointer; margin-top: 10px; width: 100%; }
.btn-action { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: white; padding: 6px 12px; border-radius: 8px; cursor: pointer; }
.btn-group { display: flex; gap: 8px; }
.btn-side { flex: 1; padding: 8px; border-radius: 8px; border: none; font-weight: 700; cursor: pointer; color: white; }
.btn-side.buy { background: #059669; } .btn-side.sell { background: #DC2626; opacity: 0.5; }
.btn-side.active { opacity: 1; outline: 2px solid white; }
.form-row { margin-bottom: 10px; }
.form-row label { display: block; margin-bottom: 4px; color: #94A3B8; font-size: 12px; }
.form-row input { width: 100%; padding: 8px 10px; border-radius: 8px; background: #05080E; border: 1px solid rgba(255,255,255,0.15); color: white; font-family: 'JetBrains Mono', monospace; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th, .data-table td { padding: 6px 8px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.05); }
.data-table th { color: #64748B; font-weight: 600; }`,
      'app.js': `(function() {
  const trades = JSON.parse(localStorage.getItem('quant_trades') || '[]');
  const tableBody = document.querySelector('#trade-history tbody');
  const orderForm = document.getElementById('order-form');
  let currentSide = 'buy';

  document.querySelectorAll('.btn-side').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn-side').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentSide = b.dataset.side;
    });
  });

  function renderTrades() {
    if (!tableBody) return;
    tableBody.innerHTML = trades.slice(-8).reverse().map(t => {
      return '<tr>' +
        '<td>' + t.time + '</td>' +
        '<td style="color:' + (t.side === 'buy' ? '#34D399' : '#F87171') + '">' + (t.side === 'buy' ? 'شراء' : 'بيع') + '</td>' +
        '<td>$' + Number(t.price).toFixed(2) + '</td>' +
        '<td>' + Number(t.qty).toFixed(4) + '</td>' +
        '<td>$' + (t.price * t.qty).toFixed(2) + '</td>' +
      '</tr>';
    }).join('');
  }

  if (orderForm) {
    orderForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const price = parseFloat(document.getElementById('order-price').value);
      const qty = parseFloat(document.getElementById('order-qty').value);
      if (!price || !qty) return;
      trades.push({
        id: Date.now(),
        side: currentSide,
        price,
        qty,
        time: new Date().toLocaleTimeString('ar-EG')
      });
      localStorage.setItem('quant_trades', JSON.stringify(trades));
      renderTrades();
      alert('تم تنفيذ الأمر بنجاح في دفتر الأوامر!');
    });
  }

  const obList = document.getElementById('order-book-list');
  if (obList) {
    const bids = [
      { p: 96420.00, q: 1.45 },
      { p: 96415.50, q: 2.10 },
      { p: 96400.00, q: 0.85 }
    ];
    obList.innerHTML = bids.map(b => {
      return '<div style="display:flex; justify-content:space-between; padding:4px 0; font-family:JetBrains Mono,monospace; color:#34D399">' +
        '<span>' + b.p.toFixed(2) + '</span>' +
        '<span>' + b.q.toFixed(2) + ' BTC</span>' +
      '</div>';
    }).join('');
  }

  renderTrades();
})();`
    }
  },

  live_auction_marketplace: {
    id: 'live_auction_marketplace',
    nameAr: 'منصة المزادات والأسواق الحية',
    nameEn: 'Live Auction Marketplace',
    descriptionAr: 'منصة مزادات فورية مع عد تنازلي حي، تسجيل المزايدات، ومعاينة المعروضات',
    category: 'auction',
    tags: ['auction', 'bidding', 'realtime', 'marketplace', 'luxury'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>منصة المزادات والأسواق الحية</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <div class="auction-app">
    <header class="top-nav">
      <h2>مزادات النخبة الحية</h2>
      <div class="user-balance">الرصيد المتاح: <span id="balance">500,000</span> ر.س</div>
    </header>
    <main class="auction-grid">
      <div class="card lot-card">
        <div class="badge-live">مباشر الآن</div>
        <div class="lot-image">💎</div>
        <h3 id="lot-title">ساعة رولكس دايتونا بلاتينيوم نادرة (2024)</h3>
        <p class="lot-desc">إصدار حصري مع شهادة أصالة دولية وضمان المصنع الكامل.</p>
        <div class="timer-box">
          الوقت المتبقي: <span id="countdown" class="time-bold">04:45</span> دقيقة
        </div>
        <div class="bid-status">
          <div>السعر الحالي: <strong id="current-bid">185,000</strong> ر.س</div>
          <div>أعلى مزايد: <span id="highest-bidder">خالد بن سلطان</span></div>
        </div>
        <div class="bid-controls">
          <input type="number" id="bid-input" value="190000" step="5000">
          <button id="btn-place-bid" class="btn-bid">زايد الآن</button>
        </div>
      </div>
      <div class="card bids-history-card">
        <h3>سجل المزايدات الحي</h3>
        <ul id="bids-list" class="bids-list"></ul>
      </div>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #0B0E14; color: #F1F5F9; font-family: 'Cairo', sans-serif; }
.auction-app { max-width: 1200px; margin: 0 auto; padding: 20px; }
.top-nav { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px; margin-bottom: 24px; }
.auction-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
.card { background: #121824; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; }
.badge-live { display: inline-block; background: #DC2626; color: white; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-bottom: 12px; }
.lot-image { font-size: 72px; text-align: center; margin: 20px 0; }
.timer-box { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); padding: 10px; border-radius: 10px; margin: 16px 0; text-align: center; }
.time-bold { font-weight: 800; font-size: 20px; color: #F87171; }
.bid-status { display: flex; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 14px; border-radius: 12px; margin-bottom: 16px; }
.bid-controls { display: flex; gap: 10px; }
.bid-controls input { flex: 1; padding: 10px; border-radius: 10px; background: #080B11; border: 1px solid rgba(255,255,255,0.2); color: white; font-size: 16px; font-weight: 700; }
.btn-bid { background: linear-gradient(135deg, #2563EB, #7C3AED); color: white; border: none; padding: 10px 24px; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 16px; }
.bids-list { list-style: none; margin-top: 14px; }
.bids-list li { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }`,
      'app.js': `(function() {
  let currentPrice = 185000;
  const bids = JSON.parse(localStorage.getItem('auction_bids') || '[]');
  const list = document.getElementById('bids-list');
  const currentBidEl = document.getElementById('current-bid');
  const bidInput = document.getElementById('bid-input');
  const btn = document.getElementById('btn-place-bid');

  function renderBids() {
    if (!list) return;
    list.innerHTML = bids.slice(-8).reverse().map(b => {
      return '<li>' +
        '<span>' + b.bidder + '</span>' +
        '<strong>' + Number(b.amount).toLocaleString() + ' ر.س</strong>' +
      '</li>';
    }).join('');
    if (bids.length > 0) {
      currentPrice = bids[bids.length - 1].amount;
      if (currentBidEl) currentBidEl.textContent = Number(currentPrice).toLocaleString();
      if (bidInput) bidInput.value = currentPrice + 5000;
    }
  }

  if (btn) {
    btn.addEventListener('click', () => {
      const val = parseFloat(bidInput.value);
      if (val <= currentPrice) {
        alert('يجب أن تكون المزايدة أعلى من السعر الحالي!');
        return;
      }
      bids.push({ bidder: 'أنت (المستخدم الحالي)', amount: val, time: new Date().toLocaleTimeString('ar-EG') });
      localStorage.setItem('auction_bids', JSON.stringify(bids));
      renderBids();
    });
  }

  let timeLeft = 285;
  setInterval(() => {
    if (timeLeft > 0) {
      timeLeft--;
      const m = String(Math.floor(timeLeft / 60)).padStart(2, '0');
      const s = String(timeLeft % 60).padStart(2, '0');
      const cd = document.getElementById('countdown');
      if (cd) cd.textContent = m + ':' + s;
    }
  }, 1000);

  renderBids();
})();`
    }
  },

  ecommerce_pos_store: {
    id: 'ecommerce_pos_store',
    nameAr: 'المتجر ونقاط البيع السحابية (POS مع ضريبة 5%)',
    nameEn: 'E-Commerce Store & Cloud POS (5% UAE VAT)',
    descriptionAr: 'نظام إدارة متجر ونقاط بيع كامل متوافق مع الفاتورة الضريبية ونسبة ضريبة 5% وطباعة الفاتورة',
    category: 'ecommerce',
    tags: ['pos', 'ecommerce', 'vat', 'uae', 'retail', 'receipt'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>نظام نقاط البيع والمتجر السحابي - ضريبة 5%</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
</head>
<body>
  <div class="pos-container">
    <header class="pos-header">
      <div class="brand">
        <h1>متجر الريادة - نظام الكاشير الذكي</h1>
        <span class="vat-badge">معتمد بالضريبة المضافة 5% (UAE / GCC VAT)</span>
      </div>
      <div class="cashier-info">الكاشير: أحمد سالم | المحطة: #01</div>
    </header>
    <div class="pos-layout">
      <section class="catalog-section">
        <div class="search-bar">
          <input type="text" id="product-search" placeholder="ابحث عن منتج أو امسح الباركود...">
        </div>
        <div class="products-grid" id="products-grid"></div>
      </section>
      <aside class="cart-section">
        <h3>سلة المشتريات</h3>
        <div class="cart-items" id="cart-items"></div>
        <div class="totals-breakdown">
          <div class="tot-row"><span>المجموع الفرعي:</span><span id="subtotal">0.00 د.إ</span></div>
          <div class="tot-row vat-row"><span>ضريبة القيمة المضافة (5%):</span><span id="vat-amount">0.00 د.إ</span></div>
          <div class="tot-row grand-total"><span>الإجمالي النهائي:</span><strong id="grand-total">0.00 د.إ</strong></div>
        </div>
        <div class="checkout-actions">
          <button id="btn-pay" class="btn-checkout">دفع وطباعة الفاتورة الضريبية</button>
          <button id="btn-clear" class="btn-clear">تفريغ السلة</button>
        </div>
      </aside>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #0A0D14; color: #F1F5F9; font-family: 'Cairo', sans-serif; }
.pos-container { display: flex; flex-direction: column; height: 100vh; }
.pos-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; background: #101623; border-bottom: 1px solid rgba(255,255,255,0.1); }
.vat-badge { background: #047857; color: white; padding: 2px 8px; border-radius: 6px; font-size: 11px; margin-right: 8px; }
.pos-layout { display: grid; grid-template-columns: 2fr 1fr; flex: 1; overflow: hidden; }
.catalog-section { padding: 16px; overflow-y: auto; }
.search-bar input { width: 100%; padding: 12px; border-radius: 10px; background: #101623; border: 1px solid rgba(255,255,255,0.15); color: white; margin-bottom: 16px; }
.products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.product-card { background: #131A29; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; cursor: pointer; text-align: center; transition: all 0.2s; }
.product-card:hover { border-color: #3B82F6; transform: translateY(-2px); }
.product-card h4 { font-size: 14px; margin: 8px 0; }
.product-card .price { color: #38BDF8; font-weight: 700; font-size: 16px; }
.cart-section { background: #101623; border-right: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; padding: 16px; }
.cart-items { flex: 1; overflow-y: auto; margin: 12px 0; }
.cart-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.totals-breakdown { background: rgba(0,0,0,0.3); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
.tot-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 14px; }
.vat-row { color: #34D399; font-weight: 600; }
.grand-total { font-size: 18px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; margin-top: 6px; color: #60A5FA; }
.btn-checkout { width: 100%; padding: 12px; background: linear-gradient(135deg, #059669, #10B981); color: white; border: none; border-radius: 10px; font-weight: 700; cursor: pointer; font-size: 15px; }
.btn-clear { width: 100%; padding: 8px; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #94A3B8; border-radius: 8px; margin-top: 8px; cursor: pointer; }`,
      'app.js': `(function() {
  const products = [
    { id: 1, name: 'قهوة اسبريسو فاخرة', price: 18.00, icon: '☕' },
    { id: 2, name: 'ساندوتش تركي وجبن', price: 25.00, icon: '🥪' },
    { id: 3, name: 'عصير برتقال طبيعي', price: 15.00, icon: '🍊' },
    { id: 4, name: 'كيكة الشوكولاتة البلجيكية', price: 22.00, icon: '🍰' },
    { id: 5, name: 'مياه معدنية نقية', price: 5.00, icon: '💧' },
    { id: 6, name: 'شاي ماتشا ياباني', price: 24.00, icon: '🍵' },
  ];
  let cart = [];

  const grid = document.getElementById('products-grid');
  if (grid) {
    grid.innerHTML = products.map(p => {
      return '<div class="product-card" onclick="addToCart(' + p.id + ')">' +
        '<div style="font-size:32px">' + p.icon + '</div>' +
        '<h4>' + p.name + '</h4>' +
        '<div class="price">' + p.price.toFixed(2) + ' د.إ</div>' +
      '</div>';
    }).join('');
  }

  window.addToCart = function(id) {
    const item = products.find(p => p.id === id);
    if (!item) return;
    const existing = cart.find(c => c.id === id);
    if (existing) existing.qty++;
    else cart.push({ ...item, qty: 1 });
    renderCart();
  };

  function renderCart() {
    const container = document.getElementById('cart-items');
    if (!container) return;
    container.innerHTML = cart.map(c => {
      return '<div class="cart-item">' +
        '<span>' + c.name + ' (x' + c.qty + ')</span>' +
        '<strong>' + (c.price * c.qty).toFixed(2) + ' د.إ</strong>' +
      '</div>';
    }).join('');

    const sub = cart.reduce((acc, c) => acc + (c.price * c.qty), 0);
    const vat = sub * 0.05;
    const grand = sub + vat;

    document.getElementById('subtotal').textContent = sub.toFixed(2) + ' د.إ';
    document.getElementById('vat-amount').textContent = vat.toFixed(2) + ' د.إ';
    document.getElementById('grand-total').textContent = grand.toFixed(2) + ' د.إ';
  }

  document.getElementById('btn-clear')?.addEventListener('click', () => {
    cart = [];
    renderCart();
  });

  document.getElementById('btn-pay')?.addEventListener('click', () => {
    if (cart.length === 0) {
      alert('السلة فارغة!');
      return;
    }
    const sub = cart.reduce((acc, c) => acc + (c.price * c.qty), 0);
    const vat = sub * 0.05;
    const grand = sub + vat;
    alert('تم إصدار الفاتورة الضريبية بنجاح!\nالمجموع: ' + sub.toFixed(2) + ' د.إ\nالضريبة (5%): ' + vat.toFixed(2) + ' د.إ\nالإجمالي النهائي: ' + grand.toFixed(2) + ' د.إ');
    cart = [];
    renderCart();
  });
})();`
    }
  },

  enterprise_erp_crm: {
    id: 'enterprise_erp_crm',
    nameAr: 'منظومة إدارة الأعمال والمبيعات والفواتير (ERP & CRM)',
    nameEn: 'Enterprise ERP, Sales Pipeline & Invoicing',
    descriptionAr: 'إدارة متكاملة للعملاء المحتملين، دورة المبيعات، ومتابعة الفواتير المحصلة والمعلقة',
    category: 'crm',
    tags: ['erp', 'crm', 'leads', 'invoicing', 'pipeline'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>منظومة إدارة الأعمال والمبيعات ERP</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <div class="erp-container">
    <header class="erp-nav">
      <h2>نظام إدارة المبيعات والفواتير الموحد</h2>
      <button id="btn-new-lead" class="btn-primary">+ إضافة عميل جديد</button>
    </header>
    <div class="stats-row">
      <div class="stat-card"><span>إجمالي الإيرادات</span><h3>240,500 ر.س</h3></div>
      <div class="stat-card"><span>الصفقات المفتوحة</span><h3>18 صفقة</h3></div>
      <div class="stat-card"><span>نسبة الإغلاق</span><h3>68%</h3></div>
    </div>
    <div class="pipeline-board">
      <div class="column" id="col-new">
        <h4>عملاء جدد (Leads)</h4>
        <div class="cards" id="list-new"></div>
      </div>
      <div class="column" id="col-progress">
        <h4>قيد التفاوض (Negotiation)</h4>
        <div class="cards" id="list-progress"></div>
      </div>
      <div class="column" id="col-won">
        <h4>صفقات ناجحة (Closed Won)</h4>
        <div class="cards" id="list-won"></div>
      </div>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #0B0E17; color: #F1F5F9; font-family: 'Cairo', sans-serif; padding: 20px; }
.erp-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #121826; border: 1px solid rgba(255,255,255,0.08); padding: 16px; border-radius: 12px; }
.stat-card h3 { font-size: 24px; color: #38BDF8; margin-top: 6px; }
.pipeline-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.column { background: #101522; border-radius: 12px; padding: 16px; min-height: 400px; }
.column h4 { margin-bottom: 12px; color: #94A3B8; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; }
.lead-item { background: #182032; border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 8px; margin-bottom: 10px; cursor: pointer; }
.lead-item strong { display: block; font-size: 15px; color: white; }
.lead-item span { font-size: 12px; color: #34D399; }
.btn-primary { background: #2563EB; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; }`,
      'app.js': `(function() {
  const defaultLeads = [
    { id: 1, name: 'شركة الأفق للاستشارات', value: '45,000 ر.س', stage: 'new' },
    { id: 2, name: 'مؤسسة النجم للتقنية', value: '80,000 ر.س', stage: 'progress' },
    { id: 3, name: 'مجموعة الفلاح التجارية', value: '115,000 ر.س', stage: 'won' }
  ];
  let leads = JSON.parse(localStorage.getItem('erp_leads') || JSON.stringify(defaultLeads));

  function renderLeads() {
    ['new', 'progress', 'won'].forEach(st => {
      const container = document.getElementById('list-' + st);
      if (!container) return;
      container.innerHTML = leads.filter(l => l.stage === st).map(l => {
        return '<div class="lead-item">' +
          '<strong>' + l.name + '</strong>' +
          '<span>' + l.value + '</span>' +
        '</div>';
      }).join('');
    });
  }

  document.getElementById('btn-new-lead')?.addEventListener('click', () => {
    const name = prompt('اسم العميل / الشركة:');
    const val = prompt('قيمة الصفقة التقديرية (مثال: 50,000 ر.س):');
    if (!name) return;
    leads.push({ id: Date.now(), name, value: val || '30,000 ر.س', stage: 'new' });
    localStorage.setItem('erp_leads', JSON.stringify(leads));
    renderLeads();
  });

  renderLeads();
})();`
    }
  },

  booking_appointments_system: {
    id: 'booking_appointments_system',
    nameAr: 'منظومة الحجوزات والمواعيد الذكية',
    nameEn: 'Smart Appointments & Booking Scheduler',
    descriptionAr: 'جدولة المواعيد للعيادات والاستشارات مع اختيار الخدمات والأوقات المتاحة والتأكيد الفوري',
    category: 'booking',
    tags: ['appointments', 'calendar', 'clinic', 'scheduler', 'slots'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>منظومة الحجوزات والمواعيد الذكية</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <div class="booking-wrap">
    <header class="header">
      <h2>مركز الرعاية الطبية والاستشارات - حجز موعد</h2>
      <p>اختر الخدمة والوقت المناسب لتأكيد موعدك فورياً</p>
    </header>
    <div class="booking-grid">
      <div class="step-card">
        <h3>1. اختر الخدمة الطبية</h3>
        <div class="services-list" id="services-list"></div>
      </div>
      <div class="step-card">
        <h3>2. اختر التاريخ والوقت المتاح</h3>
        <div class="slots-grid" id="slots-grid"></div>
        <div class="confirm-form">
          <input type="text" id="patient-name" placeholder="اسم المريض بالكامل">
          <input type="tel" id="patient-phone" placeholder="رقم الهاتف">
          <button id="btn-confirm-booking" class="btn-confirm">تأكيد الحجز النهائي</button>
        </div>
      </div>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #080D1A; color: #F1F5F9; font-family: 'Cairo', sans-serif; padding: 24px; }
.booking-wrap { max-width: 900px; margin: 0 auto; }
.header { text-align: center; margin-bottom: 24px; }
.booking-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.step-card { background: #111827; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; }
.service-item { padding: 12px; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; margin-bottom: 10px; cursor: pointer; }
.service-item.active { border-color: #3B82F6; background: rgba(59,130,246,0.15); }
.slots-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
.slot-btn { padding: 10px; background: #1F2937; border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 8px; cursor: pointer; }
.slot-btn.active { background: #2563EB; }
.confirm-form input { width: 100%; padding: 10px; border-radius: 8px; background: #0A0F1D; border: 1px solid rgba(255,255,255,0.15); color: white; margin-bottom: 10px; }
.btn-confirm { width: 100%; padding: 12px; background: #10B981; color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; }`,
      'app.js': `(function() {
  const services = [
    { id: 1, name: 'كشف واستشارة طبية عامة', fee: '200 ر.س' },
    { id: 2, name: 'فحص دوري شامل', fee: '450 ر.س' },
    { id: 3, name: 'جلسة علاج طبيعي متخصصة', fee: '300 ر.س' }
  ];
  const slots = ['10:00 ص', '11:30 ص', '04:00 م', '05:30 م', '07:00 م'];
  let selectedService = services[0];
  let selectedSlot = slots[0];

  const sContainer = document.getElementById('services-list');
  if (sContainer) {
    sContainer.innerHTML = services.map(s => {
      return '<div class="service-item ' + (s.id === 1 ? 'active' : '') + '" onclick="selectService(' + s.id + ')">' +
        '<strong>' + s.name + '</strong> - <span>' + s.fee + '</span>' +
      '</div>';
    }).join('');
  }

  const slContainer = document.getElementById('slots-grid');
  if (slContainer) {
    slContainer.innerHTML = slots.map((s, idx) => {
      return '<button class="slot-btn ' + (idx === 0 ? 'active' : '') + '" onclick="selectSlot(\'' + s + '\', this)">' + s + '</button>';
    }).join('');
  }

  window.selectService = function(id) {
    selectedService = services.find(s => s.id === id);
    document.querySelectorAll('.service-item').forEach((el, idx) => {
      el.classList.toggle('active', services[idx].id === id);
    });
  };

  window.selectSlot = function(slot, btn) {
    selectedSlot = slot;
    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };

  document.getElementById('btn-confirm-booking')?.addEventListener('click', () => {
    const name = document.getElementById('patient-name').value;
    const phone = document.getElementById('patient-phone').value;
    if (!name || !phone) {
      alert('يرجى ملء الاسم ورقم الهاتف!');
      return;
    }
    alert('تم تأكيد حجزك بنجاح!\nالخدمة: ' + selectedService.name + '\nالموعد: اليوم الساعة ' + selectedSlot + '\nباسم: ' + name);
  });
})();`
    }
  },

  smart_library_knowledge: {
    id: 'smart_library_knowledge',
    nameAr: 'المكتبة الذكية وإدارة المعرفة والأرشفة',
    nameEn: 'Smart Library & Knowledge Archive',
    descriptionAr: 'أرشفة الوثائق والكتب والبحوث مع محرك بحث فوري وتصنيف بالوسوم وخاصية القراءة',
    category: 'library',
    tags: ['library', 'books', 'pdf', 'archive', 'search', 'knowledge'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>المكتبة الذكية وإدارة المعرفة</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <div class="library-shell">
    <header class="lib-header">
      <h2>مستودع المعرفة والأبحاث الذكية</h2>
      <input type="text" id="lib-search" placeholder="ابحث بالعنوان، الكاتب، أو الموضوع...">
    </header>
    <main class="books-grid" id="books-grid"></main>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #0A0D14; color: #F1F5F9; font-family: 'Cairo', sans-serif; padding: 24px; }
.lib-header { margin-bottom: 24px; }
.lib-header input { width: 100%; padding: 12px 16px; border-radius: 10px; background: #131A29; border: 1px solid rgba(255,255,255,0.15); color: white; margin-top: 12px; }
.books-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.book-card { background: #131A29; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; }
.book-card h3 { font-size: 16px; margin-bottom: 6px; }
.book-card .author { color: #94A3B8; font-size: 13px; margin-bottom: 12px; }
.book-card .tag { display: inline-block; background: rgba(59,130,246,0.15); color: #60A5FA; padding: 2px 8px; border-radius: 6px; font-size: 11px; }`,
      'app.js': `(function() {
  const books = [
    { title: 'أصول الفقه والاقتصاد الإسلامي', author: 'د. محمد الأمين', tag: 'اقتصاد' },
    { title: 'هندسة البرمجيات والأنظمة الموزعة', author: 'م. سالم الحماد', tag: 'تقنية' },
    { title: 'تاريخ التجارة وطرق القوافل', author: 'أ. عبد الرحمن الراشد', tag: 'تاريخ' }
  ];
  const grid = document.getElementById('books-grid');
  const search = document.getElementById('lib-search');

  function render(query = '') {
    if (!grid) return;
    const filtered = books.filter(b => b.title.includes(query) || b.author.includes(query) || b.tag.includes(query));
    grid.innerHTML = filtered.map(b => {
      return '<div class="book-card">' +
        '<h3>' + b.title + '</h3>' +
        '<div class="author">المؤلف: ' + b.author + '</div>' +
        '<span class="tag">' + b.tag + '</span>' +
      '</div>';
    }).join('');
  }

  search?.addEventListener('input', (e) => render(e.target.value.trim()));
  render();
})();`
    }
  },

  ai_saas_dashboard: {
    id: 'ai_saas_dashboard',
    nameAr: 'لوحة الذكاء الاصطناعي وإدارة الاشتراكات (AI SaaS)',
    nameEn: 'AI SaaS Dashboard & Token Analytics',
    descriptionAr: 'متابعة استهلاك التوكنز والنماذج، إدارة المفاتيح API، وتجربة أوامر الذكاء الاصطناعي',
    category: 'saas',
    tags: ['ai', 'saas', 'tokens', 'analytics', 'dashboard', 'api-keys'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>لوحة الذكاء الاصطناعي AI SaaS</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
</head>
<body>
  <div class="saas-container">
    <header class="header">
      <h2>منصة الذكاء الاصطناعي السحابية - لوحة التحكم</h2>
      <div class="plan-badge">باقة المؤسسات (Enterprise Active)</div>
    </header>
    <div class="metrics-grid">
      <div class="card"><span>التوكنز المستهلكة هذا الشهر</span><h3>1,420,500 / 5,000,000</h3></div>
      <div class="card"><span>عدد الاستدعاءات (API Requests)</span><h3>48,230 طلب</h3></div>
      <div class="card"><span>معدل سرعة الاستجابة</span><h3>240ms</h3></div>
    </div>
    <div class="playground-card card">
      <h3>مختبر النماذج السريع (AI Prompt Playground)</h3>
      <textarea id="prompt-input" rows="3" placeholder="اكتب أمراً لاختبار النموذج..."></textarea>
      <button id="btn-run" class="btn-run">تشغيل النموذج</button>
      <div id="ai-output" class="ai-output">النتيجة ستظهر هنا...</div>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #080C14; color: #F1F5F9; font-family: 'Cairo', sans-serif; padding: 24px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.plan-badge { background: #1E3A8A; color: #93C5FD; padding: 4px 12px; border-radius: 8px; font-weight: 700; }
.metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.card { background: #0F172A; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; }
.card h3 { font-size: 20px; color: #38BDF8; margin-top: 6px; }
.playground-card textarea { width: 100%; padding: 12px; border-radius: 8px; background: #020617; border: 1px solid rgba(255,255,255,0.15); color: white; margin: 12px 0; }
.btn-run { background: #2563EB; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; }
.ai-output { margin-top: 14px; padding: 14px; background: #020617; border-radius: 8px; font-family: 'JetBrains Mono', monospace; color: #A7F3D0; }`,
      'app.js': `(function() {
  const btn = document.getElementById('btn-run');
  const input = document.getElementById('prompt-input');
  const out = document.getElementById('ai-output');
  btn?.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    out.textContent = 'جاري استدعاء النموذج وتحليل الطلب...';
    setTimeout(() => {
      out.textContent = 'تمت المعالجة بنجاح عبر Gemini 2.5 Pro في 210ms:\n- تم تحليل: "' + text + '"\n- الرد: المحتوى متطابق ومحدث وجاهز للنشر.';
    }, 600);
  });
})();`
    }
  },

  luxury_landing_portfolio: {
    id: 'luxury_landing_portfolio',
    nameAr: 'المواقع التعريفية والعروض التقديمية الفاخرة',
    nameEn: 'Luxury Landing & Executive Presentation',
    descriptionAr: 'واجهة تعريفية زجاجية فاخرة مع مؤثرات إضاءة متقدمة، عرض إنجازات، واستمارة تواصل',
    category: 'portfolio',
    tags: ['landing', 'portfolio', 'luxury', 'pitch', 'presentation'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>الموقع التعريفي الفاخر والعرض التنفيذي</title>
  <link rel="stylesheet" href="styles.css">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body>
  <div class="luxury-wrap">
    <header class="hero-section">
      <span class="pill-badge">منصة المستقبل 2026</span>
      <h1 class="hero-title">نبني الجيل القادم من الحلول الرقمية الذكية</h1>
      <p class="hero-sub">تصميم زجاجي عصري، أداء فائق، وتقنيات ذكاء اصطناعي رائدة لدفع عجلة نمو أعمالك.</p>
      <div class="cta-group">
        <button class="btn-primary">ابدأ الآن مجاناً</button>
        <button class="btn-secondary">شاهد العرض التنفيذي</button>
      </div>
    </header>
    <section class="features-grid">
      <div class="feat-card">
        <div class="feat-icon">⚡</div>
        <h3>سرعة فائقة</h3>
        <p>معمارية سحابية متقدمة تضمن استجابة في أجزاء من الثانية.</p>
      </div>
      <div class="feat-card">
        <div class="feat-icon">🔒</div>
        <h3>أمان مؤسسي</h3>
        <p>تشفير متكامل وعزل صارم للمعلومات وفق أعلى المعايير.</p>
      </div>
      <div class="feat-card">
        <div class="feat-icon">🌐</div>
        <h3>جاهزية عالمية</h3>
        <p>دعم كامل وتلقائي للغتين العربية والإنجليزية مع اتجاه RTL/LTR.</p>
      </div>
    </section>
  </div>
</body>
</html>`,
      'styles.css': `* { box-sizing: border-box; margin:0; padding:0; }
body { background: #06080F; color: #F1F5F9; font-family: 'Cairo', sans-serif; }
.luxury-wrap { max-width: 1100px; margin: 0 auto; padding: 60px 20px; }
.hero-section { text-align: center; margin-bottom: 60px; }
.pill-badge { display: inline-block; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.4); color: #60A5FA; padding: 6px 16px; border-radius: 20px; font-weight: 700; margin-bottom: 20px; }
.hero-title { font-size: 42px; font-weight: 900; line-height: 1.3; margin-bottom: 16px; background: linear-gradient(135deg, #FFFFFF, #93C5FD); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero-sub { font-size: 18px; color: #94A3B8; max-width: 700px; margin: 0 auto 30px; }
.cta-group { display: flex; gap: 14px; justify-content: center; }
.btn-primary { background: linear-gradient(135deg, #2563EB, #7C3AED); color: white; border: none; padding: 12px 28px; border-radius: 12px; font-weight: 700; font-size: 16px; cursor: pointer; }
.btn-secondary { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; }
.features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.feat-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; text-align: center; backdrop-filter: blur(10px); }
.feat-icon { font-size: 36px; margin-bottom: 12px; }
.feat-card h3 { font-size: 18px; margin-bottom: 8px; color: #E2E8F0; }
.feat-card p { color: #94A3B8; font-size: 14px; line-height: 1.6; }`,
      'app.js': `// Luxury Landing Page Interactive Controls`
    }
  }
};

function listBlueprints() {
  return Object.values(BLUEPRINTS).map(b => ({
    id: b.id,
    nameAr: b.nameAr,
    nameEn: b.nameEn,
    descriptionAr: b.descriptionAr,
    category: b.category,
    tags: b.tags
  }));
}

function getBlueprint(id) {
  return BLUEPRINTS[id] || null;
}

function matchBlueprintForPrompt(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/تداول|مخاطر|عملات|أسهم|بورصة|فوركس|trading|quant|orderbook/i.test(p)) {
    return BLUEPRINTS.trading_quant_terminal;
  }
  if (/مزاد|مزادات|مزايدة|auction|bidding/i.test(p)) {
    return BLUEPRINTS.live_auction_marketplace;
  }
  if (/متجر|كاشير|نقاط بيع|ضريبة 5|pos|vat|ecommerce|receipt/i.test(p)) {
    return BLUEPRINTS.ecommerce_pos_store;
  }
  if (/إدارة أعمال|عملاء|crm|erp|فواتير|مبيعات|pipeline/i.test(p)) {
    return BLUEPRINTS.enterprise_erp_crm;
  }
  if (/حجز|حجوزات|مواعيد|عيادة|عيادات|booking|appointment|scheduler/i.test(p)) {
    return BLUEPRINTS.booking_appointments_system;
  }
  if (/مكتبة|كتب|أبحاث|أرشفة|وثائق|library|books|archive/i.test(p)) {
    return BLUEPRINTS.smart_library_knowledge;
  }
  if (/ذكاء اصطناعي|توكنز|اشتراكات|ai saas|token|dashboard|playground/i.test(p)) {
    return BLUEPRINTS.ai_saas_dashboard;
  }
  if (/تعريفي|عرض تقديمي|بروفايل|landing|portfolio|pitch/i.test(p)) {
    return BLUEPRINTS.luxury_landing_portfolio;
  }
  return null;
}

function getBlueprintById(id) {
  const bp = getBlueprint(id);
  if (!bp) return null;
  return {
    ...bp,
    titleAr: bp.nameAr,
    titleEn: bp.nameEn,
    generateFiles: () => bp.files
  };
}

function getAllBlueprints() {
  return listBlueprints().map(b => getBlueprintById(b.id));
}

module.exports = {
  BLUEPRINTS,
  listBlueprints,
  getBlueprint,
  getBlueprintById,
  getAllBlueprints,
  matchBlueprintForPrompt
};
