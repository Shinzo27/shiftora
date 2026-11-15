import { createConfig } from '@shiftora/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  reactHooks.configs.flat.recommended,
  {
    // public/push-handler.js is a service worker fragment, copied verbatim into the build: it is
    // not part of the TypeScript project, so the type-aware rules cannot see it.
    ignores: ['public/**'],
  },
];
