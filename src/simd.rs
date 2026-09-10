//! WebAssembly SIMD128 Vectorized Image Processing Kernels.
//!
//! Processes 16 color subpixel bytes (4 full RGBA pixels) in parallel
//! using 128-bit vector registers (`core::arch::wasm32::*`).

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
use core::arch::wasm32::*;

/// Checks whether SIMD128 instructions are active at compile-time.
pub fn is_simd_supported() -> bool {
    cfg!(all(target_arch = "wasm32", target_feature = "simd128"))
}

/// Vectorized Brightness Adjustment (Processes 4 pixels / 16 bytes per instruction).
pub fn simd_apply_brightness(buffer: &mut [u8], value: f32) {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        let int_val = value.round() as i32;
        if int_val == 0 {
            return;
        }

        let abs_val = int_val.abs().min(255) as u8;
        // Construct mask to apply delta only to R, G, B channels and 0 to Alpha
        let delta_vec = u8x16(
            abs_val, abs_val, abs_val, 0,
            abs_val, abs_val, abs_val, 0,
            abs_val, abs_val, abs_val, 0,
            abs_val, abs_val, abs_val, 0,
        );

        let mut chunks = buffer.chunks_exact_mut(16);
        if int_val > 0 {
            for chunk in chunks.by_ref() {
                let v = v128_load(chunk.as_ptr() as *const v128);
                let res = u8x16_add_sat(v, delta_vec);
                v128_store(chunk.as_mut_ptr() as *mut v128, res);
            }
        } else {
            for chunk in chunks.by_ref() {
                let v = v128_load(chunk.as_ptr() as *const v128);
                let res = u8x16_sub_sat(v, delta_vec);
                v128_store(chunk.as_mut_ptr() as *mut v128, res);
            }
        }

        // Remainder scalar pass
        let remainder = chunks.into_remainder();
        for chunk in remainder.chunks_exact_mut(4) {
            chunk[0] = (chunk[0] as i32 + int_val).clamp(0, 255) as u8;
            chunk[1] = (chunk[1] as i32 + int_val).clamp(0, 255) as u8;
            chunk[2] = (chunk[2] as i32 + int_val).clamp(0, 255) as u8;
        }
    }

    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        for chunk in buffer.chunks_exact_mut(4) {
            chunk[0] = (chunk[0] as f32 + value).clamp(0.0, 255.0) as u8;
            chunk[1] = (chunk[1] as f32 + value).clamp(0.0, 255.0) as u8;
            chunk[2] = (chunk[2] as f32 + value).clamp(0.0, 255.0) as u8;
        }
    }
}

/// Vectorized Inversion (XOR with 0xFF on RGB channels, preserving Alpha).
pub fn simd_apply_invert(buffer: &mut [u8]) {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        let invert_mask = u8x16(
            0xFF, 0xFF, 0xFF, 0x00,
            0xFF, 0xFF, 0xFF, 0x00,
            0xFF, 0xFF, 0xFF, 0x00,
            0xFF, 0xFF, 0xFF, 0x00,
        );

        let mut chunks = buffer.chunks_exact_mut(16);
        for chunk in chunks.by_ref() {
            let v = v128_load(chunk.as_ptr() as *const v128);
            let res = v128_xor(v, invert_mask);
            v128_store(chunk.as_mut_ptr() as *mut v128, res);
        }

        let remainder = chunks.into_remainder();
        for chunk in remainder.chunks_exact_mut(4) {
            chunk[0] = 255 - chunk[0];
            chunk[1] = 255 - chunk[1];
            chunk[2] = 255 - chunk[2];
        }
    }

    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        for chunk in buffer.chunks_exact_mut(4) {
            chunk[0] = 255 - chunk[0];
            chunk[1] = 255 - chunk[1];
            chunk[2] = 255 - chunk[2];
        }
    }
}

/// Vectorized Grayscale (Uses fixed-point integer weighting: (77*R + 150*G + 29*B) >> 8).
pub fn simd_apply_grayscale(buffer: &mut [u8]) {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        let mut chunks = buffer.chunks_exact_mut(16);
        for chunk in chunks.by_ref() {
            let v = v128_load(chunk.as_ptr() as *const v128);

            // Extend 16x u8 to 8x i16 for 2 pixels each pass
            let low = i16x8_extend_low_u8x16(v);
            let high = i16x8_extend_high_u8x16(v);

            // Pixel 0 & Pixel 1 (low)
            let r0 = i16x8_extract_lane::<0>(low) as i32;
            let g0 = i16x8_extract_lane::<1>(low) as i32;
            let b0 = i16x8_extract_lane::<2>(low) as i32;
            let lum0 = ((r0 * 77 + g0 * 150 + b0 * 29) >> 8) as u8;

            let r1 = i16x8_extract_lane::<4>(low) as i32;
            let g1 = i16x8_extract_lane::<5>(low) as i32;
            let b1 = i16x8_extract_lane::<6>(low) as i32;
            let lum1 = ((r1 * 77 + g1 * 150 + b1 * 29) >> 8) as u8;

            // Pixel 2 & Pixel 3 (high)
            let r2 = i16x8_extract_lane::<0>(high) as i32;
            let g2 = i16x8_extract_lane::<1>(high) as i32;
            let b2 = i16x8_extract_lane::<2>(high) as i32;
            let lum2 = ((r2 * 77 + g2 * 150 + b2 * 29) >> 8) as u8;

            let r3 = i16x8_extract_lane::<4>(high) as i32;
            let g3 = i16x8_extract_lane::<5>(high) as i32;
            let b3 = i16x8_extract_lane::<6>(high) as i32;
            let lum3 = ((r3 * 77 + g3 * 150 + b3 * 29) >> 8) as u8;

            let gray_vec = u8x16(
                lum0, lum0, lum0, chunk[3],
                lum1, lum1, lum1, chunk[7],
                lum2, lum2, lum2, chunk[11],
                lum3, lum3, lum3, chunk[15],
            );
            v128_store(chunk.as_mut_ptr() as *mut v128, gray_vec);
        }

        let remainder = chunks.into_remainder();
        for chunk in remainder.chunks_exact_mut(4) {
            let gray = ((chunk[0] as i32 * 77 + chunk[1] as i32 * 150 + chunk[2] as i32 * 29) >> 8) as u8;
            chunk[0] = gray;
            chunk[1] = gray;
            chunk[2] = gray;
        }
    }

    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        for chunk in buffer.chunks_exact_mut(4) {
            let gray = (0.299 * chunk[0] as f32 + 0.587 * chunk[1] as f32 + 0.114 * chunk[2] as f32) as u8;
            chunk[0] = gray;
            chunk[1] = gray;
            chunk[2] = gray;
        }
    }
}

/// Vectorized Unsharp Masking (Calculates orig + amount * (orig - blur)).
pub fn simd_unsharp_mask(buffer: &mut [u8], blurred: &[u8], amount: f32, threshold: u8) {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        let thresh = threshold as i32;
        let mut chunks_buf = buffer.chunks_exact_mut(16);
        let mut chunks_blur = blurred.chunks_exact(16);

        for (chunk_b, chunk_bl) in chunks_buf.by_ref().zip(chunks_blur.by_ref()) {
            let v_orig = v128_load(chunk_b.as_ptr() as *const v128);
            let v_blur = v128_load(chunk_bl.as_ptr() as *const v128);

            // Split into 8-lane 16-bit vectors to allow signed arithmetic
            let orig_low = i16x8_extend_low_u8x16(v_orig);
            let blur_low = i16x8_extend_low_u8x16(v_blur);
            let diff_low = i16x8_sub(orig_low, blur_low);

            let orig_high = i16x8_extend_high_u8x16(v_orig);
            let blur_high = i16x8_extend_high_u8x16(v_blur);
            let diff_high = i16x8_sub(orig_high, blur_high);

            // Apply sharpening formula per channel
            for lane in 0..8 {
                // Skip lane 3 and 7 (Alpha channels)
                if lane != 3 && lane != 7 {
                    let d = match lane {
                        0 => i16x8_extract_lane::<0>(diff_low),
                        1 => i16x8_extract_lane::<1>(diff_low),
                        2 => i16x8_extract_lane::<2>(diff_low),
                        4 => i16x8_extract_lane::<4>(diff_low),
                        5 => i16x8_extract_lane::<5>(diff_low),
                        6 => i16x8_extract_lane::<6>(diff_low),
                        _ => 0,
                    } as i32;

                    let orig_v = match lane {
                        0 => i16x8_extract_lane::<0>(orig_low),
                        1 => i16x8_extract_lane::<1>(orig_low),
                        2 => i16x8_extract_lane::<2>(orig_low),
                        4 => i16x8_extract_lane::<4>(orig_low),
                        5 => i16x8_extract_lane::<5>(orig_low),
                        6 => i16x8_extract_lane::<6>(orig_low),
                        _ => 0,
                    } as i32;

                    if d.abs() >= thresh {
                        let res = (orig_v as f32 + amount * d as f32).clamp(0.0, 255.0) as u8;
                        chunk_b[lane] = res;
                    }
                }
            }

            for lane in 0..8 {
                if lane != 3 && lane != 7 {
                    let d = match lane {
                        0 => i16x8_extract_lane::<0>(diff_high),
                        1 => i16x8_extract_lane::<1>(diff_high),
                        2 => i16x8_extract_lane::<2>(diff_high),
                        4 => i16x8_extract_lane::<4>(diff_high),
                        5 => i16x8_extract_lane::<5>(diff_high),
                        6 => i16x8_extract_lane::<6>(diff_high),
                        _ => 0,
                    } as i32;

                    let orig_v = match lane {
                        0 => i16x8_extract_lane::<0>(orig_high),
                        1 => i16x8_extract_lane::<1>(orig_high),
                        2 => i16x8_extract_lane::<2>(orig_high),
                        4 => i16x8_extract_lane::<4>(orig_high),
                        5 => i16x8_extract_lane::<5>(orig_high),
                        6 => i16x8_extract_lane::<6>(orig_high),
                        _ => 0,
                    } as i32;

                    if d.abs() >= thresh {
                        let res = (orig_v as f32 + amount * d as f32).clamp(0.0, 255.0) as u8;
                        chunk_b[8 + lane] = res;
                    }
                }
            }
        }
    }

    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        let thresh = threshold as i32;
        for (orig, blur) in buffer.chunks_exact_mut(4).zip(blurred.chunks_exact(4)) {
            for c in 0..3 {
                let diff = orig[c] as i32 - blur[c] as i32;
                if diff.abs() >= thresh {
                    orig[c] = (orig[c] as f32 + amount * diff as f32).clamp(0.0, 255.0) as u8;
                }
            }
        }
    }
}
