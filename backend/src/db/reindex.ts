import type { DbClient } from './client.js';
/** Commit source/state/index retirement together so startup always knows what must be rebuilt. */
export async function beginContentReindex(db: DbClient, id: string, content?: string): Promise<void> {
  await db.transaction(async tx => {
    const result = await tx.query(`UPDATE content_items SET processing_status = 'pending', processing_error = NULL,
      ingest_completed_at = NULL, updated_at = now()${content === undefined ? '' : ', content = $2'}
      WHERE id = $1 AND processing_status <> 'pending' RETURNING id`, content === undefined ? [id] : [id, content]);
    if (result.rowCount === 0) throw new Error('Content is missing or already being reindexed');
    await tx.query('DELETE FROM chunks WHERE content_item_id = $1', [id]);
  });
}
