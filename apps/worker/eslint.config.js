import { createConfig } from '@shiftora/config/eslint';

export default [
  // The dev supervisor is plain Node, not part of the TS project.
  { ignores: ['scripts/**'] },
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
];
