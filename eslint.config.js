import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      // The engine must stay pure: no UI, framework, DB or I/O dependencies.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'next', 'next/*'],
              message: 'Engine must not depend on UI frameworks.',
            },
            {
              group: ['node:*', 'fs', 'path', 'http', 'https'],
              message: 'Engine must not perform I/O.',
            },
          ],
        },
      ],
      'no-console': 'error',
    },
  },
);
