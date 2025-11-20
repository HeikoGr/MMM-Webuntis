import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import pluginN from "eslint-plugin-n";

export default defineConfig([
  {
    ignores: ["**/node_modules/**", "**/*.png"]
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    ignores: ["MMM-Webuntis.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    },
    plugins: {
      n: pluginN
    },
    rules: {
      ...pluginN.configs.recommended.rules
    }
  },
  {
    files: ["MMM-Webuntis.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: {
        ...globals.browser,
        Log: "readonly",
        Module: "readonly",
        config: "readonly"
      }
    },
    rules: {
      "no-console": [
        "warn",
        {
          allow: ["warn", "error"]
        }
      ]
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.mocha
      }
    }
  }
]);
