import { getStats as getStatsRow, type Stats } from '../db/stats.js';
import type { ServiceDeps } from './index.js';

export type { Stats } from '../db/stats.js';

export async function getStats(deps: ServiceDeps, projectId?: string): Promise<Stats> {
  return getStatsRow(deps.db, projectId);
}
