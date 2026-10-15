CREATE TABLE IF NOT EXISTS project_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  summary text NOT NULL,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_memory_project_idx ON project_memory(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS project_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  summary text NOT NULL,
  decisions text[] NOT NULL DEFAULT '{}',
  next_steps text[] NOT NULL DEFAULT '{}',
  note_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, session_key)
);
