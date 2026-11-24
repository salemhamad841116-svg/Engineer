/**
 * Image Mode Service (Phase 1) — multi-candidate generation.
 *
 * One client request yields 2-4 candidates sharing a generation_group, so
 * the Candidate Gallery Strip can switch/pin/compare instantly. Every
 * candidate is a REAL provider call (quota charged per candidate — honest
 * accounting), and every candidate flows through the same conditional OCR
 * gate, WebP post-processing and cache fingerprinting.
 *
 * Seed semantics (spec Layer 2): an explicit locked seed pins composition;
 * with N>1 candidates the seed is deterministically varied per candidate
 * (seed:i) — documented, prompt-level anchoring (Gemini has no seed param).
 */
import crypto from 'node:crypto';
import { generateStudioAsset } from './studioService.js';
import { StudioError } from './studioErrors.js';

export const MAX_CANDIDATES = 4;

/**
 * @param {object} db
 * @param {object} arg same params as generateStudioAsset, plus:
 * @param {number} [arg.candidates] 1-4 (default 1)
 * @returns {Promise<{ group: string, assets: object[] }>}
 */
export async function generateCandidates(db, { candidates = 1, ...params }) {
  const n = Number(candidates);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CANDIDATES) {
    throw new StudioError(400, 'STUDIO_CANDIDATES_INVALID', `candidates must be an integer 1-${MAX_CANDIDATES}.`);
  }
  const group = crypto.randomUUID();
  const assets = [];
  for (let i = 0; i < n; i += 1) {
    // Locked seed + multiple candidates -> deterministic per-candidate variation.
    const seedOverride = params.seedOverride && n > 1 ? `${params.seedOverride}:${i}` : params.seedOverride;
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: quota fairness + provider politeness
    const asset = await generateStudioAsset(db, {
      ...params,
      seedOverride,
      generationGroup: group,
      // Candidate i>0 with identical unlocked params would fingerprint-collide;
      // unlocked candidates each get a fresh seed upstream, so no skip needed
      // unless a locked seed made them identical — the cache then serves them.
    });
    assets.push(asset);
  }
  return { group, assets };
}
