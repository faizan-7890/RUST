//! 3D Look-Up Table (LUT) parser and real-time Trilinear Interpolation engine.
//!
//! Supports standard Adobe / DaVinci Resolve `.cube` ASCII files and procedural film emulations.

pub struct Lut3D {
    pub title: String,
    pub size: usize,
    pub data: Vec<f32>, // Flat array of [r, g, b] * size^3
}

impl Lut3D {
    pub fn new(size: usize, title: String) -> Self {
        let total = size * size * size * 3;
        Self {
            title,
            size,
            data: vec![0.0f32; total],
        }
    }

    /// Parses an industry-standard ASCII `.cube` file.
    pub fn parse_cube(content: &str) -> Result<Self, String> {
        let mut size = 0usize;
        let mut title = String::from("Custom LUT");
        let mut table_data: Vec<f32> = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            if trimmed.starts_with("LUT_3D_SIZE") {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 2 {
                    size = parts[1].parse::<usize>().map_err(|e| e.to_string())?;
                }
            } else if trimmed.starts_with("TITLE") {
                title = trimmed
                    .trim_start_matches("TITLE")
                    .trim()
                    .trim_matches('"')
                    .to_string();
            } else if trimmed.starts_with("DOMAIN_MIN") || trimmed.starts_with("DOMAIN_MAX") {
                continue;
            } else {
                // Parse float triplet: "r g b"
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 3 {
                    if let (Ok(r), Ok(g), Ok(b)) = (
                        parts[0].parse::<f32>(),
                        parts[1].parse::<f32>(),
                        parts[2].parse::<f32>(),
                    ) {
                        table_data.push(r);
                        table_data.push(g);
                        table_data.push(b);
                    }
                }
            }
        }

        if size == 0 {
            return Err("Missing or invalid LUT_3D_SIZE".to_string());
        }

        let expected_floats = size * size * size * 3;
        if table_data.len() < expected_floats {
            return Err(format!(
                "Incomplete LUT data: expected {} values, found {}",
                expected_floats,
                table_data.len()
            ));
        }

        table_data.truncate(expected_floats);

        Ok(Self {
            title,
            size,
            data: table_data,
        })
    }

    /// High-throughput Trilinear 3D Interpolation.
    /// Maps input color (r, g, b) in [0.0, 1.0] to interpolated output color.
    #[inline(always)]
    pub fn sample_trilinear(&self, r: f32, g: f32, b: f32) -> (f32, f32, f32) {
        let n = self.size;
        let n_sub_1 = (n - 1) as f32;

        let x = (r.clamp(0.0, 1.0) * n_sub_1).min(n_sub_1);
        let y = (g.clamp(0.0, 1.0) * n_sub_1).min(n_sub_1);
        let z = (b.clamp(0.0, 1.0) * n_sub_1).min(n_sub_1);

        let x0 = x.floor() as usize;
        let y0 = y.floor() as usize;
        let z0 = z.floor() as usize;

        let x1 = (x0 + 1).min(n - 1);
        let y1 = (y0 + 1).min(n - 1);
        let z1 = (z0 + 1).min(n - 1);

        let u = x - x0 as f32;
        let v = y - y0 as f32;
        let w = z - z0 as f32;

        let inv_u = 1.0 - u;
        let inv_v = 1.0 - v;
        let inv_w = 1.0 - w;

        // Flat indexing: (z * N * N + y * N + x) * 3
        let n_sq = n * n;
        let get_rgb = |xi: usize, yi: usize, zi: usize| -> (f32, f32, f32) {
            let idx = (zi * n_sq + yi * n + xi) * 3;
            (self.data[idx], self.data[idx + 1], self.data[idx + 2])
        };

        let c000 = get_rgb(x0, y0, z0);
        let c100 = get_rgb(x1, y0, z0);
        let c010 = get_rgb(x0, y1, z0);
        let c110 = get_rgb(x1, y1, z0);
        let c001 = get_rgb(x0, y0, z1);
        let c101 = get_rgb(x1, y0, z1);
        let c011 = get_rgb(x0, y1, z1);
        let c111 = get_rgb(x1, y1, z1);

        let w000 = inv_u * inv_v * inv_w;
        let w100 = u * inv_v * inv_w;
        let w010 = inv_u * v * inv_w;
        let w110 = u * v * inv_w;
        let w001 = inv_u * inv_v * w;
        let w101 = u * inv_v * w;
        let w011 = inv_u * v * w;
        let w111 = u * v * w;

        let out_r = c000.0 * w000 + c100.0 * w100 + c010.0 * w010 + c110.0 * w110
            + c001.0 * w001 + c101.0 * w101 + c011.0 * w011 + c111.0 * w111;

        let out_g = c000.1 * w000 + c100.1 * w100 + c010.1 * w010 + c110.1 * w110
            + c001.1 * w001 + c101.1 * w101 + c011.1 * w011 + c111.1 * w111;

        let out_b = c000.2 * w000 + c100.2 * w100 + c010.2 * w010 + c110.2 * w110
            + c001.2 * w001 + c101.2 * w101 + c011.2 * w011 + c111.2 * w111;

        (out_r, out_g, out_b)
    }

    /// Procedural Preset: Teal & Orange Blockbuster Grade
    pub fn preset_teal_orange() -> Self {
        let size = 17;
        let mut lut = Self::new(size, "Teal & Orange".to_string());
        for z in 0..size {
            let b_in = z as f32 / (size - 1) as f32;
            for y in 0..size {
                let g_in = y as f32 / (size - 1) as f32;
                for x in 0..size {
                    let r_in = x as f32 / (size - 1) as f32;

                    let lum = 0.299 * r_in + 0.587 * g_in + 0.114 * b_in;
                    // Shadows pushed to teal (cyan-blue), highlights to orange
                    let shadow_weight = (1.0 - lum).powf(1.4);
                    let highlight_weight = lum.powf(1.2);

                    let r_out = (r_in + 0.25 * highlight_weight - 0.05 * shadow_weight).clamp(0.0, 1.0);
                    let g_out = (g_in + 0.08 * highlight_weight + 0.05 * shadow_weight).clamp(0.0, 1.0);
                    let b_out = (b_in - 0.15 * highlight_weight + 0.25 * shadow_weight).clamp(0.0, 1.0);

                    let idx = (z * size * size + y * size + x) * 3;
                    lut.data[idx] = r_out;
                    lut.data[idx + 1] = g_out;
                    lut.data[idx + 2] = b_out;
                }
            }
        }
        lut
    }

    /// Procedural Preset: Kodak Portra 400 Vintage Film Emulation
    pub fn preset_kodak_portra() -> Self {
        let size = 17;
        let mut lut = Self::new(size, "Kodak Portra 400".to_string());
        for z in 0..size {
            let b_in = z as f32 / (size - 1) as f32;
            for y in 0..size {
                let g_in = y as f32 / (size - 1) as f32;
                for x in 0..size {
                    let r_in = x as f32 / (size - 1) as f32;

                    // Lifted shadows, warm golden midtones, slightly compressed highlights
                    let r_out = (r_in.powf(0.92) * 1.04 + 0.02).clamp(0.0, 1.0);
                    let g_out = (g_in.powf(0.96) * 1.01 + 0.02).clamp(0.0, 1.0);
                    let b_out = (b_in.powf(1.05) * 0.94 + 0.03).clamp(0.0, 1.0);

                    let idx = (z * size * size + y * size + x) * 3;
                    lut.data[idx] = r_out;
                    lut.data[idx + 1] = g_out;
                    lut.data[idx + 2] = b_out;
                }
            }
        }
        lut
    }

    /// Procedural Preset: Film Noir Silver-Gelatin Monochrome
    pub fn preset_film_noir() -> Self {
        let size = 17;
        let mut lut = Self::new(size, "Film Noir".to_string());
        for z in 0..size {
            let b_in = z as f32 / (size - 1) as f32;
            for y in 0..size {
                let g_in = y as f32 / (size - 1) as f32;
                for x in 0..size {
                    let r_in = x as f32 / (size - 1) as f32;

                    // High contrast S-curve black and white with silver sheen
                    let lum = 0.299 * r_in + 0.587 * g_in + 0.114 * b_in;
                    let noir = if lum < 0.5 {
                        (lum * 2.0).powf(1.6) * 0.5
                    } else {
                        1.0 - ((1.0 - lum) * 2.0).powf(1.6) * 0.5
                    };

                    let idx = (z * size * size + y * size + x) * 3;
                    lut.data[idx] = noir;
                    lut.data[idx + 1] = noir;
                    lut.data[idx + 2] = (noir * 1.02).clamp(0.0, 1.0); // Subtle cold silver tint
                }
            }
        }
        lut
    }
}

/// Applies 3D Look-Up Table to an RGBA pixel buffer with variable blend intensity.
pub fn apply_3d_lut(buffer: &mut [u8], lut: &Lut3D, intensity: f32) {
    if intensity <= 0.0 {
        return;
    }
    let intensity_clamped = intensity.clamp(0.0, 1.0);

    for chunk in buffer.chunks_exact_mut(4) {
        let orig_r = chunk[0] as f32;
        let orig_g = chunk[1] as f32;
        let orig_b = chunk[2] as f32;

        let norm_r = orig_r / 255.0;
        let norm_g = orig_g / 255.0;
        let norm_b = orig_b / 255.0;

        let (target_r, target_g, target_b) = lut.sample_trilinear(norm_r, norm_g, norm_b);

        let final_r = orig_r + intensity_clamped * (target_r * 255.0 - orig_r);
        let final_g = orig_g + intensity_clamped * (target_g * 255.0 - orig_g);
        let final_b = orig_b + intensity_clamped * (target_b * 255.0 - orig_b);

        chunk[0] = final_r.clamp(0.0, 255.0) as u8;
        chunk[1] = final_g.clamp(0.0, 255.0) as u8;
        chunk[2] = final_b.clamp(0.0, 255.0) as u8;
    }
}

/// Factory function to construct procedural film preset by identifier.
pub fn create_film_preset(name: &str) -> Option<Lut3D> {
    match name.to_lowercase().as_str() {
        "teal_orange" | "teal-orange" | "teal & orange" | "teal_and_orange" => Some(Lut3D::preset_teal_orange()),
        "kodak_portra" | "kodak-portra" | "portra" | "kodak portra 400" => Some(Lut3D::preset_kodak_portra()),
        "film_noir" | "film-noir" | "noir" | "film noir" => Some(Lut3D::preset_film_noir()),
        _ => None,
    }
}
