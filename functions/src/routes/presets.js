import { Router } from "express";
import { ensureUserRecord, query } from "../db/pool.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { createPresetSchema, validateBody } from "../validation/schemas.js";

const router = Router();

const PRESET_COLUMNS = `
  id, owner_uid AS "ownerUid", name, description,
  filter_state AS "filterState",
  tone_curves AS "toneCurves",
  is_public AS "isPublic",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

/** GET /v1/presets/public — browse shared community presets */
router.get("/public", optionalAuth, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PRESET_COLUMNS}
       FROM presets
       WHERE is_public = TRUE
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ presets: rows });
  } catch (err) {
    next(err);
  }
});

/** GET /v1/presets — list authenticated user's saved presets */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PRESET_COLUMNS}
       FROM presets
       WHERE owner_uid = $1
       ORDER BY updated_at DESC
       LIMIT 100`,
      [req.user.uid]
    );
    res.json({ presets: rows });
  } catch (err) {
    next(err);
  }
});

/** POST /v1/presets — save current filter/OKLCH/curve preset */
router.post("/", requireAuth, validateBody(createPresetSchema), async (req, res, next) => {
  try {
    await ensureUserRecord(req.user);
    const p = req.validated;
    const { rows } = await query(
      `INSERT INTO presets (owner_uid, name, description, filter_state, tone_curves, is_public)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       RETURNING ${PRESET_COLUMNS}`,
      [
        req.user.uid,
        p.name,
        p.description,
        JSON.stringify(p.filterState),
        JSON.stringify(p.toneCurves),
        p.isPublic,
      ]
    );
    res.status(201).json({ preset: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** DELETE /v1/presets/:id — remove a saved preset */
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM presets WHERE id = $1 AND owner_uid = $2`,
      [req.params.id, req.user.uid]
    );
    if (!rowCount) {
      return res.status(404).json({ error: "Preset not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
