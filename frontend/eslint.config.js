import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "public/**"]
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        AbortController: "readonly",
        Blob: "readonly",
        CustomEvent: "readonly",
        FileReader: "readonly",
        File: "readonly",
        FormData: "readonly",
        Image: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        alert: "readonly",
        atob: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        confirm: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        performance: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        window: "readonly"
      }
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  }
];
