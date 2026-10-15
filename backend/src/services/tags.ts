import type { ServiceDeps } from './index.js';
import {
  listTags as dbListTags,
  renameTag as dbRenameTag,
  deleteTag as dbDeleteTag,
  type TagRow,
  type ListTagsFilters,
} from '../db/tags.js';

export type { TagRow, ListTagsFilters };

export async function listTags(deps: ServiceDeps, filters: ListTagsFilters = {}): Promise<TagRow[]> {
  return dbListTags(deps.db, filters);
}

export async function renameTag(
  deps: ServiceDeps,
  from: string,
  to: string,
): Promise<{ updated: number }> {
  return dbRenameTag(deps.db, from, to);
}

export async function deleteTag(deps: ServiceDeps, name: string): Promise<{ updated: number }> {
  return dbDeleteTag(deps.db, name);
}
