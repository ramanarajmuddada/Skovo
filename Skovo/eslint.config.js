import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Build/config files run in Node, not the browser. Without this they were
    // linted against browser globals only, so `__dirname` and `process` in
    // vite.config.js reported as no-undef — two errors that could never happen
    // at runtime, sitting in the output where real ones need to be visible.
    files: ['vite.config.js', 'eslint.config.js', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
