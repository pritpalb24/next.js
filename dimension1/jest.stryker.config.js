const path = require('path')
const repoRoot = path.join(__dirname, '..')

const nextJest = require(path.join(repoRoot, 'node_modules', 'next', 'jest.js'))

const createJestConfig = nextJest()

/** @type {import('jest').Config} */

const customJestConfig = {
  displayName: 'stryker-dim2',
  testMatch: [
    '<rootDir>/unit/create-client-router-filter.test.ts',
    '<rootDir>/unit/create_client_router_filter_stryker.test.ts',
    '<rootDir>/unit/image-optimizer/**/*.test.ts',
    '<rootDir>/unit/image_optimizer_stryker.test.ts',
  ],
  globalSetup: '<rootDir>/jest-global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/jest-setup-after-env.ts'],
  verbose: false,
  rootDir: path.join(repoRoot, 'test'),
  roots: [
    '<rootDir>',
    '<rootDir>/../packages/next/src/',
  ],
  haste: { throwOnModuleCollision: true },
  modulePathIgnorePatterns: [
    '/\\.next/',
    'packages/next/src/compiled/',
    '<rootDir>/development/app-dir/ssr-in-rsc/internal-pkg/',
    '<rootDir>/e2e/app-dir/self-importing-package/internal-pkg',
    '<rootDir>/e2e/app-dir/self-importing-package-monorepo/internal-pkg',
    '<rootDir>/e2e/app-dir/server-source-maps/fixtures/default/internal-pkg',
    '<rootDir>/e2e/transpile-packages-typescript-foreign/pkg',
    '<rootDir>/production/standalone-mode/tracing-side-effects-false/foo',
    '<rootDir>/production/standalone-mode/tracing-static-files/foo',
    '<rootDir>/production/standalone-mode/tracing-unparsable/foo',
    '<rootDir>/production/supports-module-resolution-nodenext/pkg',
  ],
  modulePaths: ['<rootDir>/lib'],
  transformIgnorePatterns: ['/next[/\\\\]dist/', '/\\.next/'],
  moduleNameMapper: {
    '@next/font/(.*)': '@next/font/$1',
    '^next/dist/lib/create-client-router-filter$':
      '<rootDir>/../packages/next/src/lib/create-client-router-filter.ts',
    '^next/dist/server/image-optimizer$':
      '<rootDir>/../packages/next/src/server/image-optimizer.ts',
    '^next/dist/shared/lib/bloom-filter$':
      '<rootDir>/../packages/next/src/shared/lib/bloom-filter.ts',
    '^next/dist/shared/lib/image-config$':
      '<rootDir>/../packages/next/src/shared/lib/image-config.ts',
    '^next/dist/shared/lib/find-closest-quality$':
      '<rootDir>/../packages/next/src/shared/lib/find-closest-quality.ts',
    '^next/dist/shared/lib/match-remote-pattern$':
      '<rootDir>/../packages/next/src/shared/lib/match-remote-pattern.ts',
    '^next/dist/shared/lib/match-local-pattern$':
      '<rootDir>/../packages/next/src/shared/lib/match-local-pattern.ts',
    '^next/dist/server/lib/disk-lru-cache.external$':
      '<rootDir>/../packages/next/src/server/lib/disk-lru-cache.external.ts',
    '^next/dist/server/response-cache/types$':
      '<rootDir>/../packages/next/src/server/response-cache/types.ts',
  },
}



module.exports = createJestConfig(customJestConfig)
