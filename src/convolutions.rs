//! 2D Spatial Convolutions & Kernel Filters (Gaussian Blur, Sobel, Sharpen, Emboss).

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

/// Applies a generic 3x3 convolution matrix to an RGBA pixel buffer.
/// `src` is the input immutable buffer, `dst` is the output mutable buffer.
pub fn apply_kernel_3x3(
    src: &[u8],
    dst: &mut [u8],
    width: u32,
    height: u32,
    kernel: &[f32; 9],
    factor: f32,
    bias: f32,
) {
    let w = width as i32;
    let h = height as i32;

    for y in 0..h {
        for x in 0..w {
            let mut r_acc = 0.0f32;
            let mut g_acc = 0.0f32;
            let mut b_acc = 0.0f32;

            let mut k_idx = 0;
            for ky in -1..=1 {
                let py = (y + ky).clamp(0, h - 1);
                for kx in -1..=1 {
                    let px = (x + kx).clamp(0, w - 1);
                    let idx = ((py * w + px) * 4) as usize;
                    let weight = kernel[k_idx];

                    r_acc += src[idx] as f32 * weight;
                    g_acc += src[idx + 1] as f32 * weight;
                    b_acc += src[idx + 2] as f32 * weight;

                    k_idx += 1;
                }
            }

            let out_idx = ((y * w + x) * 4) as usize;
            dst[out_idx] = clamp_u8(r_acc * factor + bias);
            dst[out_idx + 1] = clamp_u8(g_acc * factor + bias);
            dst[out_idx + 2] = clamp_u8(b_acc * factor + bias);
            dst[out_idx + 3] = src[out_idx + 3]; // Preserve original Alpha
        }
    }
}

/// Applies Sharpening convolution.
pub fn apply_sharpen(src: &[u8], dst: &mut [u8], width: u32, height: u32, intensity: f32) {
    let center = 1.0 + 4.0 * intensity;
    let edge = -intensity;
    let kernel = [
        0.0, edge, 0.0,
        edge, center, edge,
        0.0, edge, 0.0,
    ];
    apply_kernel_3x3(src, dst, width, height, &kernel, 1.0, 0.0);
}

/// Applies Emboss filter.
pub fn apply_emboss(src: &[u8], dst: &mut [u8], width: u32, height: u32) {
    let kernel = [
        -2.0, -1.0,  0.0,
        -1.0,  1.0,  1.0,
         0.0,  1.0,  2.0,
    ];
    apply_kernel_3x3(src, dst, width, height, &kernel, 1.0, 0.0);
}

/// High-performance Separable Gaussian Blur (Horizontal Pass then Vertical Pass).
pub fn apply_gaussian_blur(buffer: &mut [u8], width: u32, height: u32, sigma: f32) {
    if sigma <= 0.1 {
        return;
    }

    let radius = (sigma * 3.0).ceil() as i32;
    let kernel_size = (2 * radius + 1) as usize;
    let mut kernel = vec![0.0f32; kernel_size];

    let two_sigma_sq = 2.0 * sigma * sigma;
    let mut sum = 0.0f32;

    for i in 0..kernel_size {
        let x = (i as i32 - radius) as f32;
        let g = (-x * x / two_sigma_sq).exp();
        kernel[i] = g;
        sum += g;
    }

    for val in kernel.iter_mut() {
        *val /= sum;
    }

    let w = width as i32;
    let h = height as i32;
    let mut temp = buffer.to_vec();

    // 1. Horizontal 1D Pass (buffer -> temp)
    for y in 0..h {
        for x in 0..w {
            let mut r = 0.0;
            let mut g = 0.0;
            let mut b = 0.0;
            let mut a = 0.0;

            for k in -radius..=radius {
                let px = (x + k).clamp(0, w - 1);
                let idx = ((y * w + px) * 4) as usize;
                let weight = kernel[(k + radius) as usize];

                r += buffer[idx] as f32 * weight;
                g += buffer[idx + 1] as f32 * weight;
                b += buffer[idx + 2] as f32 * weight;
                a += buffer[idx + 3] as f32 * weight;
            }

            let out_idx = ((y * w + x) * 4) as usize;
            temp[out_idx] = clamp_u8(r);
            temp[out_idx + 1] = clamp_u8(g);
            temp[out_idx + 2] = clamp_u8(b);
            temp[out_idx + 3] = clamp_u8(a);
        }
    }

    // 2. Vertical 1D Pass (temp -> buffer)
    for y in 0..h {
        for x in 0..w {
            let mut r = 0.0;
            let mut g = 0.0;
            let mut b = 0.0;
            let mut a = 0.0;

            for k in -radius..=radius {
                let py = (y + k).clamp(0, h - 1);
                let idx = ((py * w + x) * 4) as usize;
                let weight = kernel[(k + radius) as usize];

                r += temp[idx] as f32 * weight;
                g += temp[idx + 1] as f32 * weight;
                b += temp[idx + 2] as f32 * weight;
                a += temp[idx + 3] as f32 * weight;
            }

            let out_idx = ((y * w + x) * 4) as usize;
            buffer[out_idx] = clamp_u8(r);
            buffer[out_idx + 1] = clamp_u8(g);
            buffer[out_idx + 2] = clamp_u8(b);
            buffer[out_idx + 3] = clamp_u8(a);
        }
    }
}

/// Applies Sobel edge detection computing gradient magnitude G = sqrt(Gx^2 + Gy^2).
pub fn apply_sobel(src: &[u8], dst: &mut [u8], width: u32, height: u32) {
    let gx = [
        -1.0, 0.0, 1.0,
        -2.0, 0.0, 2.0,
        -1.0, 0.0, 1.0,
    ];
    let gy = [
        -1.0, -2.0, -1.0,
         0.0,  0.0,  0.0,
         1.0,  2.0,  1.0,
    ];

    let w = width as i32;
    let h = height as i32;

    for y in 0..h {
        for x in 0..w {
            let mut r_gx = 0.0; let mut r_gy = 0.0;
            let mut g_gx = 0.0; let mut g_gy = 0.0;
            let mut b_gx = 0.0; let mut b_gy = 0.0;

            let mut k_idx = 0;
            for ky in -1..=1 {
                let py = (y + ky).clamp(0, h - 1);
                for kx in -1..=1 {
                    let px = (x + kx).clamp(0, w - 1);
                    let idx = ((py * w + px) * 4) as usize;

                    let r = src[idx] as f32;
                    let g = src[idx + 1] as f32;
                    let b = src[idx + 2] as f32;

                    let kx_w = gx[k_idx];
                    let ky_w = gy[k_idx];

                    r_gx += r * kx_w; r_gy += r * ky_w;
                    g_gx += g * kx_w; g_gy += g * ky_w;
                    b_gx += b * kx_w; b_gy += b * ky_w;

                    k_idx += 1;
                }
            }

            let r_mag = (r_gx * r_gx + r_gy * r_gy).sqrt();
            let g_mag = (g_gx * g_gx + g_gy * g_gy).sqrt();
            let b_mag = (b_gx * b_gx + b_gy * b_gy).sqrt();
            let edge = (0.299 * r_mag + 0.587 * g_mag + 0.114 * b_mag).min(255.0) as u8;

            let out_idx = ((y * w + x) * 4) as usize;
            dst[out_idx] = edge;
            dst[out_idx + 1] = edge;
            dst[out_idx + 2] = edge;
            dst[out_idx + 3] = 255;
        }
    }
}
