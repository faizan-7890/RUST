-- ============================================================================
-- Rust + WebAssembly Image Filter Studio — PostgreSQL Schema (Cloud SQL)
-- Compatible with Firebase Data Connect & Cloud Functions (pg pool)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Automatic updated_at timestamp trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Users (keyed by Firebase Auth UID)
CREATE TABLE IF NOT EXISTS users (
    uid          TEXT PRIMARY KEY,
    email        TEXT UNIQUE,
    display_name TEXT,
    photo_url    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Custom 3D LUTs (.cube files stored in Firebase Storage)
CREATE TABLE IF NOT EXISTS custom_luts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uid    TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    lut_size     SMALLINT NOT NULL CHECK (lut_size BETWEEN 2 AND 65),
    storage_path TEXT NOT NULL,
    file_bytes   INTEGER NOT NULL CHECK (file_bytes > 0),
    is_public    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_luts_owner
    ON custom_luts (owner_uid, created_at DESC);

-- 3. Image Editing Projects (Filter/OKLCH/Lens/Curves state + Storage refs)
CREATE TABLE IF NOT EXISTS projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uid           TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    width               INTEGER NOT NULL CHECK (width > 0 AND width <= 16384),
    height              INTEGER NOT NULL CHECK (height > 0 AND height <= 16384),
    source_storage_path TEXT NOT NULL,
    mask_storage_path   TEXT,
    mask_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    active_lut_id       UUID REFERENCES custom_luts(id) ON DELETE SET NULL,
    filter_state        JSONB NOT NULL DEFAULT '{}'::jsonb,
    tone_curves         JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_public           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
    ON projects (owner_uid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_public
    ON projects (is_public, updated_at DESC)
    WHERE is_public = TRUE;

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Cloud Project History Snapshots (mirrors in-Wasm HistoryEntry metadata)
CREATE TABLE IF NOT EXISTS project_snapshots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cursor_index      INTEGER NOT NULL CHECK (cursor_index >= 0),
    label             TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
    filter_state      JSONB NOT NULL,
    tone_curves       JSONB NOT NULL,
    mask_storage_path TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project_cursor
    ON project_snapshots (project_id, cursor_index ASC, created_at DESC);

-- 5. Reusable Filter / OKLCH / Curve Presets
CREATE TABLE IF NOT EXISTS presets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_uid    TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description  TEXT DEFAULT '',
    filter_state JSONB NOT NULL,
    tone_curves  JSONB NOT NULL,
    is_public    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presets_owner
    ON presets (owner_uid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_presets_public
    ON presets (is_public, created_at DESC)
    WHERE is_public = TRUE;

CREATE TRIGGER trg_presets_updated_at
    BEFORE UPDATE ON presets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
