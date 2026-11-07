// ==============================================================================
// File Transfer & Smart Scope Filtering Service
// Handles upload/import, zip export, path sanitization, and relevance filtering.
// ==============================================================================

const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');
const { get, all } = require('../../db/database');
const { sanitizeProjectPath } = require('./safetyGate');

/**
 * Filters relevant files for large projects so the agent doesn't read hundreds of files blindly.
 */
function filterRelevantFilesForTask({ allFiles = [], prompt = '', maxFiles = 12 }) {
  if (!Array.isArray(allFiles) || allFiles.length <= maxFiles) {
    return allFiles;
  }

  const promptLower = prompt.toLowerCase();
  const words = promptLower.split(/[\s,._/\\-]+/).filter((w) => w.length > 2);

  const scored = allFiles.map((file) => {
    let score = 0;
    const filePath = (file.path || file.name || '').toLowerCase();
    const fileName = path.basename(filePath);

    // 1. Direct filename mention in prompt (+10)
    if (promptLower.includes(fileName)) {
      score += 10;
    }

    // 2. Keyword tokens in path (+3 each)
    for (const w of words) {
      if (filePath.includes(w)) {
        score += 3;
      }
    }

    // 3. High priority files (+2 for core entry points)
    if (['index.html', 'app.js', 'app.tsx', 'main.tsx', 'styles.css', 'package.json'].includes(fileName)) {
      score += 2;
    }

    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxFiles).map((s) => s.file);
}

/**
 * Exports project files into a downloadable ZIP buffer.
 */
async function exportProjectAsZip({ projectId = null, files = null, projectName = 'project' }) {
  const zip = new JSZip();

  let filesToZip = [];
  if (Array.isArray(files) && files.length > 0) {
    filesToZip = files;
  } else if (projectId) {
    // Retrieve files from latest version in database
    const latestVersion = get(
      'SELECT id FROM app_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1',
      projectId
    );
    if (latestVersion) {
      filesToZip = all(
        'SELECT path, content FROM app_project_files_v2 WHERE version_id = ?',
        latestVersion.id
      );
    }
  }

  if (filesToZip.length === 0) {
    // Default readme if empty
    zip.file('README.md', `# ${projectName}\nExported by Engineer Autonomous Coding Agent.`);
  } else {
    for (const f of filesToZip) {
      const relPath = (f.path || f.name || 'file.txt').replace(/^[/\\]+/, '');
      zip.file(relPath, f.content || '');
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return {
    filename: `${projectName}_export_${Date.now()}.zip`,
    buffer: zipBuffer,
    sizeBytes: zipBuffer.length,
    filesCount: filesToZip.length,
  };
}

/**
 * Validates and imports user uploaded files into project memory or workspace.
 */
async function importUserUploadedFiles({
  uploadedFiles = [],
  workspaceRoot = process.cwd(),
  allowOverwrite = false,
}) {
  const imported = [];
  const skipped = [];

  for (const item of uploadedFiles) {
    const rawPath = item.path || item.name || 'unnamed.txt';
    const targetPath = sanitizeProjectPath(workspaceRoot, rawPath);

    if (fs.existsSync(targetPath) && !allowOverwrite) {
      skipped.push({
        path: rawPath,
        reason: 'الملف موجود مسبقاً وتتطلب الكتابة فوقه موافقة صريحة.',
      });
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, item.content, 'utf8');

    imported.push({
      path: rawPath,
      sizeBytes: Buffer.byteLength(item.content, 'utf8'),
      status: 'saved',
    });
  }

  return {
    importedCount: imported.length,
    skippedCount: skipped.length,
    imported,
    skipped,
  };
}

module.exports = {
  filterRelevantFilesForTask,
  exportProjectAsZip,
  importUserUploadedFiles,
};
