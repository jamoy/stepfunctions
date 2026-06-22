const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    // Formatting is owned by Prettier (enforced via `prettier --check` in the
    // lint script); ESLint only covers code quality here.
    rules: {
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
    },
  },
];
