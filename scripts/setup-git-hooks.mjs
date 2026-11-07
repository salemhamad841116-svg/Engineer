#!/usr/bin/env node

/**
 * setup-git-hooks.mjs
 * Automatically installs and configures repository Git hooks upon `npm install`
 */

import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const gitHooksDir = path.join(projectRoot, '.git', 'hooks');
const sourceHook = path.join(projectRoot, 'scripts', 'hooks', 'pre-commit');
const targetHook = path.join(gitHooksDir, 'pre-commit');

if (!fs.existsSync(path.join(projectRoot, '.git'))) {
  // Not in a git repo (e.g., Docker container or CI environment)
  console.log('ℹ️  No .git repository detected. Skipping git hook installation.');
  process.exit(0);
}

try {
  if (!fs.existsSync(gitHooksDir)) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
  }

  if (fs.existsSync(sourceHook)) {
    fs.copyFileSync(sourceHook, targetHook);
    fs.chmodSync(targetHook, 0o755);
    console.log('✅ Git pre-commit hook installed successfully into .git/hooks/pre-commit');
  } else {
    console.warn('⚠️ Canonical hook not found at scripts/hooks/pre-commit');
  }
} catch (err) {
  console.warn('⚠️ Could not configure git hooks automatically:', err.message);
}
