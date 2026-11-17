process.env.NODE_ENV = 'test';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
const intentRouterSource = fs.readFileSync(path.resolve(__dirname, '../../src/utils/intentRouter.ts'), 'utf8');
const launchpadSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/HomeLaunchpad.tsx'), 'utf8');

assert.ok(!serverSource.includes("intentResult.subIntent === 'create_conflict'"), 'server must not short-circuit build prompts with create_conflict');
assert.ok(!intentRouterSource.includes("subIntent: 'create_conflict'"), 'intent router must not emit create_conflict');
assert.ok(launchpadSource.includes('const text = prompt.trim();'), 'Home launchpad must forward only the real typed prompt');
assert.ok(!launchpadSource.includes('Build a complete ${selectedCategory} application using ${selectedModel} with database and analytics dashboard'), 'Home launchpad must not inject synthetic fallback prompts');

console.log('PASS directBuildExecution.integration.test');
