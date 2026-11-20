/**
 * فحص وحدة سريع للرقعة — يتحقق أن toolGuard يقبل امتدادات react-ts-vite
 * وأنه ما زال يرفض اختراق المسارات والامتدادات الخطرة.
 *
 * التشغيل من جذر المشروع:
 *   node scripts/verify_toolguard_extensions.mjs
 *
 * النجاح = خروج بصفر أخطاء. الفشل يطبع الحالة التي كسرت.
 */
import assert from 'node:assert/strict';
import { normalizeProjectPath } from '../server_backend/security/toolGuard.js';

/* يجب أن تُقبل بعد الرقعة */
const ACCEPT = [
  'src/App.tsx',
  'src/main.tsx',
  'src/components/Button.tsx',
  'vite.config.ts',
  'src/utils/helpers.ts',
  'src/legacy/widget.jsx',
  'server/routes/api.mjs',
  'config/setup.cjs',
  'styles/theme.scss',
  'styles/legacy.less',
  'db/migrations/027_media_studio.sql',
  'docker-compose.yml',
  'config/app.yaml',
  'Dockerfile',
  '.gitignore',
  // القائمة الأصلية يجب ألا تتكسر
  'index.html', 'styles.css', 'app.js', 'package.json', 'README.md', 'notes.txt', 'icon.svg',
];

/* يجب أن تُرفض دائماً — أمنياً */
const REJECT = [
  '../../etc/passwd',        // خروج من مجلد المشروع
  'src/../../../escape.ts',  // اختراق بامتداد مسموح
  'src/evil.exe',            // امتداد تنفيذي
  'src/payload.sh',          // سكربت شِل
  'src/backdoor.php',
];

let failures = 0;

for (const p of ACCEPT) {
  try {
    normalizeProjectPath(p);
    console.log(`✔ ACCEPTED  ${p}`);
  } catch (err) {
    failures++;
    console.error(`✘ SHOULD-ACCEPT but threw: ${p} → ${err.message}`);
  }
}

for (const p of REJECT) {
  try {
    normalizeProjectPath(p);
    failures++;
    console.error(`✘ SHOULD-REJECT but passed: ${p}`);
  } catch {
    console.log(`✔ REJECTED   ${p}`);
  }
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log('\nAll toolGuard extension checks passed.');
