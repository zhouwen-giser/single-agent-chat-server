module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  ignorePatterns: ["dist", "node_modules", ".tmp"],
  overrides: [
    {
      files: ["scripts/v06-functional-compose.mjs"],
      parserOptions: { project: null },
      env: { node: true, es2022: true },
      globals: { fetch: "readonly" },
    },
  ],
};
