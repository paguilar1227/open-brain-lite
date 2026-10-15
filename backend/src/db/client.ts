import pg from 'pg';
import pgvector from 'pgvector/pg';

const { Pool } = pg;

export interface DbClient {
  pool: pg.Pool;
  query(text: string, params?: unknown[]): Promise<pg.QueryResult>;
  transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDbClient(connectionString: string): DbClient {
  const pool = new Pool({ connectionString });

  // Register pgvector type parser on first connect
  let vectorRegistered = false;
  const ensureVector = async () => {
    if (!vectorRegistered) {
      const client = await pool.connect();
      try {
        await pgvector.registerTypes(client);
        vectorRegistered = true;
      } finally {
        client.release();
      }
    }
  };

  return {
    pool,

    async query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
      await ensureVector();
      return pool.query(text, params);
    },

    async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
      await ensureVector();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
