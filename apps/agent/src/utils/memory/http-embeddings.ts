import type { EmbeddingService } from "./embeddings.js";

export const OPENAI_EMBEDDINGS_BASE = "https://api.openai.com/v1";

export interface HttpEmbeddingOptions {
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  /** Embedding model id (verified against the provider's catalog). */
  model: string;
  apiKey: string;
  /** Injectable fetch for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Real embedding backend: OpenAI-compatible `/embeddings` endpoint
 * (`POST {baseUrl}/embeddings`, body `{ model, input }`). Works with OpenAI and
 * any provider exposing the same shape.
 */
export class HttpEmbeddingService implements EmbeddingService {
  constructor(private readonly options: HttpEmbeddingOptions) {}

  async embed(text: string): Promise<number[]> {
    const vectors = await this.request([text]);
    const vector = vectors[0];
    if (!vector) throw new Error("Embedding API returned no data");
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.request(texts);
  }

  private async request(inputs: string[]): Promise<number[][]> {
    const fetchFn = this.options.fetchFn ?? fetch;
    const base = this.options.baseUrl.replace(/\/+$/, "");

    const response = await fetchFn(`${base}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({ model: this.options.model, input: inputs }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Embedding API error ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const json = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const data = Array.isArray(json.data) ? json.data : [];
    if (data.length === 0) throw new Error("Embedding API returned no data");

    return data.map((entry) => {
      if (!Array.isArray(entry.embedding)) {
        throw new Error("Embedding API returned malformed data");
      }
      return entry.embedding;
    });
  }
}
