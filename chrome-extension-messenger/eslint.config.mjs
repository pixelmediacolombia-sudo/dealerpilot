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
        DealerPilotMessengerApiClient: "readonly",
        DealerPilotMessengerCapture: "readonly",
        DealerPilotMessengerAi: "readonly",
      },
    },
    rules: {
      "no-redeclare": "error",
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "eqeqeq": ["warn", "smart"],
    },
  },
];
