// src/providers/gemini-embedding.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { EmbeddingProvider } from './types.js';

const EMBEDDING_MODEL = 'gemini-embedding-2-preview'; // Gemini Embedding 2 (multimodal, public preview)
const DIMENSIONS = 3072;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private client: GoogleGenerativeAI;
  readonly dimensions = DIMENSIONS;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async embed(content: string, files?: Array<{ data: Buffer; mimeType: string }>): Promise<number[]> {
    const model = this.client.getGenerativeModel({ model: EMBEDDING_MODEL });

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { text: content },
    ];

    if (files) {
      for (const file of files) {
        parts.push({
          inlineData: {
            data: file.data.toString('base64'),
            mimeType: file.mimeType,
          },
        });
      }
    }

    const result = await model.embedContent({
      content: { role: 'user', parts },
      taskType: 'RETRIEVAL_DOCUMENT' as any,
      outputDimensionality: DIMENSIONS,
    } as any);

    return result.embedding.values;
  }
}
