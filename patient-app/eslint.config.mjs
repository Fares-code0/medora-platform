import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * ESLint — mirrors `frontend/eslint.config.js` so the two clients are held
 * to one standard, minus the web-only rules (`react-refresh`,
 * `dangerouslySetInnerHTML`) and plus the rules a mobile PHI client needs.
 *
 * The boundary zones are the layering rule of docs/ARCHITECTURE.md §3
 * expressed as build failures rather than review comments: platform layers
 * never import features, and features never import each other.
 */
export default tseslint.config(
  {
    // `scripts/` is build-time tooling, not app code: it runs in Node
    // rather than on a phone, it is outside `tsconfig.json`'s `include`,
    // and the type-checked rules below therefore cannot parse it. Its one
    // file today, `generate-app-icons.mjs` (W-01), is exercised by being
    // run — `src/test/app-identity.test.ts` asserts what it produced.
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      '.expo',
      'scripts',
      'babel.config.js',
      'metro.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, import: importPlugin },
    settings: { 'import/resolver': { typescript: { project: './tsconfig.json' } } },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /* ── TypeScript discipline ───────────────────────────────── */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'off',

      /* ── Import ordering ─────────────────────────────────────── */
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [
            { pattern: 'react', group: 'builtin', position: 'before' },
            { pattern: '@/**', group: 'internal' },
          ],
          pathGroupsExcludedImportTypes: ['react'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',

      /* ── Architecture boundaries (docs/ARCHITECTURE.md §3) ───── */
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: [
                './src/components',
                './src/theme',
                './src/api',
                './src/utils',
                './src/types',
                './src/configs',
                './src/storage',
                './src/network',
                './src/accessibility',
                './src/schemas',
              ],
              from: './src/features',
              message: 'Platform layers must not import from features (docs/ARCHITECTURE.md §3).',
            },
          ],
        },
      ],

      /* ── Security posture (docs/ARCHITECTURE.md §7) ──────────── */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-secure-store',
              message:
                'Secure storage is reached through src/storage/secure-store.ts, which is the only module allowed to hold the refresh token (T-02).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'There is no localStorage in React Native. Use src/storage/.',
        },
        {
          name: 'sessionStorage',
          message: 'There is no sessionStorage in React Native. Use src/storage/.',
        },
      ],
      // Every console call in this tree goes through src/utils/logger.ts,
      // which redacts PHI before anything reaches an output sink (T-04).
      'no-console': 'error',
    },
  },

  /* Config files sit outside every tsconfig project, so type-aware rules
     cannot run on them. Same arrangement as `frontend/eslint.config.js`. */
  {
    files: ['*.config.{js,mjs,ts}', 'eslint.config.mjs', 'jest.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { module: 'readonly', require: 'readonly', __dirname: 'readonly' },
    },
  },

  /* The one module allowed to talk to the platform keychain. */
  {
    files: ['src/storage/secure-store.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  /* The redacting logger is the only sanctioned console writer (T-04). */
  {
    files: ['src/utils/logger.ts'],
    rules: { 'no-console': 'off' },
  },

  /* Tests may reach across layers to assert the rules the layers enforce. */
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // `expect(service.method)` on a jest mock is the idiom; the rule's
      // `this`-binding concern does not apply to an assertion.
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },

  prettier,
);
