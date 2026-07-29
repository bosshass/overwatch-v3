// ============================================================================
// eslint.quickcheck.mjs — the gate that catches the class of bug that keeps
// shipping: a name used that is not in scope.
//
// This is deliberately narrow. It is not a style linter. It is the check that
// would have caught `openJob` being referenced inside Card, and `handleSubmit`
// and `jobDeepLink` and `supabase` in v9. Two rules, both errors:
//   no-undef     — a name that does not exist in scope
//   no-dupe-keys — the same key twice in an object literal
//
// Run before every delivery: npm run verify
// ============================================================================

import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        google: 'readonly',   // Google Identity Services, loaded via script tag
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { react: reactPlugin },
    settings: { react: { version: '18.3' } },
    rules: {
      ...js.configs.recommended.rules,

      // The two that matter. Errors, not warnings — they fail the build.
      'no-undef': 'error',
      'no-dupe-keys': 'error',

      // JSX counts as using a component, otherwise every import looks unused.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',

      // Noise we do not want blocking a delivery.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'off',
    },
  },
];
