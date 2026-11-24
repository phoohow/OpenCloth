import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const TS_FILES = ['src/**/*.ts', 'src/**/*.tsx'];

const UP = ['..', '../..', '../../..'];

function unreachable(names) {
  return names.flatMap(name => [
    `@/${name}`, `@/${name}/**`,
    ...UP.flatMap(up => [`${up}/${name}`, `${up}/${name}/**`]),
  ]);
}

function boundary(group, layer, target, severity = 'error') {
  return [severity, {
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
    files: ['src/model/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(
        unreachable(['pattern', 'ui', 'render', 'sim', 'io']),
        'model',
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
    files: ['src/runtime/**/*.ts', 'src/commands/**/*.ts'],
    rules: {
      'no-restricted-imports': boundary(
        unreachable(['ui', 'store']),
        'runtime and commands',
        'ui or store',
      ),
    },
  },
  {
    files: ['src/tools/**/*.ts', 'src/runtime/engine/engineTiming.ts'],
    rules: { 'no-console': 'off' },
  },
];
