//! Geometric transformations: Flipping, Rotations.

/// Flips an RGBA image horizontally in-place.
pub fn flip_horizontal(buffer: &mut [u8], width: u32, height: u32) {
    let w = width as usize;
    let h = height as usize;

    for y in 0..h {
        let row_start = y * w * 4;
        for x in 0..(w / 2) {
            let left_idx = row_start + x * 4;
            let right_idx = row_start + (w - 1 - x) * 4;

            for i in 0..4 {
                buffer.swap(left_idx + i, right_idx + i);
            }
        }
    }
}

/// Flips an RGBA image vertically in-place.
pub fn flip_vertical(buffer: &mut [u8], width: u32, height: u32) {
    let w = width as usize;
    let h = height as usize;
    let row_bytes = w * 4;

    for y in 0..(h / 2) {
        let top_row_start = y * row_bytes;
        let bottom_row_start = (h - 1 - y) * row_bytes;

        for x in 0..row_bytes {
            buffer.swap(top_row_start + x, bottom_row_start + x);
        }
    }
}

/// Rotates image 90 degrees clockwise.
/// Note: Output image dimensions are (height, width).
pub fn rotate_90_cw(src: &[u8], dst: &mut [u8], width: u32, height: u32) {
    let w = width as usize;
    let h = height as usize;

    for y in 0..h {
        for x in 0..w {
            let src_idx = (y * w + x) * 4;
            // In rotated image: new_x = h - 1 - y, new_y = x, new_width = h
            let dst_idx = (x * h + (h - 1 - y)) * 4;

            dst[dst_idx..dst_idx + 4].copy_from_slice(&src[src_idx..src_idx + 4]);
        }
    }
}

/// Rotates image 180 degrees in-place.
pub fn rotate_180(buffer: &mut [u8]) {
    buffer.reverse();
    // buffer.reverse() reverses byte order [A, B, G, R] instead of RGBA pixels,
    // so we re-swap back each 4-byte chunk
    for chunk in buffer.chunks_exact_mut(4) {
        chunk.swap(0, 3);
        chunk.swap(1, 2);
    }
}

/// Rotates image 270 degrees clockwise (90 deg counter-clockwise).
/// Note: Output image dimensions are (height, width).
pub fn rotate_270_cw(src: &[u8], dst: &mut [u8], width: u32, height: u32) {
    let w = width as usize;
    let h = height as usize;

    for y in 0..h {
        for x in 0..w {
            let src_idx = (y * w + x) * 4;
            // In rotated image: new_x = y, new_y = w - 1 - x, new_width = h
            let dst_idx = ((w - 1 - x) * h + y) * 4;

            dst[dst_idx..dst_idx + 4].copy_from_slice(&src[src_idx..src_idx + 4]);
        }
    }
}
