/** @type {import("next").NextConfig} */
const config = {
  // Native / ONNX packages must not be bundled; they are loaded from node_modules at runtime.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "pg"],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/healthz", destination: "/api/healthz" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default config;
