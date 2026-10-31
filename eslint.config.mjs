import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Files linted by `npm run lint`. */
const TS_FILES = ['src/**/*.ts', 'src/**/*.tsx'];

/** Builds the `no-restricted-imports` options for one layer boundary. */
function boundary(group, layer, target) {
  return ['error', {
    patterns: [{ group, message: `${layer} must not import from ${target}.` }],
  }];
}

export default [
  {
    ignores: ['dist/**', 'assets/**', 'node_modules/**', 'functions/**', 'scripts/**'],
  },
  {
    files: TS_FILES,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-debugger': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/core/model/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(
        ['**/pattern', '**/pattern/**', '**/ui', '**/ui/**', '**/render', '**/render/**', '**/sim', '**/sim/**', '**/io', '**/io/**'],
        'core/model',
        'pattern, ui, render, sim or io',
      ),
    },
  },
  {
    files: ['src/pattern/**/*.ts', 'src/pattern/**/*.tsx'],
    rules: {
      'no-restricted-imports': boundary(
        ['**/ui', '**/ui/**'],
        'pattern',
        'ui',
      ),
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(
        ['**/ui', '**/ui/**'],
        'sim',
        'ui',
      ),
    },
  },
  {
    files: ['src/tools/**/*.ts', 'src/core/engine/engineTiming.ts'],
    rules: { 'no-console': 'off' },
  },
];
