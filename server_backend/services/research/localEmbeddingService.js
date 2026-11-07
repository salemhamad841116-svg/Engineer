// ==============================================================================
// Local-First Deterministic Embedding & Semantic Search Engine
// Operates 100% offline without external APIs or network calls.
// Provides: 128-dim dense embeddings, L2 normalization, fast Cosine Similarity,
// BM25 term weighting, and Reciprocal Rank Fusion (RRF).
// ==============================================================================

const VECTOR_DIM = 128;

const STOPWORDS = new Set([
  // Arabic stop words
  'ما', 'هي', 'هو', 'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك',
  'التي', 'الذي', 'الذين', 'كل', 'أن', 'إن', 'قد', 'كان', 'كانت', 'يكون', 'بين', 'أو',
  'ثم', 'لكن', 'هل', 'كيف', 'ماذا', 'لماذا', 'أين', 'متى', 'نحو', 'دون',
  'غير', 'فوق', 'تحت', 'أمام', 'خلف', 'حيث', 'هنا', 'هناك', 'إذا', 'لو', 'فقط',
  // English stop words
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'about', 'like', 'through', 'over', 'before', 'between', 'after', 'since', 'without',
  'under', 'within', 'along', 'following', 'across', 'behind', 'beyond', 'plus', 'except',
  'but', 'up', 'out', 'around', 'down', 'off', 'above', 'near', 'what', 'how', 'why', 'where',
  'when', 'who', 'which', 'and', 'or', 'of'
]);

/**
 * Normalizes text for consistent embedding projection across Arabic and English.
 */
function normalizeText(text) {
  if (!text) return '';
  let str = String(text).toLowerCase();

  // 1. Strip Arabic Tashkeel (diacritics) & Tatweel
  str = str
    .replace(/[\u064B-\u0652\u0656-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '');

  // 2. Normalize Arabic letter variations
  str = str
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');

  // 3. Remove punctuation and excess whitespace
  str = str
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return str;
}

/**
 * Deterministic 32-bit FNV-1a hash function for strings.
 */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Tokenizes text into word tokens and character 3-grams/4-grams for subword matching.
 */
function extractFeatures(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const rawWords = normalized.split(/\s+/).filter((w) => w.length > 1);
  const contentWords = rawWords.filter((w) => !STOPWORDS.has(w));
  const words = contentWords.length > 0 ? contentWords : rawWords;
  const features = [];

  for (const word of words) {
    features.push('w:' + word);

    // Add character 3-grams and 4-grams for morphological flexibility
    if (word.length >= 3) {
      for (let i = 0; i <= word.length - 3; i++) {
        features.push('3g:' + word.slice(i, i + 3));
      }
    }
    if (word.length >= 4) {
      for (let i = 0; i <= word.length - 4; i++) {
        features.push('4g:' + word.slice(i, i + 4));
      }
    }
  }

  return features;
}

/**
 * Generates a 128-dimensional deterministic dense vector for the given text.
 * The vector is strictly L2-normalized so dot products represent cosine similarity.
 */
function generateEmbedding(text) {
  const vector = new Float32Array(VECTOR_DIM);
  const features = extractFeatures(text);

  if (features.length === 0) {
    return vector;
  }

  // Count term frequencies
  const tf = new Map();
  for (const f of features) {
    tf.set(f, (tf.get(f) || 0) + 1);
  }

  // Project features into vector dimensions using signed hashing
  for (const [feat, count] of tf.entries()) {
    const hash = fnv1a(feat);
    const dim = hash % VECTOR_DIM;
    const sign = (hash & 0x80000000) ? -1.0 : 1.0;
    const weight = Math.log1p(count); // Sublinear TF weighting

    vector[dim] += sign * weight;
  }

  // L2 normalization
  let norm = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 1e-8) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
}

/**
 * Serializes a Float32Array to a Node Buffer for SQLite BLOB storage.
 */
function vectorToBlob(vector) {
  if (!vector || !(vector instanceof Float32Array)) {
    return Buffer.alloc(VECTOR_DIM * 4);
  }
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Deserializes a SQLite BLOB Buffer back to a Float32Array.
 */
function blobToVector(blob) {
  if (!blob || !(blob instanceof Buffer) || blob.byteLength < VECTOR_DIM * 4) {
    return new Float32Array(VECTOR_DIM);
  }
  return new Float32Array(blob.buffer, blob.byteOffset, VECTOR_DIM);
}

/**
 * Computes cosine similarity between two 128-dimensional vectors.
 * Returns a value in [-1.0, 1.0].
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0.0;
  let dot = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(-1.0, Math.min(1.0, dot));
}

/**
 * Tokenizes text for BM25 keyword matching, filtering stopwords.
 */
function tokenizeForBM25(text) {
  const norm = normalizeText(text);
  if (!norm) return [];
  const words = norm.split(/\s+/).filter((w) => w.length > 1);
  const content = words.filter((w) => !STOPWORDS.has(w));
  const tokens = [];
  for (const w of content) {
    tokens.push(w);
    if (w.startsWith('ال') && w.length > 4) {
      tokens.push(w.slice(2));
    }
  }
  return tokens;
}

/**
 * Computes BM25 score for a document chunk against query tokens.
 */
function computeBM25Score(queryTokens, docTokens, docLength, avgDocLength = 200, k1 = 1.2, b = 0.75) {
  const qTokens = Array.isArray(queryTokens) ? queryTokens : tokenizeForBM25(queryTokens);
  const dTokens = Array.isArray(docTokens) ? docTokens : tokenizeForBM25(docTokens);
  if (!qTokens.length || !dTokens.length) return 0.0;

  const actualDocLen = typeof docLength === 'number' ? docLength : dTokens.length;

  const docFreq = new Map();
  for (const t of dTokens) {
    docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }

  const lengthNorm = 1 - b + b * (actualDocLen / Math.max(avgDocLength, 1));
  let score = 0.0;

  for (const q of qTokens) {
    const tf = docFreq.get(q) || 0;
    if (tf > 0) {
      // Classic BM25 term saturation
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * lengthNorm;
      score += (numerator / denominator);
    }
  }

  return score;
}

/**
 * Fuses two ranked lists using Reciprocal Rank Fusion (RRF).
 * rrfScore(d) = sum(1 / (k + rank_i(d)))
 */
function reciprocalRankFusion(listA, listB, k = 60) {
  const scoreMap = new Map();
  const itemMap = new Map();

  // Process list A (BM25)
  listA.forEach((item, index) => {
    const rank = index + 1;
    const rrf = 1.0 / (k + rank);
    scoreMap.set(item.id, (scoreMap.get(item.id) || 0) + rrf);
    if (!itemMap.has(item.id)) {
      itemMap.set(item.id, { ...item, bm25Rank: rank, bm25Score: item.score });
    } else {
      const existing = itemMap.get(item.id);
      existing.bm25Rank = rank;
      existing.bm25Score = item.score;
    }
  });

  // Process list B (Vector Cosine)
  listB.forEach((item, index) => {
    const rank = index + 1;
    const rrf = 1.0 / (k + rank);
    scoreMap.set(item.id, (scoreMap.get(item.id) || 0) + rrf);
    if (!itemMap.has(item.id)) {
      itemMap.set(item.id, { ...item, vectorRank: rank, vectorScore: item.score });
    } else {
      const existing = itemMap.get(item.id);
      existing.vectorRank = rank;
      existing.vectorScore = item.score;
    }
  });

  // Assemble merged results
  const merged = [];
  for (const [id, rrfScore] of scoreMap.entries()) {
    const base = itemMap.get(id);
    let matchType = 'keyword';
    if (base.bm25Rank && base.vectorRank) {
      matchType = 'hybrid';
    } else if (base.vectorRank) {
      matchType = 'semantic_vector';
    }

    merged.push({
      ...base,
      rrfScore: Number(rrfScore.toFixed(6)),
      score: Number(rrfScore.toFixed(6)),
      matchType,
    });
  }

  // Sort by RRF descending
  merged.sort((a, b) => b.rrfScore - a.rrfScore);
  return merged;
}

module.exports = {
  VECTOR_DIM,
  STOPWORDS,
  normalizeText,
  generateEmbedding,
  vectorToBlob,
  blobToVector,
  cosineSimilarity,
  tokenizeForBM25,
  computeBM25Score,
  reciprocalRankFusion,
};
