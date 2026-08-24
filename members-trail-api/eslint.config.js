// @ts-check
const tseslint = require("typescript-eslint");

/* ============================================================================
 * Lint rules.
 *
 * Deliberately short. The type checker already catches most of what a linter is
 * often configured to catch, and a rule set that produces hundreds of warnings
 * nobody reads is worse than none. What is here are the rules that catch bugs
 * this codebase can actually have:
 *
 *  - a forgotten `await` on a money-moving call (floating promises);
 *  - a `Promise` passed where a value was expected (misused promises);
 *  - `any` creeping in and silently disabling every other check;
 *  - an unused variable, which usually means a refactor left something behind.
 * ========================================================================== */

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "tmp/**", "**/*.js"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      /* An unawaited promise in a service that moves money is a silent partial
       * write, and it is the single most likely serious bug in an async
       * codebase. */
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "off",

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          /* `const { password, ...rest } = obj` is how this codebase omits a
           * field, and the omitted name is unused by definition. */
          ignoreRestSiblings: true,
        },
      ],

      /* `??` over `||` matters here: `||` treats 0 and "" as absent, and this
       * codebase passes both around as legitimate amounts.
       *
       * `ignoreIfStatements` is on because `if (!x) x = y` is NOT the same as
       * `x ??= y` — the first also replaces an empty string or a zero. Where the
       * code writes it out longhand, that is usually the intent, and rewriting
       * it mechanically would change behaviour. */
      "@typescript-eslint/prefer-nullish-coalescing": ["error", { ignoreIfStatements: true }],

      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
    },
  },
  {
    /* Tests may lean on non-null assertions and loose typing on doubles: a mock
     * that has to satisfy a full entity type stops being readable. */
    files: ["**/*.spec.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
