import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", "node_modules/**", "models/**"] }];
export default config;
