import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * ESLint — FRONTEND_ARCHITECTURE.md §1.2 (boundaries), §11 (token discipline),
 * §12.4 (XSS). Boundary violations are build failures, not review comments.
 */
export default tseslint.config(
  // `.claude/` holds nested git worktrees (each with its own dist/node_modules)
  // that must never be linted from this checkout.
  // `storybook-static` is the workbench's build output (F-09) and
  // `dist-artifact` the single-file artifact build's — both generated JS,
  // outside every tsconfig, which type-aware rules cannot lint.
  { ignores: ['dist', 'dist-artifact', 'node_modules', 'coverage', '.claude', 'storybook-static'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /* ── TypeScript discipline (§9) ─────────────────────────── */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

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

      /* ── Architecture boundaries (§1.2, §3.4) ────────────────── */
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // Platform layers must never import from features.
            {
              target: [
                './src/components',
                './src/layouts',
                './src/hooks',
                './src/api',
                './src/utils',
                './src/services',
                './src/types',
                './src/constants',
                './src/configs',
                // i18n is a platform layer (F-19). It was feature-local to
                // auth, which is precisely why the other twelve features
                // could not use it; the rule keeps it from drifting back.
                './src/i18n',
              ],
              from: './src/features',
              message:
                'Platform layers must not import from features (FRONTEND_ARCHITECTURE.md §1.2).',
            },
            // Features must not import other features (shared-domain excepted).
            {
              target: './src/features/doctor',
              from: ['./src/features/admin', './src/features/auth'],
              message: 'Cross-feature imports are forbidden; use shared-domain (§3.4).',
            },
            {
              target: './src/features/admin',
              from: ['./src/features/doctor', './src/features/auth'],
              message: 'Cross-feature imports are forbidden; use shared-domain (§3.4).',
            },
            {
              // The staff workspaces (DEC-006a) reuse other features' screens
              // through the app layer, never by importing them.
              target: './src/features/staff',
              from: ['./src/features/doctor', './src/features/admin', './src/features/auth'],
              message: 'Cross-feature imports are forbidden; compose in src/app (§3.4).',
            },
            {
              target: './src/features/shared-domain',
              from: [
                './src/features/doctor',
                './src/features/admin',
                './src/features/auth',
                './src/features/staff',
              ],
              message: 'shared-domain must not depend on role features (§3.3).',
            },
          ],
        },
      ],

      /* ── Security (§12.4) ────────────────────────────────────── */
      'no-restricted-properties': [
        'error',
        {
          property: 'dangerouslySetInnerHTML',
          message:
            'dangerouslySetInnerHTML is banned (XSS). The sanitized rich-text viewer is the single audited exception (§12.4).',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'Use the typed preferences service (src/services/preferences.ts) — §12.5.',
        },
      ],
    },
  },

  /* The preferences service and theme boot are the sanctioned storage access.
     The boot script lives inline in index.html, so eslint never sees it; its
     test is the one place that exercises it, and it has to reach past the
     typed service to seed the malformed values the service cannot produce. */
  {
    files: ['src/services/preferences.ts', 'src/test/theme-boot.test.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },

  /* Node-context config files and build scripts: no type-aware rules needed
     (they are outside the tsconfig project, so typed rules cannot run). */
  {
    files: ['*.config.{js,ts}', 'postcss.config.js', 'scripts/**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },

  prettier,
);
