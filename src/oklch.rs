//! OKLCH Perceptual Color Space Engine
//!
//! Implements the full bidirectional pipeline:
//!   sRGB → Linear → XYZ (D65) → OKLab → OKLCH
//!   OKLCH → OKLab → XYZ → Linear → sRGB
//!
//! Based on Björn Ottosson's OKLab color space:
//! https://bottosson.github.io/posts/oklab/
//!
//! Operations performed in OKLCH space:
//!   - Lightness shift        (L ∈ [0, 1])
//!   - Chroma boost/reduce    (C ≥ 0)
//!   - Hue rotation           (H ∈ [0, 2π] radians)
//!   - Selective hue range chroma boost (target a hue band without shifting hue)

/// Convert a single sRGB u8 channel [0, 255] to linear light [0.0, 1.0].
/// Uses the IEC 61966-2-1 piecewise transfer function.
#[inline(always)]
pub fn srgb_to_linear(v: u8) -> f32 {
    let s = v as f32 / 255.0;
    if s <= 0.04045 {
        s / 12.92
    } else {
        ((s + 0.055) / 1.055_f32).powf(2.4)
    }
}

/// Convert a linear light [0.0, 1.0] value back to sRGB u8 [0, 255].
/// Clamps out-of-gamut values before quantising.
#[inline(always)]
pub fn linear_to_srgb(v: f32) -> u8 {
    let clamped = v.clamp(0.0, 1.0);
    let s = if clamped <= 0.0031308 {
        12.92 * clamped
    } else {
        1.055 * clamped.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round().clamp(0.0, 255.0) as u8
}

/// Convert linear-light RGB → OKLab (L, a, b).
///
/// OKLab matrix from Björn Ottosson's reference implementation.
/// Step 1: linear RGB → LMS (via M1 matrix)
/// Step 2: cube-root non-linearity
/// Step 3: LMS' → Lab (via M2 matrix)
#[inline(always)]
pub fn linear_to_oklab(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    // M1: linear RGB → LMS
    let l = 0.412_2214_7 * r + 0.536_328_6 * g + 0.051_450_7 * b;
    let m = 0.211_9034_8 * r + 0.680_699_5 * g + 0.107_397_1 * b;
    let s = 0.088_302_5 * r + 0.281_718_5 * g + 0.629_978_8 * b;

    // Cube-root non-linearity
    let l_ = l.cbrt();
    let m_ = m.cbrt();
    let s_ = s.cbrt();

    // M2: LMS' → OKLab
    let lab_l = 0.210_454_26 * l_ + 0.793_617_79 * m_ - 0.004_072_05 * s_;
    let lab_a = 1.977_998_45 * l_ - 2.428_592_21 * m_ + 0.450_593_77 * s_;
    let lab_b = 0.025_904_04 * l_ + 0.782_771_77 * m_ - 0.808_675_77 * s_;

    (lab_l, lab_a, lab_b)
}

/// Convert OKLab (L, a, b) back to linear-light RGB.
///
/// Inverse of `linear_to_oklab`.
#[inline(always)]
pub fn oklab_to_linear(lab_l: f32, lab_a: f32, lab_b: f32) -> (f32, f32, f32) {
    // M2 inverse: OKLab → LMS'
    let l_ = lab_l + 0.396_337_78 * lab_a + 0.215_803_76 * lab_b;
    let m_ = lab_l - 0.105_561_34 * lab_a - 0.063_854_17 * lab_b;
    let s_ = lab_l - 0.089_484_18 * lab_a - 1.291_485_55 * lab_b;

    // Undo cube-root non-linearity
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    // M1 inverse: LMS → linear RGB
    let r =  4.076_741_66 * l - 3.307_711_59 * m + 0.230_969_94 * s;
    let g = -1.268_438_00 * l + 2.609_757_40 * m - 0.341_319_38 * s;
    let b = -0.004_196_09 * l - 0.703_418_61 * m + 1.707_614_70 * s;

    (r, g, b)
}

/// Convert OKLab → OKLCH (L, C, H_radians).
///
/// C = chroma (saturation in perceptual space, ≥ 0)
/// H = hue angle in radians [0, 2π)
#[inline(always)]
pub fn oklab_to_oklch(l: f32, a: f32, b: f32) -> (f32, f32, f32) {
    let c = (a * a + b * b).sqrt();
    let h = b.atan2(a); // in [-π, π]
    (l, c, h)
}

/// Convert OKLCH (L, C, H_radians) back to OKLab.
#[inline(always)]
pub fn oklch_to_oklab(l: f32, c: f32, h: f32) -> (f32, f32, f32) {
    let a = c * h.cos();
    let b = c * h.sin();
    (l, a, b)
}

/// Wrap a hue angle (radians) to [-π, π].
#[inline(always)]
fn wrap_hue(h: f32) -> f32 {
    use core::f32::consts::PI;
    let two_pi = 2.0 * PI;
    let mut h = h % two_pi;
    if h > PI {
        h -= two_pi;
    } else if h < -PI {
        h += two_pi;
    }
    h
}

/// Compute a smooth bell-shaped weight for selective hue adjustments.
///
/// Returns a value in [0, 1] that peaks at 1 when `hue` == `center_rad`
/// and falls to 0 outside `±half_range_rad`.
#[inline(always)]
fn hue_weight(hue: f32, center_rad: f32, half_range_rad: f32) -> f32 {
    if half_range_rad <= 0.0 {
        return 0.0;
    }
    let diff = wrap_hue(hue - center_rad).abs();
    if diff >= half_range_rad {
        return 0.0;
    }
    // Smooth cosine window
    let t = diff / half_range_rad; // [0, 1]
    let w = 0.5 * (1.0 + (core::f32::consts::PI * t).cos());
    w
}

/// Apply full OKLCH perceptual color adjustments to an RGBA pixel buffer in place.
///
/// # Parameters
/// - `pixels`              — raw RGBA bytes (length = width × height × 4)
/// - `lightness_shift`     — additive L shift in OKLab [−1.0, +1.0]; 0 = no change
/// - `chroma_scale`        — multiplicative chroma scale [0.0, 3.0]; 1.0 = no change
/// - `hue_rotation_deg`    — global hue rotation in degrees [−180, +180]; 0 = no change
/// - `sel_hue_center_deg`  — center of selective hue band in degrees [0, 360)
/// - `sel_hue_range_deg`   — full-width of selective hue band in degrees [0, 90]
/// - `sel_chroma_boost`    — chroma multiplier applied only to pixels in the hue band
pub fn apply_oklch_adjustments(
    pixels: &mut [u8],
    lightness_shift: f32,
    chroma_scale: f32,
    hue_rotation_deg: f32,
    sel_hue_center_deg: f32,
    sel_hue_range_deg: f32,
    sel_chroma_boost: f32,
) {
    use core::f32::consts::PI;

    // Pre-compute radian conversions (avoid per-pixel divisions)
    let hue_rotation_rad = hue_rotation_deg * (PI / 180.0);
    let sel_center_rad = sel_hue_center_deg * (PI / 180.0) - PI; // atan2 range is [-π, π]
    let sel_half_range_rad = (sel_hue_range_deg * 0.5) * (PI / 180.0);

    // Decide which adjustments are active to skip no-op pixels
    let do_lightness = lightness_shift.abs() > 0.001;
    let do_chroma = (chroma_scale - 1.0).abs() > 0.001;
    let do_hue_rot = hue_rotation_rad.abs() > 0.001;
    let do_selective = sel_hue_range_deg > 0.5 && (sel_chroma_boost - 1.0).abs() > 0.001;

    // Fast-path: nothing to do
    if !do_lightness && !do_chroma && !do_hue_rot && !do_selective {
        return;
    }

    let len = pixels.len();
    let mut i = 0;
    while i + 3 < len {
        let r_in = pixels[i];
        let g_in = pixels[i + 1];
        let b_in = pixels[i + 2];
        // Alpha channel is preserved untouched
        // Skip fully transparent pixels
        let alpha = pixels[i + 3];
        if alpha == 0 {
            i += 4;
            continue;
        }

        // ── Forward path: sRGB → Linear → OKLab → OKLCH ────────────────────
        let r_lin = srgb_to_linear(r_in);
        let g_lin = srgb_to_linear(g_in);
        let b_lin = srgb_to_linear(b_in);

        let (lab_l, lab_a, lab_b) = linear_to_oklab(r_lin, g_lin, b_lin);
        let (mut oklch_l, mut oklch_c, mut oklch_h) = oklab_to_oklch(lab_l, lab_a, lab_b);

        // ── Operations in OKLCH space ────────────────────────────────────────

        // 1. Lightness shift
        if do_lightness {
            oklch_l = (oklch_l + lightness_shift).clamp(0.0, 1.0);
        }

        // 2. Global chroma scale
        if do_chroma {
            oklch_c = (oklch_c * chroma_scale).max(0.0);
        }

        // 3. Global hue rotation
        if do_hue_rot {
            oklch_h = wrap_hue(oklch_h + hue_rotation_rad);
        }

        // 4. Selective hue-range chroma boost
        if do_selective {
            let w = hue_weight(oklch_h, sel_center_rad, sel_half_range_rad);
            if w > 0.0 {
                let effective_boost = 1.0 + w * (sel_chroma_boost - 1.0);
                oklch_c = (oklch_c * effective_boost).max(0.0);
            }
        }

        // ── Inverse path: OKLCH → OKLab → Linear → sRGB ────────────────────
        let (out_l, out_a, out_b) = oklch_to_oklab(oklch_l, oklch_c, oklch_h);
        let (r_out, g_out, b_out) = oklab_to_linear(out_l, out_a, out_b);

        pixels[i]     = linear_to_srgb(r_out);
        pixels[i + 1] = linear_to_srgb(g_out);
        pixels[i + 2] = linear_to_srgb(b_out);
        // pixels[i + 3] = alpha (unchanged)

        i += 4;
    }
}

// ─── Unit tests (native only, not wasm) ─────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_srgb_linear() {
        for v in [0u8, 1, 10, 127, 200, 254, 255] {
            let recovered = linear_to_srgb(srgb_to_linear(v));
            assert!((recovered as i16 - v as i16).abs() <= 1, "v={v} -> {recovered}");
        }
    }

    #[test]
    fn roundtrip_oklab() {
        for (r, g, b) in [(1.0f32, 0.0, 0.0), (0.0, 1.0, 0.0), (0.5, 0.5, 0.5)] {
            let (l, a, b_) = linear_to_oklab(r, g, b);
            let (rr, gg, bb) = oklab_to_linear(l, a, b_);
            assert!((rr - r).abs() < 1e-4, "r round-trip: {r} -> {rr}");
            assert!((gg - g).abs() < 1e-4, "g round-trip: {g} -> {gg}");
            assert!((bb - b).abs() < 1e-4, "b round-trip: {b} -> {bb}");
        }
    }

    #[test]
    fn oklch_roundtrip() {
        let (l, a, b) = (0.7f32, 0.15, -0.08);
        let (lch_l, c, h) = oklab_to_oklch(l, a, b);
        let (ll, aa, bb) = oklch_to_oklab(lch_l, c, h);
        assert!((ll - l).abs() < 1e-5);
        assert!((aa - a).abs() < 1e-5);
        assert!((bb - b).abs() < 1e-5);
    }

    #[test]
    fn no_change_when_neutral_params() {
        let mut pixels = vec![200u8, 100, 50, 255, 10, 20, 30, 255];
        let original = pixels.clone();
        apply_oklch_adjustments(&mut pixels, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
        assert_eq!(pixels, original);
    }
}
