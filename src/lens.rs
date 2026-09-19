//! Lens Optics & Chromatic Aberration Engine.
//!
//! Implements:
//! 1. Brown-Conrady Radial Lens Distortion (Barrel & Pincushion).
//! 2. Lateral Chromatic Aberration (Wavelength-dependent radial RGB dispersion & prism offset).
//! 3. Sub-pixel Bilinear Interpolation kernel with border clamping.

/// Bilinear interpolation helper for sampling a single color channel from an RGBA buffer.
#[inline(always)]
fn sample_bilinear_channel(
    buffer: &[u8],
    width: u32,
    height: u32,
    x: f32,
    y: f32,
    channel_offset: usize,
) -> f32 {
    let w = width as i32;
    let h = height as i32;

    let x_clamped = x.clamp(0.0, (w - 1) as f32);
    let y_clamped = y.clamp(0.0, (h - 1) as f32);

    let x0 = x_clamped.floor() as i32;
    let y0 = y_clamped.floor() as i32;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);

    let s = x_clamped - x0 as f32;
    let t = y_clamped - y0 as f32;

    let idx00 = ((y0 * w + x0) as usize) * 4 + channel_offset;
    let idx10 = ((y0 * w + x1) as usize) * 4 + channel_offset;
    let idx01 = ((y1 * w + x0) as usize) * 4 + channel_offset;
    let idx11 = ((y1 * w + x1) as usize) * 4 + channel_offset;

    let v00 = buffer[idx00] as f32;
    let v10 = buffer[idx10] as f32;
    let v01 = buffer[idx01] as f32;
    let v11 = buffer[idx11] as f32;

    (1.0 - s) * (1.0 - t) * v00
        + s * (1.0 - t) * v10
        + (1.0 - s) * t * v01
        + s * t * v11
}

/// Applies combined Brown-Conrady radial lens distortion and lateral chromatic dispersion in a single pass.
///
/// * `k1`: First radial distortion coefficient (-0.5 to 0.5; negative = barrel/fisheye, positive = pincushion).
/// * `k2`: Second radial distortion coefficient (higher order edge curvature).
/// * `ca_amount`: Lateral chromatic aberration magnitude (0.0 to 0.05).
/// * `ca_angle_deg`: Anamorphic prism directional offset angle in degrees.
pub fn apply_lens_optics(
    src: &[u8],
    dst: &mut [u8],
    width: u32,
    height: u32,
    k1: f32,
    k2: f32,
    ca_amount: f32,
    ca_angle_deg: f32,
) {
    if width == 0 || height == 0 {
        return;
    }

    let w_f = width as f32;
    let h_f = height as f32;
    let mid_x = w_f * 0.5;
    let mid_y = h_f * 0.5;
    let max_r = (mid_x * mid_x + mid_y * mid_y).sqrt();

    let ca_active = ca_amount.abs() > 0.0001;
    let dist_active = k1.abs() > 0.0001 || k2.abs() > 0.0001;

    // If both are inert, perform direct buffer copy
    if !ca_active && !dist_active {
        dst.copy_from_slice(src);
        return;
    }

    let ca_rad = ca_angle_deg.to_radians();
    let ca_dir_x = ca_rad.cos() * ca_amount * max_r * 0.25;
    let ca_dir_y = ca_rad.sin() * ca_amount * max_r * 0.25;

    for y in 0..height {
        let y_diff = y as f32 - mid_y;
        let y_norm = y_diff / max_r;

        for x in 0..width {
            let x_diff = x as f32 - mid_x;
            let x_norm = x_diff / max_r;

            let r_sq = x_norm * x_norm + y_norm * y_norm;
            let r_quad = r_sq * r_sq;

            // Brown-Conrady radial distortion factor: 1 + k1*r^2 + k2*r^4
            let radial_dist = if dist_active {
                1.0 + k1 * r_sq + k2 * r_quad
            } else {
                1.0
            };

            // Base distorted source coordinate
            let src_x_base = mid_x + x_diff * radial_dist;
            let src_y_base = mid_y + y_diff * radial_dist;

            let dst_idx = ((y * width + x) as usize) * 4;

            if ca_active {
                // Wavelength dispersion: Red expands, Blue compresses relative to optical center
                let r_scale = 1.0 + ca_amount * r_sq;
                let b_scale = 1.0 - ca_amount * r_sq;

                let src_r_x = mid_x + (src_x_base - mid_x) * r_scale + ca_dir_x;
                let src_r_y = mid_y + (src_y_base - mid_y) * r_scale + ca_dir_y;

                let src_g_x = src_x_base;
                let src_g_y = src_y_base;

                let src_b_x = mid_x + (src_x_base - mid_x) * b_scale - ca_dir_x;
                let src_b_y = mid_y + (src_y_base - mid_y) * b_scale - ca_dir_y;

                let r_sample = sample_bilinear_channel(src, width, height, src_r_x, src_r_y, 0);
                let g_sample = sample_bilinear_channel(src, width, height, src_g_x, src_g_y, 1);
                let b_sample = sample_bilinear_channel(src, width, height, src_b_x, src_b_y, 2);

                dst[dst_idx] = r_sample.clamp(0.0, 255.0) as u8;
                dst[dst_idx + 1] = g_sample.clamp(0.0, 255.0) as u8;
                dst[dst_idx + 2] = b_sample.clamp(0.0, 255.0) as u8;
                dst[dst_idx + 3] = src[dst_idx + 3];
            } else {
                // Radial geometric distortion only (all RGB channels sample identical coordinates)
                let r_sample = sample_bilinear_channel(src, width, height, src_x_base, src_y_base, 0);
                let g_sample = sample_bilinear_channel(src, width, height, src_x_base, src_y_base, 1);
                let b_sample = sample_bilinear_channel(src, width, height, src_x_base, src_y_base, 2);

                dst[dst_idx] = r_sample.clamp(0.0, 255.0) as u8;
                dst[dst_idx + 1] = g_sample.clamp(0.0, 255.0) as u8;
                dst[dst_idx + 2] = b_sample.clamp(0.0, 255.0) as u8;
                dst[dst_idx + 3] = src[dst_idx + 3];
            }
        }
    }
}

/// In-place wrapper applying lens distortion and chromatic aberration to a mutable buffer.
pub fn apply_lens_optics_in_place(
    buffer: &mut [u8],
    width: u32,
    height: u32,
    k1: f32,
    k2: f32,
    ca_amount: f32,
    ca_angle_deg: f32,
) {
    if k1.abs() <= 0.0001 && k2.abs() <= 0.0001 && ca_amount.abs() <= 0.0001 {
        return;
    }
    let src = buffer.to_vec();
    apply_lens_optics(&src, buffer, width, height, k1, k2, ca_amount, ca_angle_deg);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero_distortion_identity() {
        let width = 16u32;
        let height = 16u32;
        let size = (width * height * 4) as usize;
        let mut original = vec![0u8; size];
        for i in 0..size {
            original[i] = (i % 256) as u8;
        }

        let mut output = vec![0u8; size];
        apply_lens_optics(&original, &mut output, width, height, 0.0, 0.0, 0.0, 0.0);

        assert_eq!(original, output);
    }

    #[test]
    fn test_barrel_distortion_bounds() {
        let width = 32u32;
        let height = 32u32;
        let size = (width * height * 4) as usize;
        let original = vec![128u8; size];
        let mut output = vec![0u8; size];

        // Barrel distortion: k1 = -0.2
        apply_lens_optics(&original, &mut output, width, height, -0.2, 0.0, 0.02, 45.0);

        for chunk in output.chunks_exact(4) {
            assert!(chunk[0] > 0);
            assert!(chunk[1] > 0);
            assert!(chunk[2] > 0);
        }
    }
}
