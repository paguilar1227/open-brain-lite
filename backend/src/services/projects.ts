import type { ServiceDeps } from './index.js';
import {
  insertProject, listProjects as dbListProjects, getProjectById,
  updateProject as dbUpdateProject,
  archiveProject as dbArchiveProject,
  unarchiveProject as dbUnarchiveProject,
  deleteProjectHard as dbDeleteHard,
  pinProject as dbPinProject,
  unpinProject as dbUnpinProject,
  getProjectCounts as dbGetProjectCounts,
  type ProjectRow,
  type ProjectCounts,
} from '../db/projects.js';

export async function createProject(
  deps: ServiceDeps,
  name: string,
  description: string | null,
): Promise<ProjectRow> {
  return insertProject(deps.db, { name, description });
}

export async function listProjects(
  deps: ServiceDeps,
  status?: string,
  pinned?: boolean,
): Promise<ProjectRow[]> {
  return dbListProjects(deps.db, status, pinned);
}

export async function listProjectCounts(deps: ServiceDeps): Promise<ProjectCounts[]> {
  return dbGetProjectCounts(deps.db);
}

export async function pinProject(deps: ServiceDeps, id: string): Promise<{ found: boolean }> {
  return dbPinProject(deps.db, id);
}

export async function unpinProject(deps: ServiceDeps, id: string): Promise<{ found: boolean }> {
  return dbUnpinProject(deps.db, id);
}

export async function getProject(deps: ServiceDeps, id: string): Promise<ProjectRow | null> {
  return getProjectById(deps.db, id);
}

export async function updateProject(
  deps: ServiceDeps,
  id: string,
  patch: { name?: string; description?: string | null; status?: string },
): Promise<ProjectRow | null> {
  return dbUpdateProject(deps.db, id, patch);
}

export async function archiveProject(deps: ServiceDeps, id: string): Promise<void> {
  await dbArchiveProject(deps.db, id);
}

export async function unarchiveProject(deps: ServiceDeps, id: string): Promise<void> {
  await dbUnarchiveProject(deps.db, id);
}

/**
 * Permanently delete a project. Scrubs its UUID from every content_items.project_ids[]
 * array, sets todos.project_id to NULL (via FK cascade), and removes the project row.
 */
export async function deleteProjectHard(deps: ServiceDeps, id: string): Promise<void> {
  await dbDeleteHard(deps.db, id);
}
