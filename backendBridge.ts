// src/backendBridge.ts
// جسر ربط خادم Express الجديد ومسارات صانع التطبيقات وقاعدة بيانات SQLite الـ 22 جدولاً
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function attachBackendAndDatabase(app: Express) {
  try {
    // 1. الاتصال بقاعدة بيانات SQLite الأصلية
    const { getDb } = require('../server_backend/db/database.js');
    const db = getDb();
    console.log('[Engineer Backend] ✅ تم الاتصال بقاعدة بيانات SQLite: data/app.db (22 جدولاً موثقاً)');

    // 2. تحميل خدمات ومحرك المهندس الذكي (Engineer V2)
    const { orchestrateProject } = require('../server_backend/services/engineer/orchestrator.js');
    const { getMemory } = require('../server_backend/services/engineer/projectMemory.js');
    const { retrieveCodingKnowledge } = require('../server_backend/services/engineer/knowledgeRetriever.js');
    const { listBenchmarkResults, runBenchmarkSuite } = require('../server_backend/services/engineer/benchmarkSuite.js');
    const builder = require('../server_backend/services/builderService.js');

    // 3. ربط مسارات الـ API المباشرة
    // استرجاع المشاريع المخزنة في SQLite
    app.get('/api/sqlite/projects', (_req, res) => {
      try {
        const rows = db.prepare('SELECT * FROM app_projects ORDER BY updated_at DESC').all();
        res.json({ success: true, count: rows.length, projects: rows });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // استرجاع ذاكرة المشروع وحلول الأخطاء السابقة
    app.get('/api/engineer/memory/:projectId', (req, res) => {
      try {
        const memory = getMemory(req.params.projectId);
        res.json({ success: true, memory });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // استرجاع المعرفة البرمجية RAG
    app.post('/api/engineer/knowledge', (req, res) => {
      try {
        const { query, language, framework, limit } = req.body || {};
        const snippets = retrieveCodingKnowledge(query, { language, framework, limit });
        res.json({ success: true, snippets });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // تشغيل أوركسترا النماذج والبرمجة الذاتية والإصلاح
    app.post('/api/engineer/orchestrate', async (req, res) => {
      try {
        const { projectId, prompt, autoRepair } = req.body || {};
        const result = await orchestrateProject(projectId, prompt, { autoRepair: autoRepair ?? true });
        res.json({ success: true, result });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // فحص الجودة ومعايير التقييم القياسية
    app.get('/api/engineer/benchmarks', (_req, res) => {
      try {
        const benchmarks = listBenchmarkResults();
        res.json({ success: true, benchmarks });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    console.log('[Engineer Backend] 🚀 تم تفعيل مسارات SQLite ومحرك Engineer بنجاح على /api/engineer/ و /api/sqlite/');
  } catch (err) {
    console.error('[Engineer Backend] ❌ خطأ أثناء تحميل خدمات الباك إند:', err);
  }
}
