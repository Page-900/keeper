import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'artifacts/**', 'cache/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A stringified key is how secrets reach logs.
      '@typescript-eslint/no-base-to-string': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { AbortSignal: 'readonly', fetch: 'readonly', process: 'readonly' },
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        IntersectionObserver: 'readonly',
        TextDecoder: 'readonly',
      },
    },
  },
);
