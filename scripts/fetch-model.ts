// RE: pattern from @huggingface/transformers docs (pipeline + env.cacheDir); run at image build time so runtime needs no network.
import { env, pipeline } from "@huggingface/transformers";
import { EMBEDDING_MODEL } from "../lib/config";

env.cacheDir = process.env.MODEL_CACHE_DIR ?? "./models";
env.allowRemoteModels = true;
const ex = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
const t = await ex(["query: smoke test"], { pooling: "mean", normalize: true });
console.log(`model cached in ${env.cacheDir}, dims=${t.dims.join("x")}`);
