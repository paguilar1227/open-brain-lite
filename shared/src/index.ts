// shared/src/index.ts
//
// Re-exports the entire schemas surface so consumers can:
//   import { Project, ProjectSchema } from '@open-brain/shared';
//
// For the (rare) case where someone wants schemas only:
//   import { ProjectSchema } from '@open-brain/shared/schemas';

export * from './schemas.js';
