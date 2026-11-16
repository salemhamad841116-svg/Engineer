// ==============================================================================
// server_backend/services/ai/workspaceAttachments.js
// Validated storage for Workspace Chat attachments (images, documents, code).
// Files live under <dataDir>/uploads/<projectId>/<id>.<ext> with a JSON sidecar.
// Text/code files up to 100 KB are made available as model context.
// ==============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 5;
const MAX_TEXT_CONTEXT_BYTES = 100 * 1024;

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const DOC_EXT = ['pdf', 'txt', 'md', 'csv', 'json', 'docx', 'xlsx'];
const CODE_EXT = ['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'py', 'java', 'go', 'rs', 'sql', 'yaml', 'yml', 'xml', 'sh', 'php', 'rb', 'c', 'cpp', 'h', 'swift', 'kt'];
const TEXT_EXT = ['txt', 'md', 'csv', 'json', ...CODE_EXT];
const ALLOWED_EXT = [...IMAGE_EXT, ...DOC_EXT, ...CODE_EXT];

class AttachmentError extends Error {
  constructor(code, messageAr, messageEn, httpStatus = 400) {
    super(messageEn);
    this.code = code;
    this.userMessageAr = messageAr;
    this.userMessageEn = messageEn;
    this.httpStatus = httpStatus;
  }
}

function safeSegment(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function extOf(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

function kindOf(ext) {
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (CODE_EXT.includes(ext)) return 'code';
  return 'document';
}

function uploadsDir(dataDir, projectId) {
  return path.join(dataDir, 'uploads', safeSegment(projectId));
}

/** Detects obvious binary-vs-declared mismatches using magic numbers. */
function sniffMatches(ext, buf) {
  const head = buf.subarray(0, 8);
  if (ext === 'png') return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (ext === 'jpg' || ext === 'jpeg') return head[0] === 0xff && head[1] === 0xd8;
  if (ext === 'gif') return head.toString('ascii', 0, 3) === 'GIF';
  if (ext === 'pdf') return head.toString('ascii', 0, 4) === '%PDF';
  if (ext === 'webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (ext === 'docx' || ext === 'xlsx') return head[0] === 0x50 && head[1] === 0x4b;
  if (TEXT_EXT.includes(ext)) return !buf.subarray(0, Math.min(buf.length, 4096)).includes(0);
  return true;
}

/**
 * @param {string} dataDir
 * @param {string} projectId
 * @param {Array<{name:string,type?:string,size?:number,dataBase64:string}>} files
 */
function saveAttachments(dataDir, projectId, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new AttachmentError('NO_FILES', 'لم يتم اختيار أي ملف.', 'No files were provided.');
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    throw new AttachmentError('TOO_MANY_FILES', `يمكن إرفاق ${MAX_FILES_PER_REQUEST} ملفات كحد أقصى في الرسالة الواحدة.`, `At most ${MAX_FILES_PER_REQUEST} files per message.`);
  }
  const dir = uploadsDir(dataDir, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const f of files) {
    const name = path.basename(String((f && f.name) || '')).slice(0, 160);
    const ext = extOf(name);
    if (!name || !ALLOWED_EXT.includes(ext)) {
      throw new AttachmentError('UNSUPPORTED_TYPE', `نوع الملف «${name || 'بدون اسم'}» غير مدعوم. المسموح: الصور والمستندات وملفات الكود.`, `File type of "${name}" is not supported.`, 415);
    }
    const b64 = String((f && f.dataBase64) || '').replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) throw new AttachmentError('EMPTY_FILE', `الملف «${name}» فارغ.`, `File "${name}" is empty.`);
    if (buf.length > MAX_FILE_BYTES) {
      throw new AttachmentError('FILE_TOO_LARGE', `الملف «${name}» أكبر من 10 ميغابايت.`, `File "${name}" exceeds 10 MB.`, 413);
    }
    if (!sniffMatches(ext, buf)) {
      throw new AttachmentError('CONTENT_MISMATCH', `محتوى الملف «${name}» لا يطابق امتداده.`, `Content of "${name}" does not match its extension.`, 415);
    }
    const id = `att-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const meta = {
      id,
      projectId,
      name,
      ext,
      kind: kindOf(ext),
      type: String((f && f.type) || '').slice(0, 100) || `application/${ext}`,
      size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(meta));
    saved.push(meta);
  }
  return saved;
}

/** Loads attachment metadata (+ text content for small text/code files). Missing ids are skipped. */
function resolveAttachments(dataDir, projectId, ids) {
  const dir = uploadsDir(dataDir, projectId);
  const out = [];
  for (const rawId of Array.isArray(ids) ? ids.slice(0, MAX_FILES_PER_REQUEST) : []) {
    const id = safeSegment(rawId);
    const metaPath = path.join(dir, `${id}.json`);
    if (!id || !fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    let text = null;
    if (TEXT_EXT.includes(meta.ext) && meta.size <= MAX_TEXT_CONTEXT_BYTES) {
      text = fs.readFileSync(path.join(dir, `${id}.${meta.ext}`), 'utf8');
    }
    out.push({ ...meta, text });
  }
  return out;
}

function attachmentFilePath(dataDir, projectId, id) {
  const dir = uploadsDir(dataDir, projectId);
  const metaPath = path.join(dir, `${safeSegment(id)}.json`);
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  return { meta, filePath: path.join(dir, `${meta.id}.${meta.ext}`) };
}

module.exports = {
  saveAttachments,
  resolveAttachments,
  attachmentFilePath,
  AttachmentError,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  ALLOWED_EXT,
};
