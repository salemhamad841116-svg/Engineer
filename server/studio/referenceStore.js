/**
 * Reference Image Store (Image Mode, Layer 2) — DAL + safe file I/O.
 *
 * Clients upload a product/style reference (base64); it is magic-byte
 * validated, hashed (SHA-256 — feeds the generation cache fingerprint),
 * stored under the owner's studio directory, and registered in
 * studio_references (migration 036). References are passed to the image
 * provider as multimodal input; they never leave the server.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StudioError } from './studioErrors.js';

const STUDIO_ROOT = () =>
  path.join(process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media'), 'studio');

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024; // 10MB

const MAGIC = [
  { mime: 'image/png', ext: 'png', sig: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', ext: 'jpg', sig: [0xff, 0xd8, 0xff] },
];

function sniff(buf) {
  if (buf.length >= 12
      && buf.toString('ascii', 0, 4) === 'RIFF'
      && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  for (const m of MAGIC) {
    if (buf.length >= 8 && m.sig.every((b, i) => buf[i] === b)) return m;
  }
  return null;
}

/**
 * Save a reference image. Role: 'style' (visual style anchor) or 'product'
 * (real product to place inside the generated scene).
 */
export function saveReference(db, ownerId, { dataB64, role = 'style' }) {
  if (!dataB64 || typeof dataB64 !== 'string') {
    throw new StudioError(400, 'STUDIO_REFERENCE_INVALID', 'Reference image data is required.');
  }
  if (!['style', 'product'].includes(role)) {
    throw new StudioError(400, 'STUDIO_REFERENCE_ROLE_INVALID', "Role must be 'style' or 'product'.");
  }
  let buf;
  try {
    buf = Buffer.from(dataB64, 'base64');
  } catch {
    throw new StudioError(400, 'STUDIO_REFERENCE_INVALID', 'Reference data is not valid base64.');
  }
  if (!buf.length || buf.length > MAX_REFERENCE_BYTES) {
    throw new StudioError(400, 'STUDIO_REFERENCE_TOO_LARGE', 'Reference image must be 1 byte to 10MB.');
  }
  const kind = sniff(buf);
  if (!kind) {
    throw new StudioError(400, 'STUDIO_REFERENCE_INVALID', 'Reference must be a PNG, JPEG or WebP image (magic-byte check failed).');
  }

  const id = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const dir = path.join(STUDIO_ROOT(), ownerId, 'refs');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${id}.${kind.ext}`);
  fs.writeFileSync(abs, buf);

  db.prepare(`INSERT INTO studio_references (id, owner_id, role, hash, path, mime, bytes, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, ownerId, role, hash, abs, kind.mime, buf.length, new Date().toISOString());
  return getReference(db, ownerId, id);
}

export function getReference(db, ownerId, id) {
  const row = db.prepare('SELECT * FROM studio_references WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) throw new StudioError(404, 'STUDIO_REFERENCE_NOT_FOUND', 'Reference image not found.');
  return row;
}

export function listReferences(db, ownerId, { limit = 30 } = {}) {
  return db.prepare('SELECT * FROM studio_references WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(ownerId, Math.min(Math.max(Number(limit) || 30, 1), 100));
}

/** Read the reference bytes for the provider call (path confined to the studio root). */
export function readReferenceBytes(db, ownerId, id) {
  const row = getReference(db, ownerId, id);
  const abs = path.resolve(row.path);
  const root = path.resolve(STUDIO_ROOT());
  if (!abs.startsWith(root + path.sep)) {
    throw new StudioError(403, 'STUDIO_PATH_FORBIDDEN', 'Reference path is not allowed.');
  }
  if (!fs.existsSync(abs)) {
    throw new StudioError(410, 'STUDIO_REFERENCE_GONE', 'Reference file no longer exists.');
  }
  return { buf: fs.readFileSync(abs), mime: row.mime, hash: row.hash, role: row.role };
}
