import nextPlugin from '@next/eslint-plugin-next';
import pluginQuery from '@tanstack/eslint-plugin-query';
import configPrettier from 'eslint-config-prettier';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Compose Next.js linting per the official monorepo guidance: use
// @next/eslint-plugin-next directly instead of the eslint-config-next umbrella.
// The umbrella bundles eslint-plugin-react@7.x, eslint-plugin-import@2.x, and
// eslint-plugin-jsx-a11y@6.x — all of which have peer eslint <=9 and call the
// removed `context.getFilename()` API on ESLint 10.
// See: https://nextjs.org/docs/app/api-reference/config/eslint#using-the-plugin-directly
const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  ...pluginQuery.configs['flat/recommended'],
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // react-hooks v7 added React 19 best-practice rules that surface as errors.
      // Downgrading to warn so they remain visible without blocking builds; address per-file as time allows.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  configPrettier,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/components/animate-ui/**']),
]);

export default eslintConfig;
