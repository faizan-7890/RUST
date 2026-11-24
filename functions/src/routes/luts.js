import { Router } from "express";
import { ensureUserRecord, query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { createLutSchema, validateBody } from "../validation/schemas.js";

const router = Router();
router.use(requireAuth);

const LUT_COLUMNS = `
  id, owner_uid AS "ownerUid", title, lut_size AS "lutSize",
  storage_path AS "storagePath", file_bytes AS "fileBytes",
  is_public AS "isPublic", created_at AS "createdAt"
`;

/** GET /v1/luts — list user's custom 3D LUT metadata records */
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${LUT_COLUMNS}
       FROM custom_luts
       WHERE owner_uid = $1 OR is_public = TRUE
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.uid]
    );
    res.json({ luts: rows });
  } catch (err) {
    next(err);
  }
});

/** POST /v1/luts — register a .cube LUT uploaded to Firebase Storage */
router.post("/", validateBody(createLutSchema), async (req, res, next) => {
  try {
    await ensureUserRecord(req.user);
    const lut = req.validated;
    const expectedPrefix = `users/${req.user.uid}/luts/`;
    if (!lut.storagePath.startsWith(expectedPrefix)) {
      return res.status(403).json({
        error: `storagePath must reside under ${expectedPrefix}`,
      });
    }

    const { rows } = await query(
      `INSERT INTO custom_luts (owner_uid, title, lut_size, storage_path, file_bytes, is_public)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${LUT_COLUMNS}`,
      [
        req.user.uid,
        lut.title,
        lut.lutSize,
        lut.storagePath,
        lut.fileBytes,
        lut.isPublic,
      ]
    );
    res.status(201).json({ lut: rows[0] });
  } catch (err) {
    next(err);
  }
});

/** DELETE /v1/luts/:id — delete a custom LUT record owned by the user */
router.delete("/:id", async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM custom_luts WHERE id = $1 AND owner_uid = $2`,
      [req.params.id, req.user.uid]
    );
    if (!rowCount) {
      return res.status(404).json({ error: "LUT not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
