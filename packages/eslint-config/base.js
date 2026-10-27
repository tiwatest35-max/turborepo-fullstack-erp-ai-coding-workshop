import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Shared rules for every TypeScript package in the monorepo. */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.dev/**',
      'coverage/**',
      '**/src/generated/**',
      // tsup writes its bundled config here for a moment while it builds. Turborepo runs
      // lint and build in parallel, so without this eslint can find the file and then fail
      // to open it.
      '**/tsup.config.bundled_*',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
);
