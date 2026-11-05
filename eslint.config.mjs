import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** Files linted by `npm run lint`. */
const TS_FILES = ['src/**/*.ts', 'src/**/*.tsx'];

/** Upward-relative prefixes a module under `src/` can use to reach a sibling layer. */
const UP = ['..', '../..', '../../..'];

/**
 * Import specifiers that reach one of the named layer directories. The leading `../` is what
 * makes this precise: a file *named* `pattern.ts` inside a layer (`./pattern`, `./types/pattern`)
 * is a normal sibling module, while `../../pattern` is the layer and stays forbidden.
 */
function unreachable(names) {
  return names.flatMap(name => UP.flatMap(up => [`${up}/${name}`, `${up}/${name}/**`]));
}

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
        unreachable(['pattern', 'ui', 'render', 'sim', 'io']),
        'core/model',
        'pattern, ui, render, sim or io',
      ),
    },
  },
  {
    files: ['src/pattern/**/*.ts', 'src/pattern/**/*.tsx'],
    rules: {
      'no-restricted-imports': boundary(unreachable(['ui']), 'pattern', 'ui'),
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(unreachable(['ui']), 'sim', 'ui'),
    },
  },
  {
    files: ['src/tools/**/*.ts', 'src/core/engine/engineTiming.ts'],
    rules: { 'no-console': 'off' },
  },
];
