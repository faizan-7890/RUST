//! Pixel-wise color and tone transformation algorithms.

#[inline(always)]
fn clamp_u8(val: f32) -> u8 {
    if val < 0.0 {
        0
    } else if val > 255.0 {
        255
    } else {
        val as u8
    }
}

/// Converts RGBA pixels to grayscale using standard ITU-R BT.601 luminance coefficients.
pub fn apply_grayscale(buffer: &mut [u8]) {
    for chunk in buffer.chunks_exact_mut(4) {
        let r = chunk[0] as f32;
        let g = chunk[1] as f32;
        let b = chunk[2] as f32;
        let gray = clamp_u8(0.299 * r + 0.587 * g + 0.114 * b);
        chunk[0] = gray;
        chunk[1] = gray;
        chunk[2] = gray;
    }
}

/// Inverts color channels (255 - value), preserving alpha.
pub fn apply_invert(buffer: &mut [u8]) {
    for chunk in buffer.chunks_exact_mut(4) {
        chunk[0] = 255 - chunk[0];
        chunk[1] = 255 - chunk[1];
        chunk[2] = 255 - chunk[2];
    }
}

/// Applies a warm vintage sepia matrix transformation.
pub fn apply_sepia(buffer: &mut [u8]) {
    for chunk in buffer.chunks_exact_mut(4) {
        let r = chunk[0] as f32;
        let g = chunk[1] as f32;
        let b = chunk[2] as f32;

        let tr = 0.393 * r + 0.769 * g + 0.189 * b;
        let tg = 0.349 * r + 0.686 * g + 0.168 * b;
        let tb = 0.272 * r + 0.534 * g + 0.131 * b;

        chunk[0] = clamp_u8(tr);
        chunk[1] = clamp_u8(tg);
        chunk[2] = clamp_u8(tb);
    }
}

/// Adjusts brightness in the range [-255.0, 255.0].
pub fn apply_brightness(buffer: &mut [u8], value: f32) {
    if value == 0.0 {
        return;
    }
    for chunk in buffer.chunks_exact_mut(4) {
        chunk[0] = clamp_u8(chunk[0] as f32 + value);
        chunk[1] = clamp_u8(chunk[1] as f32 + value);
        chunk[2] = clamp_u8(chunk[2] as f32 + value);
    }
}

/// Adjusts contrast with factor around midpoint 128.0.
/// `contrast` range: [-100.0, 100.0]
pub fn apply_contrast(buffer: &mut [u8], contrast: f32) {
    if contrast == 0.0 {
        return;
    }
    let factor = (259.0 * (contrast + 255.0)) / (255.0 * (259.0 - contrast));
    for chunk in buffer.chunks_exact_mut(4) {
        chunk[0] = clamp_u8(factor * (chunk[0] as f32 - 128.0) + 128.0);
        chunk[1] = clamp_u8(factor * (chunk[1] as f32 - 128.0) + 128.0);
        chunk[2] = clamp_u8(factor * (chunk[2] as f32 - 128.0) + 128.0);
    }
}

/// Adjusts saturation. `saturation` = 1.0 is neutral, 0.0 is grayscale, > 1.0 is vivid.
pub fn apply_saturation(buffer: &mut [u8], saturation: f32) {
    if (saturation - 1.0).abs() < f32::EPSILON {
        return;
    }
    for chunk in buffer.chunks_exact_mut(4) {
        let r = chunk[0] as f32;
        let g = chunk[1] as f32;
        let b = chunk[2] as f32;
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;

        chunk[0] = clamp_u8(gray + (r - gray) * saturation);
        chunk[1] = clamp_u8(gray + (g - gray) * saturation);
        chunk[2] = clamp_u8(gray + (b - gray) * saturation);
    }
}

/// Rotates hue around the RGB color wheel by `angle_deg` degrees.
pub fn apply_hue_rotate(buffer: &mut [u8], angle_deg: f32) {
    let rad = angle_deg.to_radians();
    let cos_a = rad.cos();
    let sin_a = rad.sin();

    let mat = [
        0.213 + cos_a * 0.787 - sin_a * 0.213,
        0.715 - cos_a * 0.715 - sin_a * 0.715,
        0.072 - cos_a * 0.072 + sin_a * 0.928,

        0.213 - cos_a * 0.213 + sin_a * 0.143,
        0.715 + cos_a * 0.285 + sin_a * 0.140,
        0.072 - cos_a * 0.072 - sin_a * 0.283,

        0.213 - cos_a * 0.213 - sin_a * 0.787,
        0.715 - cos_a * 0.715 + sin_a * 0.715,
        0.072 + cos_a * 0.928 + sin_a * 0.072,
    ];

    for chunk in buffer.chunks_exact_mut(4) {
        let r = chunk[0] as f32;
        let g = chunk[1] as f32;
        let b = chunk[2] as f32;

        let nr = mat[0] * r + mat[1] * g + mat[2] * b;
        let ng = mat[3] * r + mat[4] * g + mat[5] * b;
        let nb = mat[6] * r + mat[7] * g + mat[8] * b;

        chunk[0] = clamp_u8(nr);
        chunk[1] = clamp_u8(ng);
        chunk[2] = clamp_u8(nb);
    }
}

/// Applies non-linear gamma correction using a 256-value Lookup Table (LUT).
pub fn apply_gamma(buffer: &mut [u8], gamma: f32) {
    if (gamma - 1.0).abs() < f32::EPSILON || gamma <= 0.0 {
        return;
    }
    let inv_gamma = 1.0 / gamma;
    let mut lut = [0u8; 256];
    for i in 0..256 {
        lut[i] = clamp_u8(255.0 * ((i as f32 / 255.0).powf(inv_gamma)));
    }

    for chunk in buffer.chunks_exact_mut(4) {
        chunk[0] = lut[chunk[0] as usize];
        chunk[1] = lut[chunk[1] as usize];
        chunk[2] = lut[chunk[2] as usize];
    }
}

/// Threshold binarization: turns pixels to white or black based on luminance cutoff.
pub fn apply_threshold(buffer: &mut [u8], threshold: u8) {
    for chunk in buffer.chunks_exact_mut(4) {
        let lum = (0.299 * chunk[0] as f32 + 0.587 * chunk[1] as f32 + 0.114 * chunk[2] as f32) as u8;
        let val = if lum >= threshold { 255 } else { 0 };
        chunk[0] = val;
        chunk[1] = val;
        chunk[2] = val;
    }
}

/// Posterizes the image into discrete tonal bands.
pub fn apply_posterize(buffer: &mut [u8], levels: u8) {
    let levels = levels.max(2) as f32;
    let step = 255.0 / (levels - 1.0);
    for chunk in buffer.chunks_exact_mut(4) {
        chunk[0] = clamp_u8(((chunk[0] as f32 / step).round()) * step);
        chunk[1] = clamp_u8(((chunk[1] as f32 / step).round()) * step);
        chunk[2] = clamp_u8(((chunk[2] as f32 / step).round()) * step);
    }
}

/// Solarization effect (inverts tones above a threshold).
pub fn apply_solarize(buffer: &mut [u8], threshold: u8) {
    for chunk in buffer.chunks_exact_mut(4) {
        if chunk[0] > threshold {
            chunk[0] = 255 - chunk[0];
        }
        if chunk[1] > threshold {
            chunk[1] = 255 - chunk[1];
        }
        if chunk[2] > threshold {
            chunk[2] = 255 - chunk[2];
        }
    }
}

/// Applies a photographic vignette darkening towards the perimeter.
pub fn apply_vignette(buffer: &mut [u8], width: u32, height: u32, radius: f32, intensity: f32) {
    let cx = width as f32 / 2.0;
    let cy = height as f32 / 2.0;
    let max_dist = (cx * cx + cy * cy).sqrt() * radius.max(0.1);

    for y in 0..height {
        let dy = y as f32 - cy;
        for x in 0..width {
            let dx = x as f32 - cx;
            let dist = (dx * dx + dy * dy).sqrt();
            let factor = (1.0 - (dist / max_dist).powf(2.0) * intensity).clamp(0.0, 1.0);

            let idx = ((y * width + x) * 4) as usize;
            buffer[idx] = clamp_u8(buffer[idx] as f32 * factor);
            buffer[idx + 1] = clamp_u8(buffer[idx + 1] as f32 * factor);
            buffer[idx + 2] = clamp_u8(buffer[idx + 2] as f32 * factor);
        }
    }
}

/// Adjusts individual color balance channels.
pub fn apply_color_balance(buffer: &mut [u8], r_shift: f32, g_shift: f32, b_shift: f32) {
    for chunk in buffer.chunks_exact_mut(4) {
        chunk[0] = clamp_u8(chunk[0] as f32 + r_shift);
        chunk[1] = clamp_u8(chunk[1] as f32 + g_shift);
        chunk[2] = clamp_u8(chunk[2] as f32 + b_shift);
    }
}

/// Calculates a 4x256 histogram (Red, Green, Blue, Luminance channels).
pub fn compute_histogram(buffer: &[u8]) -> Vec<u32> {
    let mut bins = vec![0u32; 1024];

    for chunk in buffer.chunks_exact(4) {
        let r = chunk[0] as usize;
        let g = chunk[1] as usize;
        let b = chunk[2] as usize;
        let luma = (0.299 * chunk[0] as f32 + 0.587 * chunk[1] as f32 + 0.114 * chunk[2] as f32) as usize;

        bins[r] += 1;
        bins[256 + g] += 1;
        bins[512 + b] += 1;
        bins[768 + luma.min(255)] += 1;
    }

    bins
}
