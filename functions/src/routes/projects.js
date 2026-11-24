import { Router } from "express";
import { ensureUserRecord, query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createProjectSchema,
  createSnapshotSchema,
  updateProjectSchema,
  validateBody,
} from "../validation/schemas.js";

const router = Router();
router.use(requireAuth);

const PROJECT_COLUMNS = `
  id, owner_uid AS "ownerUid", name, width, height,
  source_storage_path AS "sourceStoragePath",
  mask_storage_path AS "maskStoragePath",
  mask_enabled AS "maskEnabled",
  active_lut_id AS "activeLutId",
  filter_state AS "filterState",
  tone_curves AS "toneCurves",
  is_public AS "isPublic",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

/** GET /v1/projects — list projects owned by authenticated user */
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects
       WHERE owner_uid = $1
       ORDER BY updated_at DESC
       LIMIT 100`,
      [req.user.uid]
    );
    res.json({ projects: rows });
  } catch (err) {
    next(err);
  }
});

/** GET /v1/projects/:id — fetch a single owned (or public) project */
router.get("/:id", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects
       WHERE id = $1 AND (owner_uid = $2 OR is_public = TRUE)`,
      [req.params.id, req.user.uid]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** POST /v1/projects — create a new project */
router.post("/", validateBody(createProjectSchema), async (req, res, next) => {
  try {
    await ensureUserRecord(req.user);
    const p = req.validated;
    const userPrefix = `users/${req.user.uid}/projects/`;
    if (!p.sourceStoragePath.startsWith(userPrefix)) {
      return res.status(403).json({
        error: `sourceStoragePath must reside under ${userPrefix}`,
      });
    }
    if (p.maskStoragePath && !p.maskStoragePath.startsWith(userPrefix)) {
      return res.status(403).json({
        error: `maskStoragePath must reside under ${userPrefix}`,
      });
    }
    const { rows } = await query(
      `INSERT INTO projects (
         owner_uid, name, width, height, source_storage_path,
         mask_storage_path, mask_enabled, active_lut_id,
         filter_state, tone_curves, is_public
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
       RETURNING ${PROJECT_COLUMNS}`,
      [
        req.user.uid,
        p.name,
        p.width,
        p.height,
        p.sourceStoragePath,
        p.maskStoragePath ?? null,
        p.maskEnabled,
        p.activeLutId ?? null,
        JSON.stringify(p.filterState ?? {}),
        JSON.stringify(p.toneCurves ?? {}),
        p.isPublic,
      ]
    );
    res.status(201).json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** PATCH /v1/projects/:id — update project state, curves, mask, or metadata */
router.patch("/:id", validateBody(updateProjectSchema), async (req, res, next) => {
  try {
    const p = req.validated;
    const { rows } = await query(
      `UPDATE projects SET
         name                = COALESCE($3, name),
         width               = COALESCE($4, width),
         height              = COALESCE($5, height),
         source_storage_path = COALESCE($6, source_storage_path),
         mask_storage_path   = COALESCE($7, mask_storage_path),
         mask_enabled        = COALESCE($8, mask_enabled),
         active_lut_id       = COALESCE($9, active_lut_id),
         filter_state        = COALESCE($10::jsonb, filter_state),
         tone_curves         = COALESCE($11::jsonb, tone_curves),
         is_public           = COALESCE($12, is_public)
       WHERE id = $1 AND owner_uid = $2
       RETURNING ${PROJECT_COLUMNS}`,
      [
        req.params.id,
        req.user.uid,
        p.name ?? null,
        p.width ?? null,
        p.height ?? null,
        p.sourceStoragePath ?? null,
        p.maskStoragePath ?? null,
        p.maskEnabled ?? null,
        p.activeLutId ?? null,
        p.filterState ? JSON.stringify(p.filterState) : null,
        p.toneCurves ? JSON.stringify(p.toneCurves) : null,
        p.isPublic ?? null,
      ]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** DELETE /v1/projects/:id — delete an owned project */
router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM projects WHERE id = $1 AND owner_uid = $2`,
      [req.params.id, req.user.uid]
    );
    if (!rowCount) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** GET /v1/projects/:id/snapshots — list cloud history snapshots for a project */
router.get("/:id/snapshots", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.project_id AS "projectId", s.cursor_index AS "cursorIndex",
              s.label, s.filter_state AS "filterState", s.tone_curves AS "toneCurves",
              s.mask_storage_path AS "maskStoragePath", s.created_at AS "createdAt"
       FROM project_snapshots s
       JOIN projects p ON p.id = s.project_id
       WHERE s.project_id = $1 AND (p.owner_uid = $2 OR p.is_public = TRUE)
       ORDER BY s.cursor_index ASC, s.created_at DESC
       LIMIT 50`,
      [req.params.id, req.user.uid]
    );
    res.json({ snapshots: rows });
  } catch (err) {
    next(err);
  }
});

/** POST /v1/projects/:id/snapshots — record a cloud history snapshot */
router.post("/:id/snapshots", validateBody(createSnapshotSchema), async (req, res, next) => {
  try {
    const owned = await query(
      `SELECT id FROM projects WHERE id = $1 AND owner_uid = $2`,
      [req.params.id, req.user.uid]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    const s = req.validated;
    const { rows } = await query(
      `INSERT INTO project_snapshots (
         project_id, cursor_index, label, filter_state, tone_curves, mask_storage_path
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       RETURNING id, project_id AS "projectId", cursor_index AS "cursorIndex",
                 label, filter_state AS "filterState", tone_curves AS "toneCurves",
                 mask_storage_path AS "maskStoragePath", created_at AS "createdAt"`,
      [
        req.params.id,
        s.cursorIndex,
        s.label,
        JSON.stringify(s.filterState),
        JSON.stringify(s.toneCurves),
        s.maskStoragePath ?? null,
      ]
    );
    res.status(201).json({ snapshot: rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
