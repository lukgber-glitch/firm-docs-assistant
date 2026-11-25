// RE: L1 -> @langchain/core Embeddings base class + @huggingface/transformers feature-extraction pipeline (public docs)
import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING_MODEL } from "./config";

// Model files are baked into the image (scripts/fetch-model.ts); the container is read-only and needs no network.
env.cacheDir = process.env.MODEL_CACHE_DIR ?? "./models";
env.allowRemoteModels = process.env.ALLOW_MODEL_DOWNLOAD === "1";
env.allowLocalModels = true;

let extractor: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" }) as Promise<FeatureExtractionPipeline>;
  return extractor;
}

/**
 * LangChain `Embeddings` backed by multilingual-e5-small running in-process (ONNX, CPU).
 * e5 was trained with role prefixes: "query: " for questions, "passage: " for documents.
 * Vectors are L2-normalised, so cosine similarity equals the dot product.
 */
export class LocalE5Embeddings extends Embeddings {
  constructor(params: EmbeddingsParams = {}) {
    super(params);
  }

  private async embed(texts: string[], prefix: "query" | "passage"): Promise<number[][]> {
    const ex = await getExtractor();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16).map((t) => `${prefix}: ${t}`);
      const t = await ex(batch, { pooling: "mean", normalize: true });
      out.push(...(t.tolist() as number[][]));
    }
    return out;
  }

  embedDocuments(documents: string[]): Promise<number[][]> {
    return this.embed(documents, "passage");
  }

  async embedQuery(document: string): Promise<number[]> {
    return (await this.embed([document], "query"))[0]!;
  }
}
