import globals from "globals";

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        chrome: "readonly",
      },
    },
    rules: {
      // Catches duplicate function / var declarations — the class of bug that
      // motivated this linter setup (e.g. a duplicated detectEnvironment fn).
      "no-redeclare": "error",

      // Catches references to names that were never declared.
      "no-undef": "error",

      // Catches variables declared but never read.
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],

      // Catches objects with duplicate keys — silent override bugs.
      "no-dupe-keys": "error",

      // Catches duplicate case labels in switch statements.
      "no-duplicate-case": "error",

      // Catches unreachable code after return/throw/break/continue.
      "no-unreachable": "error",

      // Catches the common == vs === confusion.
      "eqeqeq": ["warn", "smart"],
    },
  },
];
