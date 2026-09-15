// Web Worker: Dedicated Rust Wasm Compute & OffscreenCanvas Thread
import init, { ImageProcessor, generate_spline_lut, is_simd_available } from "./pkg/wasm_image_processor.js";

let wasmModule = null;
let processor = null;
let offscreenCanvas = null;
let offscreenCtx = null;
let useSimd = true;

const luts = {
  master: new Uint8Array(256),
  r: new Uint8Array(256),
  g: new Uint8Array(256),
  b: new Uint8Array(256),
};

function updateChannelLut(pts, channel) {
  const flat = [];
  pts.forEach(p => { flat.push(p.x); flat.push(p.y); });
  if (generate_spline_lut) {
    luts[channel] = generate_spline_lut(new Float32Array(flat));
  } else {
    for (let i = 0; i < 256; i++) luts[channel][i] = i;
  }
}

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case "INIT_WASM": {
      try {
        wasmModule = await init();
        const simdActive = typeof is_simd_available === "function" ? is_simd_available() : false;
        useSimd = simdActive;
        self.postMessage({ type: "INIT_SUCCESS", isSimd: simdActive });
      } catch (err) {
        self.postMessage({ type: "INIT_ERROR", error: err.toString() });
      }
      break;
    }

    case "ATTACH_OFFSCREEN_CANVAS": {
      offscreenCanvas = payload.canvas;
      offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
      self.postMessage({ type: "OFFSCREEN_ATTACHED" });
      break;
    }

    case "LOAD_IMAGE": {
      const { data, width, height } = payload;
      if (!wasmModule) {
        wasmModule = await init();
      }

      processor = new ImageProcessor(width, height);
      processor.load_image(data, width, height);
      processor.set_simd_enabled(useSimd);

      if (offscreenCanvas) {
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        const imgData = new ImageData(new Uint8ClampedArray(data), width, height);
        offscreenCtx.putImageData(imgData, 0, 0);
      }

      self.postMessage({
        type: "IMAGE_LOADED",
        width,
        height,
        histogram: Array.from(processor.get_histogram())
      });
      break;
    }

    case "RENDER": {
      if (!processor) return;

      const { state, curves } = payload;
      const t0 = performance.now();

      // Update Spline LUTs for all 4 channels
      if (curves) {
        updateChannelLut(curves.master, "master");
        updateChannelLut(curves.r, "r");
        updateChannelLut(curves.g, "g");
        updateChannelLut(curves.b, "b");
      }

      processor.set_simd_enabled(state.simdEnabled ?? useSimd);
      if (state.lut3dIntensity !== undefined) {
        processor.set_3d_lut_intensity(state.lut3dIntensity);
      }
      if (state.lut3dPreset !== undefined && state.lut3dPreset !== null) {
        processor.set_3d_lut_preset(state.lut3dPreset);
      }
      processor.apply_pipeline(
        state.brightness,
        state.contrast,
        state.saturation,
        state.hue,
        state.gamma,
        state.blur,
        state.sharpen,
        state.unsharpAmount,
        state.unsharpRadius,
        state.bilateralSpatial,
        state.bilateralRange,
        state.sepia,
        state.invert,
        state.grayscale,
        state.vignette,
        luts.master,
        luts.r,
        luts.g,
        luts.b
      );

      const t1 = performance.now();
      const elapsed = (t1 - t0).toFixed(2);
      const hist = processor.get_histogram();

      if (offscreenCanvas && offscreenCtx) {
        // Direct zero-copy draw on background thread
        const pixelPtr = processor.pixel_ptr();
        const pixelLen = processor.pixel_len();
        const wasmMemory = new Uint8ClampedArray(wasmModule.memory.buffer, pixelPtr, pixelLen);
        const imgData = new ImageData(wasmMemory, processor.width(), processor.height());
        offscreenCtx.putImageData(imgData, 0, 0);

        self.postMessage({
          type: "RENDER_COMPLETE",
          duration: elapsed,
          histogram: Array.from(hist)
        });
      } else {
        // Transferable buffer fallback
        const pixels = processor.get_pixels();
        self.postMessage({
          type: "RENDER_COMPLETE",
          duration: elapsed,
          pixels: pixels.buffer,
          width: processor.width(),
          height: processor.height(),
          histogram: Array.from(hist)
        }, [pixels.buffer]);
      }
      break;
    }

    case "BRUSH_STROKE": {
      if (!processor) return;
      const { x0, y0, x1, y1, radius, feather, opacity, erase, state, curves } = payload;
      processor.draw_brush_stroke(x0, y0, x1, y1, radius, feather, opacity, erase);

      // Trigger instant re-render with the updated mask
      if (state) {
        if (curves) {
          updateChannelLut(curves.master, "master");
          updateChannelLut(curves.r, "r");
          updateChannelLut(curves.g, "g");
          updateChannelLut(curves.b, "b");
        }
        processor.set_simd_enabled(state.simdEnabled ?? useSimd);
        processor.apply_pipeline(
          state.brightness, state.contrast, state.saturation, state.hue, state.gamma,
          state.blur, state.sharpen, state.unsharpAmount, state.unsharpRadius,
          state.bilateralSpatial, state.bilateralRange, state.sepia, state.invert,
          state.grayscale, state.vignette, luts.master, luts.r, luts.g, luts.b
        );
      }

      if (offscreenCanvas && offscreenCtx) {
        const pixelPtr = processor.pixel_ptr();
        const pixelLen = processor.pixel_len();
        const wasmMemory = new Uint8ClampedArray(wasmModule.memory.buffer, pixelPtr, pixelLen);
        const imgData = new ImageData(wasmMemory, processor.width(), processor.height());
        offscreenCtx.putImageData(imgData, 0, 0);
      }

      const maskBytes = processor.get_mask();
      self.postMessage({
        type: "MASK_UPDATED",
        mask: maskBytes.buffer,
        width: processor.width(),
        height: processor.height(),
        hasActiveMask: processor.is_mask_enabled()
      }, [maskBytes.buffer]);
      break;
    }

    case "CLEAR_MASK": {
      if (!processor) return;
      processor.clear_mask();
      processor.set_mask_enabled(false);
      self.postMessage({ type: "MASK_CLEARED" });
      break;
    }

    case "INVERT_MASK": {
      if (!processor) return;
      processor.invert_mask();
      const maskBytes = processor.get_mask();
      self.postMessage({
        type: "MASK_UPDATED",
        mask: maskBytes.buffer,
        width: processor.width(),
        height: processor.height(),
        hasActiveMask: processor.is_mask_enabled()
      }, [maskBytes.buffer]);
      break;
    }

    case "TOGGLE_MASK": {
      if (!processor) return;
      processor.set_mask_enabled(payload.enabled);
      self.postMessage({ type: "MASK_TOGGLED", enabled: payload.enabled });
      break;
    }

    case "LOAD_3D_LUT": {
      if (!processor) return;
      const { content } = payload;
      const success = processor.load_3d_lut_cube(content);
      self.postMessage({ type: "3D_LUT_LOADED", success });
      break;
    }

    case "SET_3D_LUT_PRESET": {
      if (!processor) return;
      const { preset } = payload;
      const success = processor.set_3d_lut_preset(preset);
      self.postMessage({ type: "3D_LUT_PRESET_SET", preset, success });
      break;
    }

    case "SET_3D_LUT_INTENSITY": {
      if (!processor) return;
      const { intensity } = payload;
      processor.set_3d_lut_intensity(intensity);
      break;
    }

    case "CLEAR_3D_LUT": {
      if (!processor) return;
      processor.clear_3d_lut();
      self.postMessage({ type: "3D_LUT_CLEARED" });
      break;
    }

    case "TRANSFORM": {
      if (!processor) return;
      const { action } = payload;
      if (action === "FLIP_H") processor.flip_horizontal();
      else if (action === "FLIP_V") processor.flip_vertical();
      else if (action === "ROTATE_90") {
        processor.rotate_90();
        if (offscreenCanvas) {
          offscreenCanvas.width = processor.width();
          offscreenCanvas.height = processor.height();
        }
      }

      const pixelPtr = processor.pixel_ptr();
      const pixelLen = processor.pixel_len();
      const wasmMemory = new Uint8ClampedArray(wasmModule.memory.buffer, pixelPtr, pixelLen);

      if (offscreenCanvas && offscreenCtx) {
        const imgData = new ImageData(wasmMemory, processor.width(), processor.height());
        offscreenCtx.putImageData(imgData, 0, 0);
      }

      self.postMessage({
        type: "TRANSFORM_COMPLETE",
        width: processor.width(),
        height: processor.height()
      });
      break;
    }

    case "RUN_BENCHMARK": {
      if (!processor) return;
      const { originalData, width, height, iterations = 5 } = payload;

      // 1. Pure JavaScript Benchmark (Convolution Loop)
      const jsData = new Uint8ClampedArray(originalData);
      const tJsStart = performance.now();
      for (let iter = 0; iter < iterations; iter++) {
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            let idx = (y * width + x) * 4;
            let lum = 0.299 * jsData[idx] + 0.587 * jsData[idx + 1] + 0.114 * jsData[idx + 2];
            jsData[idx] = lum;
            jsData[idx + 1] = lum;
            jsData[idx + 2] = lum;
          }
        }
      }
      const jsTotal = performance.now() - tJsStart;
      const jsAvg = (jsTotal / iterations).toFixed(2);

      // 2. Rust Scalar Benchmark (SIMD off)
      processor.set_simd_enabled(false);
      const tScalarStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        processor.apply_tone_curves(luts.master, luts.r, luts.g, luts.b);
        processor.unsharp_mask(1.5, 1.2, 2);
        processor.grayscale();
        processor.invert();
        processor.reset_to_base();
      }
      const scalarTotal = performance.now() - tScalarStart;
      const scalarAvg = (scalarTotal / iterations).toFixed(2);

      // 3. Rust SIMD128 Benchmark (SIMD on)
      processor.set_simd_enabled(true);
      const tSimdStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        processor.apply_tone_curves(luts.master, luts.r, luts.g, luts.b);
        processor.unsharp_mask(1.5, 1.2, 2);
        processor.grayscale();
        processor.invert();
        processor.reset_to_base();
      }
      const simdTotal = performance.now() - tSimdStart;
      const simdAvg = (simdTotal / iterations).toFixed(2);

      const speedup = (jsTotal / simdTotal).toFixed(1);

      self.postMessage({
        type: "BENCHMARK_COMPLETE",
        jsAvg,
        scalarAvg,
        simdAvg,
        speedup
      });
      break;
    }
  }
};
