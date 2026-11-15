import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function loadTsModule(relPath) {
  const absPath = path.join(root, relPath);
  const result = esbuild.buildSync({
    entryPoints: [absPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const jsCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('exports', 'module', 'require', '__dirname', '__filename', jsCode);
  fn(mod.exports, mod, require, path.dirname(absPath), absPath);
  return mod.exports;
}

console.log('================================================================');
console.log('🧪 VERIFYING STRICT NON-NEGOTIABLE SPECIFICATION ON ENGINEER');
console.log('================================================================');

// 1. Check Cairo font and sidebar CSS
console.log('▶️ 1. Verifying High-Contrast Sidebar & Typography...');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(indexHtml.includes('Cairo:wght@400;500;600;700;800'), 'Cairo font must be imported in index.html');

const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
assert(indexCss.includes('Cairo'), 'Cairo font must be in font-sans in index.css');
assert(indexCss.includes('-webkit-font-smoothing: antialiased'), 'Font smoothing must be enabled in index.css');
assert(indexCss.includes('@keyframes fadeIn'), 'animate-fadeIn keyframe must exist in index.css');

const appTsx = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
assert(appTsx.includes('w-[272px] min-w-[272px]'), 'Sidebar must be w-[272px] min-w-[272px]');
assert(appTsx.includes('bg-[#0B0F19]'), 'Sidebar background must be solid #0B0F19');
assert(appTsx.includes('border-e border-white/15'), 'Sidebar border must be border-white/15');
assert(appTsx.includes('text-[15px] leading-6 font-semibold'), 'Nav items must have 15px leading-6 font-semibold');
assert(appTsx.includes('text-[#F1F5F9]'), 'Inactive nav items must have text #F1F5F9');
assert(appTsx.includes('border-s-4 border-s-blue-400') || appTsx.includes('border-r-4 border-r-blue-400'), 'Active nav item must have 4px solid blue accent border');
assert(appTsx.includes('w-5 h-5 stroke-[2.2]'), 'Sidebar icons must be w-5 h-5 stroke-[2.2]');
assert(appTsx.includes('dedupeMessages'), 'App.tsx must deduplicate messages to avoid repeated bubbles');
console.log('   ✅ Sidebar and typography strictly compliant.');

// 2. Intent Gatekeeper & Generic App Clarification
console.log('▶️ 2. Verifying Intent Gatekeeper & Generic App Clarification...');
const intentRouter = loadTsModule('src/utils/intentRouter.ts');
assert(typeof intentRouter.isGenericAppRequest === 'function', 'isGenericAppRequest function must exist');

assert(intentRouter.isGenericAppRequest('محتاج تطبيق') === true, 'محتاج تطبيق must be identified as generic');
assert(intentRouter.isGenericAppRequest('محتاج بنا تطبيق') === true, 'محتاج بنا تطبيق must be identified as generic');
assert(intentRouter.isGenericAppRequest('اعمل لي موقع') === true, 'اعمل لي موقع must be identified as generic');
assert(intentRouter.isGenericAppRequest('أريد برنامج') === true, 'أريد برنامج must be identified as generic');
assert(intentRouter.isGenericAppRequest('اصنع لي تطبيق حاسبة نسبة المخاطرة في التداول') === false, 'Specific trading risk app prompt must not be generic');

const intentResult = intentRouter.detectIntent('محتاج تطبيق', 'auto');
assert(intentResult.intent === 'chat', 'Generic prompt must route to Chat mode');
assert(intentResult.subIntent === 'clarification', 'Generic prompt subIntent must be clarification');
console.log('   ✅ Intent router and generic detection strictly compliant.');

// 3. Server Interception & Zero File Touch on Generic Prompts
console.log('▶️ 3. Verifying Server Interception & Clarification Text...');
const serverCode = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
assert(serverCode.includes('أبشر! يسعدني بناء تطبيقك بالكامل'), 'Server must contain the exact Arabic clarification text');
assert(serverCode.includes('منصة تداول وتحليل مالي'), 'Server suggestions must include trading platform');
assert(serverCode.includes('متجر إلكتروني متكامل'), 'Server suggestions must include e-commerce');
assert(serverCode.includes('نظام إدارة ومبيعات'), 'Server suggestions must include CRM & sales');
assert(serverCode.includes('تطبيق مخصص بفكرتي'), 'Server suggestions must include custom app idea');
console.log('   ✅ Server clarification and suggestions strictly compliant.');

// 4. Blank-Until-Live Preview & Single Slim Toolbar
console.log('▶️ 4. Verifying Blank-Until-Live Preview & Slim Single-Row Toolbar...');
const ideWorkspace = fs.readFileSync(path.join(root, 'src/components/IdeWorkspace.tsx'), 'utf8');
assert(ideWorkspace.includes('isAppServerRunning'), 'IdeWorkspace must manage isAppServerRunning state');
assert(ideWorkspace.includes('data-testid="blank-preview-canvas"'), 'IdeWorkspace must render blank-preview-canvas when server is not running');
assert(ideWorkspace.includes('bg-[#09090B]'), 'Blank canvas must be pure deep black #09090B');
assert(ideWorkspace.includes('h-11 px-3 glass-toolbar flex items-center justify-between flex-nowrap overflow-hidden'), 'Toolbar must be single slim row h-11 px-3 flex-nowrap overflow-hidden');
assert(ideWorkspace.includes('w-[390px] min-w-[360px] lg:w-[32%]'), 'Chat panel width must be w-[390px] min-w-[360px] lg:w-[32%]');
console.log('   ✅ Blank-until-live preview and single-row toolbar strictly compliant.');

// 5. Visual Click-to-Edit Inspector & Instant Snapshot Undo
console.log('▶️ 5. Verifying Click-to-Edit Inspector & Snapshot Undo...');
assert(ideWorkspace.includes('handleToggleInspector'), 'IdeWorkspace must implement handleToggleInspector');
assert(ideWorkspace.includes('ENGINEER_TOGGLE_INSPECTOR'), 'IdeWorkspace must post ENGINEER_TOGGLE_INSPECTOR to iframe');
assert(ideWorkspace.includes('ENGINEER_ELEMENT_SELECTED'), 'IdeWorkspace must listen for ENGINEER_ELEMENT_SELECTED from iframe');
assert(ideWorkspace.includes('handleUndoSnapshot'), 'IdeWorkspace must implement handleUndoSnapshot');
assert(ideWorkspace.includes('id="toggle-edit-mode-btn"'), 'IdeWorkspace must have id="toggle-edit-mode-btn"');
assert(ideWorkspace.includes('id="preview-deploy-btn"'), 'IdeWorkspace must have id="preview-deploy-btn"');
console.log('   ✅ Inspector and Snapshot Undo strictly compliant.');

// 6. Autonomous Trading Risk Calculator Builder
console.log('▶️ 6. Verifying Autonomous Trading Risk Calculator Engine...');
const autonomousAppBuilder = loadTsModule('src/utils/autonomousAppBuilder.ts');
assert(typeof autonomousAppBuilder.buildTradingRiskCalculatorFiles === 'function', 'buildTradingRiskCalculatorFiles must exist');

const tradingFiles = autonomousAppBuilder.buildTradingRiskCalculatorFiles('حاسبة نسبة المخاطرة في التداول');
assert(tradingFiles['index.html'].includes('metric-risk-amount'), 'Trading calculator must feature metric-risk-amount');
assert(tradingFiles['index.html'].includes('save-trade-btn'), 'Trading calculator must have save-trade-btn');
assert(tradingFiles['app.js'].includes('calculateRisk'), 'Trading calculator must calculate risk metrics');
assert(tradingFiles['app.js'].includes('localStorage'), 'Trading calculator must persist trades in localStorage');

const fakePlan = {
  id: 'plan-trading-1',
  version: 1,
  title: 'حاسبة نسبة المخاطرة في التداول',
  description: 'حاسبة نسبة المخاطرة والعقود في التداول المالي',
  architecture: 'vanilla-spa',
  techStack: { framework: 'vanilla-js', styling: 'tailwind-cdn', storage: 'localstorage', multimedia: [] },
  uiComponents: ['metric-cards', 'risk-slider', 'trade-table'],
  dbSchema: { tables: [] },
  fileStructure: ['index.html', 'app.js', 'style.css'],
};

const verificationResult = autonomousAppBuilder.verifyGeneratedApp(tradingFiles, fakePlan);
assert(verificationResult.allPassed === true, 'All automated tests for trading risk calculator must pass');
assert(verificationResult.testResults.length === 5, 'Must run all 5 test criteria');

const lifecycleResponse = autonomousAppBuilder.formatCustomerLifecycleResponse('completed', {
  spec: {
    appTitle: 'حاسبة نسبة المخاطرة في التداول',
    appCategory: 'trading_risk_calc',
    features: [],
    constraints: { language: 'ar', designTheme: 'dark' },
  },
  testsCount: 5,
  passedTestsCount: 5,
});
assert(lifecycleResponse.includes('شريط إحصائيات حي لخمسة مؤشرات مخاطرة رئيسية'), 'Completed response must describe trading features');
console.log('   ✅ Autonomous trading risk calculator engine strictly verified.');

console.log('\n================================================================');
console.log('🎉 ALL 6 STRICT SPECIFICATION SUITES PASSED (100% COMPLIANT)');
console.log('================================================================\n');
