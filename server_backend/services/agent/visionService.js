// ==============================================================================
// server_backend/services/agent/visionService.js
// Computer Vision — understands UI screenshots uploaded as workspace attachments.
//
// Flow: attachment id → validated image bytes (magic-byte sniffed at upload) →
// vision-capable model → STRICT JSON of observed UI issues. Honesty contract:
// if no vision-capable provider is configured, the tool reports BLOCKED with
// code VISION_UNAVAILABLE — it never fabricates an analysis.
// ==============================================================================
'use strict';

const fs = require('fs');
const config = require('../../config');

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const VISION_SYSTEM = `You are a UI review engine for generated web apps. Analyze the screenshot and return STRICT JSON only — no prose, no markdown fences — with this exact shape:
{
  "summary": "one-sentence overall assessment",
  "issues": [
    { "severity": "critical|major|minor", "type": "layout|contrast|overflow|alignment|empty-state|error|accessibility|other", "where": "short location description", "detail": "what is wrong", "suggestion": "concrete fix" }
  ],
  "positives": ["short strings"]
}
If the image is not a UI screenshot, return {"summary":"not-a-ui-screenshot","issues":[],"positives":[]}.
Rules: report only what is VISIBLE in the image; never invent elements; max 8 issues ordered by severity.`;

/** Default real vision call through the platform's Gemini client. */
async function geminiVisionCall({ base64, mimeType, prompt }) {
  const { generateText } = require('../geminiClient');
  return generateText({
    purpose: 'vision',
    modelEnv: 'GEMINI_VISION_MODEL',
    parts: [
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ],
    systemInstruction: VISION_SYSTEM,
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  });
}

/** True when a vision-capable provider is credibly configured. */
function visionAvailable() {
  try {
    const { describeConfig } = require('../geminiClient');
    const cfg = describeConfig();
    return Boolean(cfg && (cfg.keyUsable || cfg.keyPresent));
  } catch (_) {
    return false;
  }
}

function parseIssuesJson(text = '') {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.issues)) {
      return {
        summary: String(parsed.summary || '').slice(0, 300),
        issues: parsed.issues.slice(0, 8).map((i) => ({
          severity: ['critical', 'major', 'minor'].includes(i.severity) ? i.severity : 'minor',
          type: String(i.type || 'other').slice(0, 30),
          where: String(i.where || '').slice(0, 160),
          detail: String(i.detail || '').slice(0, 400),
          suggestion: String(i.suggestion || '').slice(0, 300),
        })),
        positives: Array.isArray(parsed.positives) ? parsed.positives.slice(0, 6).map((p) => String(p).slice(0, 160)) : [],
      };
    }
  } catch (_) { /* fall through */ }
  // Model did not honor the JSON contract — report honestly instead of guessing.
  return {
    summary: 'unstructured-model-output',
    issues: [],
    positives: [],
    rawExcerpt: String(text).slice(0, 500),
  };
}

/**
 * Analyzes one uploaded screenshot attachment.
 * @param {object} o
 * @param {string} o.projectId
 * @param {string} o.attachmentId
 * @param {string} [o.question] - optional focus ("the save button looks broken")
 * @param {Function} [o.visionCall] - injectable for tests; defaults to Gemini.
 * @param {Function} [o.available] - injectable availability probe for tests.
 */
async function analyzeScreenshot({ projectId, attachmentId, question = '', visionCall = geminiVisionCall, available = visionAvailable }) {
  if (!available()) {
    const err = new Error('VISION_UNAVAILABLE');
    err.code = 'VISION_UNAVAILABLE';
    err.state = 'BLOCKED';
    throw err;
  }
  const { attachmentFilePath } = require('../ai/workspaceAttachments');
  const resolved = attachmentFilePath(config.dataDir, String(projectId), String(attachmentId));
  if (!resolved || !resolved.filePath) {
    const err = new Error('ATTACHMENT_NOT_FOUND');
    err.code = 'ATTACHMENT_NOT_FOUND';
    throw err;
  }
  const ext = String((resolved.meta && resolved.meta.ext) || '').toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    const err = new Error('NOT_AN_IMAGE');
    err.code = 'NOT_AN_IMAGE';
    throw err;
  }
  const buffer = fs.readFileSync(resolved.filePath);
  if (!buffer || buffer.length === 0) {
    const err = new Error('EMPTY_ATTACHMENT');
    err.code = 'EMPTY_ATTACHMENT';
    throw err;
  }
  const prompt = question && String(question).trim()
    ? `Focus on this user concern: "${String(question).slice(0, 200)}". Then analyze the whole screenshot.`
    : 'Analyze this UI screenshot.';
  const text = await visionCall({ base64: buffer.toString('base64'), mimeType, prompt });
  return parseIssuesJson(text);
}

module.exports = { analyzeScreenshot, parseIssuesJson, visionAvailable, VISION_SYSTEM };
