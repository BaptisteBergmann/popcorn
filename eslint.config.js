import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'drizzle', 'node_modules', 'src/web/components/ui', 'src/web/public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The web side must never pull runtime code from the server.
    files: ['src/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@server/*', '**/server/*'],
              allowTypeImports: true,
              message: 'src/web may only use `import type` from src/server.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
);
