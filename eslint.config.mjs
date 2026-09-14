import babelParser from "@babel/eslint-parser";

/**
 * Минимальный lint для monorepo (§42.9 DoD).
 *
 * Проект на TypeScript 7.0.2; typescript-eslint hard-блокирует TS >= 7,
 * поэтому TS-парсинг через @babel/eslint-parser (не зависит от версии tsc)
 * + синтаксические core-правила ESLint. Type-aware проверки и типы —
 * за `turbo run typecheck`.
 */
export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.*",
      "tools/**",
      "apps/agent/scripts/**",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-typescript"],
        },
      },
    },
    rules: {
      // Синтаксические правила — ловят мёртвый код без ложных срабатываний.
      "no-unreachable": "error",
      "no-fallthrough": "error",
      "no-dupe-class-members": "error",
      "no-duplicate-case": "error",
      "no-sparse-arrays": "error",
      "no-constant-binary-expression": "error",
      "no-self-assign": "error",
      "no-useless-escape": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
