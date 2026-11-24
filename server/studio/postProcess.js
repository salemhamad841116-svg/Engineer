/**
 * Zero-Cost Local Post-Processing (Image Mode, Layer 4).
 *
 * Produces the light WebP variant of a generated artifact via the local
 * ffmpeg binary — no external API, $0. The full-fidelity PNG is always kept
 * for download; the WebP exists for fast injection into UI previews.
 * Honest degradation: when ffmpeg is unavailable the variant is null and
 * callers simply skip it (never a fake "optimized" file).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FFMPEG_BIN = () => process.env.FFMPEG_BIN || 'ffmpeg';
const WEBP_QUALITY = () => Number(process.env.STUDIO_WEBP_QUALITY || 82);
const TIMEOUT_MS = 30000;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.slice(0, 300) || err.message));
      else resolve(stdout);
    });
  });
}

function isWebp(buf) {
  return buf.length >= 12
    && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WEBP';
}

/**
 * Convert an image file to WebP next to the original.
 * @returns {Promise<{ path: string, bytes: number } | null>} null when the
 *          local toolchain is unavailable or the conversion failed.
 */
export async function toWebpVariant(absPath) {
  try {
    const out = absPath.replace(/\.(png|jpe?g)$/i, '') + '.webp';
    await run(FFMPEG_BIN(), [
      '-y', '-i', absPath,
      '-c:v', 'libwebp', '-quality', String(WEBP_QUALITY()),
      out,
    ]);
    if (!fs.existsSync(out)) return null;
    const buf = fs.readFileSync(out);
    if (!isWebp(buf)) { fs.rmSync(out, { force: true }); return null; }
    return { path: out, bytes: buf.length };
  } catch {
    return null; // honest skip — the PNG master remains fully usable
  }
}
