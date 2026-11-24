import { z } from "zod";

const curvePointSchema = z.object({
  x: z.number().min(0).max(255),
  y: z.number().min(0).max(255),
});

export const toneCurvesSchema = z.object({
  master: z.array(curvePointSchema).min(2).max(32),
  r: z.array(curvePointSchema).min(2).max(32),
  g: z.array(curvePointSchema).min(2).max(32),
  b: z.array(curvePointSchema).min(2).max(32),
});

export const filterStateSchema = z.object({
  brightness: z.number().min(-255).max(255).optional(),
  contrast: z.number().min(-255).max(255).optional(),
  saturation: z.number().min(0).max(5).optional(),
  hue: z.number().min(-360).max(360).optional(),
  gamma: z.number().min(0.1).max(5).optional(),
  vignette: z.number().min(0).max(2).optional(),
  blur: z.number().min(0).max(50).optional(),
  sharpen: z.number().min(0).max(10).optional(),
  unsharpAmount: z.number().min(0).max(10).optional(),
  unsharpRadius: z.number().min(0.1).max(20).optional(),
  bilateralSpatial: z.number().min(0).max(20).optional(),
  bilateralRange: z.number().min(0.1).max(255).optional(),
  lut3dPreset: z.string().max(120).optional(),
  lut3dIntensity: z.number().min(0).max(1).optional(),
  lensK1: z.number().min(-1).max(1).optional(),
  chromaticAberration: z.number().min(-0.2).max(0.2).optional(),
  caAngle: z.number().min(-360).max(360).optional(),
  sepia: z.boolean().optional(),
  invert: z.boolean().optional(),
  grayscale: z.boolean().optional(),
  // OKLCH perceptual parameters
  oklchLightness: z.number().min(-1).max(1).optional(),
  oklchChroma: z.number().min(0).max(3).optional(),
  oklchHueRotation: z.number().min(-180).max(180).optional(),
  oklchSelHueCenter: z.number().min(0).max(360).optional(),
  oklchSelHueRange: z.number().min(0).max(90).optional(),
  oklchSelChromaBoost: z.number().min(0).max(3).optional(),
}).passthrough();

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  sourceStoragePath: z.string().min(1).max(512),
  maskStoragePath: z.string().max(512).nullable().optional(),
  maskEnabled: z.boolean().default(false),
  activeLutId: z.string().uuid().nullable().optional(),
  filterState: filterStateSchema.default({}),
  toneCurves: toneCurvesSchema.optional(),
  isPublic: z.boolean().default(false),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createSnapshotSchema = z.object({
  cursorIndex: z.number().int().min(0),
  label: z.string().trim().min(1).max(120),
  filterState: filterStateSchema,
  toneCurves: toneCurvesSchema,
  maskStoragePath: z.string().max(512).nullable().optional(),
});

export const createPresetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(""),
  filterState: filterStateSchema,
  toneCurves: toneCurvesSchema,
  isPublic: z.boolean().default(false),
});

export const createLutSchema = z.object({
  title: z.string().trim().min(1).max(120),
  lutSize: z.number().int().min(2).max(65),
  storagePath: z.string().min(1).max(512),
  fileBytes: z.number().int().positive().max(10 * 1024 * 1024),
  isPublic: z.boolean().default(false),
});

/**
 * Express middleware that validates `req.body` against a Zod schema.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
    }
    req.validated = parsed.data;
    return next();
  };
}
