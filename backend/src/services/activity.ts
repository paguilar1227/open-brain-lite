import type { ServiceDeps } from './index.js';
import {
  listActivity as dbListActivity,
  type ActivityRow,
  type ActivityKind,
  type ListActivityFilters,
} from '../db/activity.js';

export type { ActivityRow, ActivityKind, ListActivityFilters };

export async function listActivity(
  deps: ServiceDeps,
  filters: ListActivityFilters = {},
): Promise<ActivityRow[]> {
  return dbListActivity(deps.db, filters);
}
