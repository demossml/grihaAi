/**
 * Embedding abstraction for hybrid memory search (Phase 4).
 *
 * Real backend: `HttpEmbeddingService` (OpenAI-compatible `/embeddings`),
 * configured via `cfg.embedding`. Deterministic `HashingEmbeddingService`
 * remains the offline fallback (used in tests without network).
 */

import type { GrishAiConfig } from "@griha/shared-types";
import { HttpEmbeddingService, OPENAI_EMBEDDINGS_BASE } from "./http-embeddings.js";

export interface EmbeddingService {
  /** Generate an embedding for a single text. */
  embed(text: string): Promise<number[]>;
  /** Optional batch embedder. */
  embedBatch?(texts: string[]): Promise<number[][]>;
}

const DEFAULT_DIM = 384;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic hashing-trick embedding.
 *
 * This is NOT a neural model: texts that share tokens produce similar vectors.
 * It serves as an offline, zero-dependency fallback so hybrid search works
 * end-to-end until a real embedding backend is available.
 */
export class HashingEmbeddingService implements EmbeddingService {
  constructor(private readonly dim: number = DEFAULT_DIM) {}

  async embed(text: string): Promise<number[]> {
    const vec = new Float32Array(this.dim);
    for (const token of tokenize(text)) {
      const hash = fnv1a(token);
      const idx = hash % this.dim;
      const sign = ((hash >>> 16) & 1) === 0 ? 1 : -1;
      vec[idx] += sign;
    }
    let norm = 0;
    for (let i = 0; i < this.dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dim; i++) vec[i] /= norm;
    }
    return Array.from(vec);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * Build the embedding service from config:
 * - `cfg.embedding` (provider/model/apiKey) → real HTTP embeddings;
 * - otherwise → deterministic hashing fallback (offline, test-friendly).
 */
export function createEmbeddingService(config?: GrishAiConfig | null): EmbeddingService {
  const embedding = config?.embedding;
  if (embedding?.model && embedding?.apiKey) {
    return new HttpEmbeddingService({
      baseUrl: embedding.baseUrl ?? OPENAI_EMBEDDINGS_BASE,
      model: embedding.model,
      apiKey: embedding.apiKey,
    });
  }
  return new HashingEmbeddingService();
}
