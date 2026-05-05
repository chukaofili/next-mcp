import js from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import pluginImportX from 'eslint-plugin-import-x';
import pluginTurbo from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

const typeScriptExtensions = ['.ts', '.tsx', '.cts', '.mts'];
const allExtensions = [...typeScriptExtensions, '.js', '.jsx', '.cjs', '.mjs'];

export const baseConfig = tseslint.config(
  js.configs.recommended,
  pluginImportX.flatConfigs.recommended,
  // Inline TS resolver via the modern resolver-next API. We can't use
  // pluginImportX.flatConfigs.typescript because its string-based resolver
  // lookup ('typescript: true') only finds eslint-import-resolver-typescript
  // when it's hoisted to the linting package's own node_modules — pnpm's
  // strict layout puts it inside this config package instead.
  // The factory import below is resolved here and works regardless of where
  // the consuming package sits in the workspace.
  {
    settings: {
      'import-x/extensions': allExtensions,
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/parsers': {
        '@typescript-eslint/parser': [...typeScriptExtensions],
      },
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      'import-x/named': 'off',
    },
  },
  pluginTurbo.configs['flat/recommended'],
  tseslint.configs.recommended,
  configPrettier,
  {
    files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    languageOptions: {
      globals: {
        process: 'writable',
      },
    },
    rules: {
      'turbo/no-undeclared-env-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['error'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowConciseArrowFunctionExpressionsStartingWithVoid: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', '**/tests/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    ignores: [
      '**/coverage/',
      '**/build/',
      '**/dist/',
      '**/.git/',
      '**/.next/',
      '**/**jest.**',
      '**/node_modules',
      '**/.prisma/**',
      '**/design-system/**',
      'pnpm-lock.yaml',
    ],
  }
);
