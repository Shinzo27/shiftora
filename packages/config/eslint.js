import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config. Each package calls this from its own eslint.config.js:
 *   export default createConfig({ tsconfigRootDir: import.meta.dirname });
 */
export function createConfig({ tsconfigRootDir }) {
  return defineConfig(
    { ignores: ['dist/**', 'coverage/**'] },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        // AGENTS.md: no default exports except where a framework requires it.
        'no-restricted-syntax': [
          'error',
          {
            selector: 'ExportDefaultDeclaration',
            message: 'Use named exports (see AGENTS.md).',
          },
        ],
        '@typescript-eslint/consistent-type-imports': 'error',
      },
    },
    {
      // Tool config files need a default export and aren't part of the TS project.
      files: ['**/*.config.{js,mjs,ts}'],
      extends: [tseslint.configs.disableTypeChecked],
      rules: { 'no-restricted-syntax': 'off' },
    },
    prettier,
  );
}
