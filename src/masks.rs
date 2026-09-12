//! Selective adjustment 8-bit alpha mask buffer and radial brush stamp algorithms.

/// Draws a single circular brush stamp with cosine smoothstep feathering falloff onto the 8-bit mask buffer.
pub fn draw_brush_point(
    mask: &mut [u8],
    width: u32,
    height: u32,
    cx: f32,
    cy: f32,
    radius: f32,
    feather: f32,
    opacity: f32,
    erase: bool,
) {
    if radius <= 0.0 || opacity <= 0.0 {
        return;
    }

    let r_int = radius.ceil() as i32;
    let min_x = (cx.floor() as i32 - r_int).max(0).min(width as i32 - 1) as u32;
    let max_x = (cx.ceil() as i32 + r_int).max(0).min(width as i32 - 1) as u32;
    let min_y = (cy.floor() as i32 - r_int).max(0).min(height as i32 - 1) as u32;
    let max_y = (cy.ceil() as i32 + r_int).max(0).min(height as i32 - 1) as u32;

    let feather_clamped = feather.clamp(0.01, 0.99);
    let inner_radius = radius * (1.0 - feather_clamped);
    let feather_range = radius - inner_radius;

    for y in min_y..=max_y {
        let dy = y as f32 - cy;
        let dy_sq = dy * dy;

        for x in min_x..=max_x {
            let dx = x as f32 - cx;
            let dist = (dx * dx + dy_sq).sqrt();

            if dist <= radius {
                let falloff = if dist <= inner_radius {
                    1.0
                } else {
                    let t = (dist - inner_radius) / feather_range;
                    // Cosine smoothstep bell curve
                    (1.0 + (std::f32::consts::PI * t).cos()) * 0.5
                };

                let delta = ((255.0 * opacity * falloff).round() as i32).clamp(1, 255) as u8;
                let idx = (y * width + x) as usize;

                if erase {
                    mask[idx] = mask[idx].saturating_sub(delta);
                } else {
                    mask[idx] = mask[idx].saturating_add(delta);
                }
            }
        }
    }
}

/// Draws an interpolated stroke line between (x0, y0) and (x1, y1) to prevent gaps during fast cursor sweeps.
pub fn draw_brush_line(
    mask: &mut [u8],
    width: u32,
    height: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    radius: f32,
    feather: f32,
    opacity: f32,
    erase: bool,
) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let dist = (dx * dx + dy * dy).sqrt();

    // Spacing between stamps: 25% of radius
    let step_size = (radius * 0.25).max(1.0);
    let steps = (dist / step_size).ceil() as usize;

    if steps <= 1 {
        draw_brush_point(mask, width, height, x1, y1, radius, feather, opacity, erase);
        return;
    }

    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let x = x0 + dx * t;
        let y = y0 + dy * t;
        draw_brush_point(mask, width, height, x, y, radius, feather, opacity, erase);
    }
}

/// Inverts the mask (255 - val).
pub fn invert_mask(mask: &mut [u8]) {
    for val in mask.iter_mut() {
        *val = 255 - *val;
    }
}

/// Clears the mask buffer to zero (no mask active).
pub fn clear_mask(mask: &mut [u8]) {
    mask.fill(0);
}

/// Fills the mask buffer with a constant value.
pub fn fill_mask(mask: &mut [u8], val: u8) {
    mask.fill(val);
}

/// Blends filtered working pixels with original base pixels using the 8-bit alpha mask:
/// Result = (Mask * Filtered + (255 - Mask) * Base) / 255
pub fn composite_with_mask(current: &mut [u8], base: &[u8], mask: &[u8]) {
    for (chunk_curr, (chunk_base, &m)) in current
        .chunks_exact_mut(4)
        .zip(base.chunks_exact(4).zip(mask.iter()))
    {
        if m == 255 {
            // 100% filtered
            continue;
        } else if m == 0 {
            // 0% filtered -> keep original base pixel
            chunk_curr[0] = chunk_base[0];
            chunk_curr[1] = chunk_base[1];
            chunk_curr[2] = chunk_base[2];
        } else {
            let m_u32 = m as u32;
            let inv_m = 255 - m_u32;

            chunk_curr[0] = ((m_u32 * chunk_curr[0] as u32 + inv_m * chunk_base[0] as u32 + 127) / 255) as u8;
            chunk_curr[1] = ((m_u32 * chunk_curr[1] as u32 + inv_m * chunk_base[1] as u32 + 127) / 255) as u8;
            chunk_curr[2] = ((m_u32 * chunk_curr[2] as u32 + inv_m * chunk_base[2] as u32 + 127) / 255) as u8;
        }
    }
}
