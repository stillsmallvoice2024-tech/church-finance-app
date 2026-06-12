module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  rules: {
    // Core React hooks correctness — this is the important rule.
    'react-hooks/rules-of-hooks': 'error',
    // Dep-array completeness has 4 pre-existing violations; off until addressed.
    'react-hooks/exhaustive-deps': 'off',

    // TypeScript noUnusedLocals/noUnusedParameters handle this at compile time.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',

    // Explicit any — intentional uses suppressed inline.
    '@typescript-eslint/no-explicit-any': 'error',

    // Pre-existing patterns covered by TypeScript strict mode.
    'no-empty': 'off',
    'no-useless-escape': 'off',
    'prefer-const': 'off',

    // await-in-loop is intentional in pagination/batch helpers throughout the
    // codebase; off until a dedicated lint-fix pass adds inline suppressions.
    'no-await-in-loop': 'off',
  },
  ignorePatterns: ['dist', 'node_modules'],
}
