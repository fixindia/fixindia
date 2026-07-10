# FixIndia Admin Panel

The operator-facing SPA for the FixIndia admin API (`md.enjoyxd.eu.org` in
production). Talks only to the admin API on port 6970.

## Authentication

The admin API accepts **either** of two credentials (see
`server/src/admin_auth.ts`):

1. **Cloudflare Access JWT** (preferred in production) — sent automatically by
   the browser via the `cf-access-jwt-assertion` header once the operator has
   authenticated through the Cloudflare Access login in front of
   `md.enjoyxd.eu.org`. No long-lived secret sits in the browser.
2. **`X-Admin-Key` header** (break-glass / local use) — a shared bearer secret.

### Admin key is never persisted

The admin key is held **in memory only** (React state) for the duration of the
session. It is **never** written to `localStorage`, so:

- an XSS in the panel cannot exfiltrate a persisted key, and
- the key is not left behind on a shared machine.

The key must be re-entered on every reload. Only the API URL (not a secret) is
persisted to `localStorage` for convenience.

For production, prefer Cloudflare Access so the key path is not needed at all.

## Development

This is a React + TypeScript + Vite app. See the Vite template notes below for
lint/type-checking configuration details.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
