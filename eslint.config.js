import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.nuxt/**', '**/.output/**', '**/migrations/**', 'fixtures/**', '**/test-results/**', '**/playwright-report/**', 'docs/e2e-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', crypto: 'readonly', Buffer: 'readonly', TextEncoder: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
