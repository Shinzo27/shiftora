import { createConfig } from '@shiftora/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  reactHooks.configs.flat.recommended,
];
