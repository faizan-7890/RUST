mod utils;
mod filters;
mod convolutions;
mod transform;

use wasm_bindgen::prelude::*;
use wasm_bindgen::Clamped;

#[wasm_bindgen]
pub struct ImageProcessor {
    width: u32,
    height: u32,
    base_pixels: Vec<u8>,
    current_pixels: Vec<u8>,
}

#[wasm_bindgen]
impl ImageProcessor {
    /// Constructs a new ImageProcessor instance and initializes panic hook.
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        utils::set_panic_hook();
        let size = (width * height * 4) as usize;
        Self {
            width,
            height,
            base_pixels: vec![0u8; size],
            current_pixels: vec![0u8; size],
        }
    }

    /// Loads image bytes into the processor as the original baseline image.
    pub fn load_image(&mut self, data: Clamped<Vec<u8>>, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.base_pixels = data.0;
        self.current_pixels = self.base_pixels.clone();
    }

    /// Returns direct pointer to the current pixels buffer for zero-copy JS access.
    pub fn pixel_ptr(&self) -> *const u8 {
        self.current_pixels.as_ptr()
    }

    /// Returns buffer length in bytes.
    pub fn pixel_len(&self) -> usize {
        self.current_pixels.len()
    }

    /// Returns current width.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Returns current height.
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Resets the current pixels back to the original unmodified base image.
    pub fn reset_to_base(&mut self) {
        self.current_pixels.copy_from_slice(&self.base_pixels);
    }

    /// Commits current processed pixels as the new base image (for chaining actions).
    pub fn commit_as_base(&mut self) {
        self.base_pixels.copy_from_slice(&self.current_pixels);
    }

    /// Returns the processed pixels as a Uint8ClampedArray for HTML5 Canvas ImageData.
    pub fn get_pixels(&self) -> Clamped<Vec<u8>> {
        Clamped(self.current_pixels.clone())
    }

    /// Computes 4x256 RGB + Luminance channel histogram.
    pub fn get_histogram(&self) -> Vec<u32> {
        filters::compute_histogram(&self.current_pixels)
    }

    // --- Filters ---

    pub fn grayscale(&mut self) {
        filters::apply_grayscale(&mut self.current_pixels);
    }

    pub fn invert(&mut self) {
        filters::apply_invert(&mut self.current_pixels);
    }

    pub fn sepia(&mut self) {
        filters::apply_sepia(&mut self.current_pixels);
    }

    pub fn brightness(&mut self, value: f32) {
        filters::apply_brightness(&mut self.current_pixels, value);
    }

    pub fn contrast(&mut self, contrast: f32) {
        filters::apply_contrast(&mut self.current_pixels, contrast);
    }

    pub fn saturation(&mut self, saturation: f32) {
        filters::apply_saturation(&mut self.current_pixels, saturation);
    }

    pub fn hue_rotate(&mut self, angle_deg: f32) {
        filters::apply_hue_rotate(&mut self.current_pixels, angle_deg);
    }

    pub fn gamma(&mut self, gamma: f32) {
        filters::apply_gamma(&mut self.current_pixels, gamma);
    }

    pub fn threshold(&mut self, threshold: u8) {
        filters::apply_threshold(&mut self.current_pixels, threshold);
    }

    pub fn posterize(&mut self, levels: u8) {
        filters::apply_posterize(&mut self.current_pixels, levels);
    }

    pub fn solarize(&mut self, threshold: u8) {
        filters::apply_solarize(&mut self.current_pixels, threshold);
    }

    pub fn vignette(&mut self, radius: f32, intensity: f32) {
        filters::apply_vignette(&mut self.current_pixels, self.width, self.height, radius, intensity);
    }

    // --- Spatial Convolutions & Edge Preserving Filters ---

    pub fn gaussian_blur(&mut self, sigma: f32) {
        convolutions::apply_gaussian_blur(&mut self.current_pixels, self.width, self.height, sigma);
    }

    pub fn sharpen(&mut self, intensity: f32) {
        let mut temp = self.current_pixels.clone();
        convolutions::apply_sharpen(&self.current_pixels, &mut temp, self.width, self.height, intensity);
        self.current_pixels = temp;
    }

    pub fn unsharp_mask(&mut self, sigma: f32, amount: f32, threshold: u8) {
        convolutions::apply_unsharp_mask(&mut self.current_pixels, self.width, self.height, sigma, amount, threshold);
    }

    pub fn bilateral_filter(&mut self, spatial_sigma: f32, range_sigma: f32) {
        convolutions::apply_bilateral_filter(&mut self.current_pixels, self.width, self.height, spatial_sigma, range_sigma);
    }

    pub fn emboss(&mut self) {
        let mut temp = self.current_pixels.clone();
        convolutions::apply_emboss(&self.current_pixels, &mut temp, self.width, self.height);
        self.current_pixels = temp;
    }

    pub fn sobel_edges(&mut self) {
        let mut temp = self.current_pixels.clone();
        convolutions::apply_sobel(&self.current_pixels, &mut temp, self.width, self.height);
        self.current_pixels = temp;
    }

    // --- Geometric Transforms ---

    pub fn flip_horizontal(&mut self) {
        transform::flip_horizontal(&mut self.current_pixels, self.width, self.height);
        transform::flip_horizontal(&mut self.base_pixels, self.width, self.height);
    }

    pub fn flip_vertical(&mut self) {
        transform::flip_vertical(&mut self.current_pixels, self.width, self.height);
        transform::flip_vertical(&mut self.base_pixels, self.width, self.height);
    }

    pub fn rotate_90(&mut self) {
        let mut new_curr = vec![0u8; (self.width * self.height * 4) as usize];
        let mut new_base = vec![0u8; (self.width * self.height * 4) as usize];

        transform::rotate_90_cw(&self.current_pixels, &mut new_curr, self.width, self.height);
        transform::rotate_90_cw(&self.base_pixels, &mut new_base, self.width, self.height);

        self.current_pixels = new_curr;
        self.base_pixels = new_base;
        std::mem::swap(&mut self.width, &mut self.height);
    }

    pub fn rotate_180(&mut self) {
        transform::rotate_180(&mut self.current_pixels);
        transform::rotate_180(&mut self.base_pixels);
    }

    pub fn rotate_270(&mut self) {
        let mut new_curr = vec![0u8; (self.width * self.height * 4) as usize];
        let mut new_base = vec![0u8; (self.width * self.height * 4) as usize];

        transform::rotate_270_cw(&self.current_pixels, &mut new_curr, self.width, self.height);
        transform::rotate_270_cw(&self.base_pixels, &mut new_base, self.width, self.height);

        self.current_pixels = new_curr;
        self.base_pixels = new_base;
        std::mem::swap(&mut self.width, &mut self.height);
    }

    /// Unified high-speed filter pipeline: resets to base image and applies
    /// interactive parameters in a single pass without cumulative compounding error.
    pub fn apply_pipeline(
        &mut self,
        brightness: f32,
        contrast: f32,
        saturation: f32,
        hue_deg: f32,
        gamma: f32,
        blur_sigma: f32,
        sharpen_val: f32,
        unsharp_amount: f32,
        unsharp_radius: f32,
        bilateral_spatial: f32,
        bilateral_range: f32,
        sepia_active: bool,
        invert_active: bool,
        grayscale_active: bool,
        vignette_intensity: f32,
    ) {
        self.reset_to_base();

        if (brightness).abs() > 0.1 {
            filters::apply_brightness(&mut self.current_pixels, brightness);
        }
        if (contrast).abs() > 0.1 {
            filters::apply_contrast(&mut self.current_pixels, contrast);
        }
        if (saturation - 1.0).abs() > 0.01 {
            filters::apply_saturation(&mut self.current_pixels, saturation);
        }
        if hue_deg.abs() > 0.5 {
            filters::apply_hue_rotate(&mut self.current_pixels, hue_deg);
        }
        if (gamma - 1.0).abs() > 0.01 {
            filters::apply_gamma(&mut self.current_pixels, gamma);
        }
        if sepia_active {
            filters::apply_sepia(&mut self.current_pixels);
        }
        if invert_active {
            filters::apply_invert(&mut self.current_pixels);
        }
        if grayscale_active {
            filters::apply_grayscale(&mut self.current_pixels);
        }
        if vignette_intensity > 0.01 {
            filters::apply_vignette(&mut self.current_pixels, self.width, self.height, 1.2, vignette_intensity);
        }
        if bilateral_spatial > 0.1 && bilateral_range > 0.1 {
            convolutions::apply_bilateral_filter(&mut self.current_pixels, self.width, self.height, bilateral_spatial, bilateral_range);
        }
        if blur_sigma > 0.1 {
            convolutions::apply_gaussian_blur(&mut self.current_pixels, self.width, self.height, blur_sigma);
        }
        if sharpen_val > 0.05 {
            let mut temp = self.current_pixels.clone();
            convolutions::apply_sharpen(&self.current_pixels, &mut temp, self.width, self.height, sharpen_val);
            self.current_pixels = temp;
        }
        if unsharp_amount > 0.05 && unsharp_radius > 0.1 {
            convolutions::apply_unsharp_mask(&mut self.current_pixels, self.width, self.height, unsharp_radius, unsharp_amount, 2);
        }
    }
}
