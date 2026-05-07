import reactPlugin from '@eslint-react/eslint-plugin';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { baseConfig as base } from './base.js';

/**
 * A custom ESLint configuration for libraries that use React.
 *
 * @type {import("eslint").Linter.Config}
 */
export const baseConfig = [
  ...base,
  reactPlugin.configs['recommended-typescript'],
  {
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];
