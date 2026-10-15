-- ============================================================================
-- Open Brain V2 — Project-scoped Knowledge Base + Productivity Tool
-- Clean slate schema. No legacy compatibility.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- projects — top-level containers
-- ============================================================================
CREATE TABLE projects (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           text NOT NULL,
  description    text,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'archived', 'completed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_active ON projects(status) WHERE status = 'active';

-- ============================================================================
-- content_items — unified documents + notes
-- Both get chunked, both support multimedia, both can live in multiple projects
-- type discriminator separates them for UX/editor concerns
-- ============================================================================
CREATE TABLE content_items (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type           text NOT NULL CHECK (type IN ('document', 'note')),
  title          text NOT NULL,
  title_source   text NOT NULL DEFAULT 'user'
                 CHECK (title_source IN ('user', 'ai_generated', 'filename')),
  content        text,
  blob_url       text,
  mime_type      text,
  file_hash      text,
  project_ids    uuid[] NOT NULL DEFAULT '{}',
  tags           text[] NOT NULL DEFAULT '{}',
  embedding      vector(768),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_items_type      ON content_items(type);
CREATE INDEX idx_content_items_projects  ON content_items USING GIN (project_ids);
CREATE INDEX idx_content_items_tags      ON content_items USING GIN (tags);
CREATE INDEX idx_content_items_hash      ON content_items(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX idx_content_items_created   ON content_items(created_at DESC) WHERE archived = false;

-- ============================================================================
-- chunks — searchable units inside content_items
-- ============================================================================
CREATE TABLE chunks (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_item_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  chunk_index      integer NOT NULL,
  chunk_type       text NOT NULL
                   CHECK (chunk_type IN ('text', 'image', 'audio_segment', 'video_keyframe')),
  content          text,
  embedding        vector(768) NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, chunk_index)
);

CREATE INDEX idx_chunks_content_item ON chunks(content_item_id);
-- HNSW index deferred: 3072-dim vectors exceed B1ms memory limits.
-- Sequential scan works for the expected corpus size; revisit if performance degrades.

-- ============================================================================
-- todos — actionable items
-- Single project (nullable = personal Inbox), recursive subtasks via parent_id
-- ============================================================================
CREATE TABLE todos (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  content        text NOT NULL,
  project_id     uuid REFERENCES projects(id) ON DELETE SET NULL,
  section        text,
  parent_id      uuid REFERENCES todos(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started', 'in_progress', 'paused', 'done')),
  priority       text CHECK (priority IN ('P1', 'P2', 'P3')),
  due_date       timestamptz,
  tags           text[] NOT NULL DEFAULT '{}',
  embedding      vector(768),
  archived       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_todos_project ON todos(project_id) WHERE archived = false;
CREATE INDEX idx_todos_parent  ON todos(parent_id);
CREATE INDEX idx_todos_status  ON todos(status, due_date) WHERE archived = false;
CREATE INDEX idx_todos_tags    ON todos USING GIN (tags);

-- ============================================================================
-- todo_comments — discussion threads on tasks
-- ============================================================================
CREATE TABLE todo_comments (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  todo_id        uuid NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  content        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_todo_comments_todo ON todo_comments(todo_id);
