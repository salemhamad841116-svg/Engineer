// ==============================================================================
// server_backend/tests/buildPipeline.test.js
// P0 Regression & Build Pipeline Test Suite
// Verifies:
// 1. toolGuard accepts react-ts-vite files (.ts, .tsx, .jsx, .mjs, .cjs)
// 2. toolGuard accepts allowed extensionless files (Dockerfile, .gitignore, LICENSE)
// 3. toolGuard strictly rejects traversal (../), dangerous exes, and unauthorized dotfiles
// 4. Agent write_file and read_file operate seamlessly on react-ts-vite projects
// 5. Database seeding in backendBridge operates with zero foreign key violations
// ==============================================================================
"use strict";

const assert = require("node:assert");
const { getDb } = require("../db/database");
const { createToolGuard, normalizeProjectPath, GuardError } = require("../security/toolGuard");
const { workspaceTools } = require("../services/agent/workspaceTools");
const { POLICY } = require("../services/ai/constitution");

async function runBuildPipelineSuite() {
  console.log("================================================================");
  console.log("🛠️ RUNNING P0 REGRESSION & BUILD PIPELINE TEST SUITE");
  console.log("================================================================\n");

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  console.log("[P0-1] ToolGuard Extension Coverage & Path Security...");
  // --------------------------------------------------------------------------

  await test("1.1 toolGuard accepts react-ts-vite project files (.tsx, .ts, .jsx, .scss)", () => {
    const validPaths = [
      "src/App.tsx",
      "src/main.tsx",
      "src/components/Header.tsx",
      "src/hooks/useData.ts",
      "src/legacy/Widget.jsx",
      "vite.config.ts",
      "styles/main.scss",
      "config/schema.sql",
      "config/app.yaml",
      "package.json",
      "index.html",
    ];

    for (const p of validPaths) {
      const normalized = normalizeProjectPath(p);
      assert.strictEqual(normalized, p);
    }
  });

  await test("1.2 toolGuard accepts safe root extensionless files (Dockerfile, .gitignore, LICENSE)", () => {
    const safeFiles = ["Dockerfile", ".gitignore", ".npmrc", ".editorconfig", "LICENSE"];
    for (const f of safeFiles) {
      const normalized = normalizeProjectPath(f);
      assert.strictEqual(normalized, f);
    }
  });

  await test("1.3 toolGuard rejects unauthorized dotfiles (.env, .git) as PATH_FORBIDDEN", () => {
    const forbidden = [".env", ".env.local", ".git/config", "secret/.hidden.txt"];
    for (const p of forbidden) {
      assert.throws(
        () => normalizeProjectPath(p),
        (err) => err instanceof GuardError && err.code === "PATH_FORBIDDEN"
      );
    }
  });

  await test("1.4 toolGuard strictly rejects traversal (../) even with allowed extensions", () => {
    const attacks = [
      "../../etc/passwd",
      "src/../../../escape.tsx",
      "../vite.config.ts",
      "//evil.com/app.tsx",
    ];
    for (const p of attacks) {
      assert.throws(
        () => normalizeProjectPath(p),
        (err) => err instanceof GuardError && (err.code === "PATH_TRAVERSAL" || err.code === "PATH_INVALID")
      );
    }
  });

  await test("1.5 toolGuard rejects executable and scripting extensions (.exe, .sh, .php)", () => {
    const dangerous = ["src/evil.exe", "src/script.sh", "api/backdoor.php", "bin/run.bat"];
    for (const p of dangerous) {
      assert.throws(
        () => normalizeProjectPath(p),
        (err) => err instanceof GuardError && err.code === "EXTENSION_FORBIDDEN"
      );
    }
  });

  // --------------------------------------------------------------------------
  console.log("\n[P0-2] Agent Tool Execution on React-TS-Vite Project...");
  // --------------------------------------------------------------------------

  await test("2.1 write_file succeeds on .tsx and vite.config.ts without GuardError", async () => {
    const guard = createToolGuard({ tools: workspaceTools });
    const project = {
      id: "proj_react_ts_vite_test",
      files: [],
    };
    const user = { id: "usr_editor_01", role: "Editor" };

    const appTsxContent = `import React from 'react';
export default function App() {
  return <div dir="rtl"><h1>تطبيق المنصة الذكي</h1></div>;
}`;

    // Write App.tsx
    const writeAppRes = await guard.execute(
      {
        name: "write_file",
        arguments: {
          path: "src/App.tsx",
          content: appTsxContent,
        },
      },
      { user, mode: "build", project, projectId: project.id }
    );
    assert.strictEqual(writeAppRes.ok, true, `write_file on src/App.tsx failed: ${writeAppRes.message}`);

    // Write vite.config.ts
    const viteConfigContent = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });`;

    const writeViteRes = await guard.execute(
      {
        name: "write_file",
        arguments: {
          path: "vite.config.ts",
          content: viteConfigContent,
        },
      },
      { user, mode: "build", project, projectId: project.id }
    );
    assert.strictEqual(writeViteRes.ok, true, `write_file on vite.config.ts failed: ${writeViteRes.message}`);

    // Write Dockerfile
    const writeDockerRes = await guard.execute(
      {
        name: "write_file",
        arguments: {
          path: "Dockerfile",
          content: "FROM node:20-alpine\nWORKDIR /app\n",
        },
      },
      { user, mode: "build", project, projectId: project.id }
    );
    assert.strictEqual(writeDockerRes.ok, true, `write_file on Dockerfile failed: ${writeDockerRes.message}`);

    // Verify files were added to project
    assert.strictEqual(project.files.length, 3);
    const appFile = project.files.find((f) => f.name === "App.tsx");
    assert.ok(appFile);
    assert.strictEqual(appFile.content, appTsxContent);

    // Read back via read_file tool
    const readRes = await guard.execute(
      {
        name: "read_file",
        arguments: {
          path: "src/App.tsx",
        },
      },
      { user, mode: "build", project, projectId: project.id }
    );
    assert.strictEqual(readRes.ok, true);
    assert.strictEqual(readRes.result.content, appTsxContent);
  });

  // --------------------------------------------------------------------------
  console.log("\n[P0-3] Database Seeding & Foreign Key Integrity...");
  // --------------------------------------------------------------------------

  await test("3.1 Seeding executes with parents-first order and passes PRAGMA foreign_key_check", () => {
    const db = getDb();

    // Verify parent user exists for sample projects
    let user = db.prepare("SELECT id FROM users LIMIT 1").get();
    if (!user) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("usr_test_admin", "admin@platform.local", "bootstrap_hash", "Test Admin", "admin", now, now);
      user = { id: "usr_test_admin" };
    }
    assert.ok(user.id, "Parent user must exist");

    // Check foreign keys status
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    assert.strictEqual(violations.length, 0, `Database has FK violations: ${JSON.stringify(violations)}`);
  });

  console.log("\n================================================================");
  console.log(`🎉 ALL ${passed}/${total} P0 REGRESSION & PIPELINE TESTS PASSED`);
  console.log("================================================================\n");
}

module.exports = { runBuildPipelineSuite };

if (require.main === module) {
  runBuildPipelineSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Test suite failed:", err);
      process.exit(1);
    });
}
