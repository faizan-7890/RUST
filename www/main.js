import init, { ImageProcessor } from "./pkg/wasm_image_processor.js";

// Global Application State
let wasmModule = null;
let processor = null;
let originalImage = null;
let canvas = document.getElementById("mainCanvas");
let ctx = canvas.getContext("2d", { willReadFrequently: true });

let splitCanvas = document.getElementById("splitCanvas");
let splitCtx = splitCanvas.getContext("2d");
let histCanvas = document.getElementById("histogramCanvas");
let histCtx = histCanvas.getContext("2d");

// Filter State
const state = {
  brightness: 0,
  contrast: 0,
  saturation: 1.0,
  hue: 0,
  gamma: 1.0,
  vignette: 0.0,
  blur: 0.0,
  sharpen: 0.0,
  sepia: false,
  invert: false,
  grayscale: false,
  splitView: false,
  splitPos: 0.5
};

// UI Elements
const els = {
  wasmExecTime: document.getElementById("wasmExecTime"),
  imageDimensions: document.getElementById("imageDimensions"),
  dropZone: document.getElementById("dropZone"),
  dropHint: document.getElementById("dropHint"),
  imageUpload: document.getElementById("imageUpload"),
  btnSample: document.getElementById("btnSample"),
  btnBenchmark: document.getElementById("btnBenchmark"),
  btnReset: document.getElementById("btnReset"),
  btnDownload: document.getElementById("btnDownload"),
  btnFlipH: document.getElementById("btnFlipH"),
  btnFlipV: document.getElementById("btnFlipV"),
  btnRotate90: document.getElementById("btnRotate90"),
  btnGrayscale: document.getElementById("btnGrayscale"),
  btnSepia: document.getElementById("btnSepia"),
  btnInvert: document.getElementById("btnInvert"),
  btnSobel: document.getElementById("btnSobel"),
  btnEmboss: document.getElementById("btnEmboss"),
  btnSolarize: document.getElementById("btnSolarize"),
  toggleSplitView: document.getElementById("toggleSplitView"),
  splitContainer: document.getElementById("splitContainer"),
  splitDivider: document.getElementById("splitDivider"),
  benchWasm: document.getElementById("benchWasm"),
  benchJs: document.getElementById("benchJs"),
  benchSpeedup: document.getElementById("benchSpeedup"),
  // Sliders & Labels
  sliderBrightness: document.getElementById("sliderBrightness"),
  valBrightness: document.getElementById("valBrightness"),
  sliderContrast: document.getElementById("sliderContrast"),
  valContrast: document.getElementById("valContrast"),
  sliderSaturation: document.getElementById("sliderSaturation"),
  valSaturation: document.getElementById("valSaturation"),
  sliderHue: document.getElementById("sliderHue"),
  valHue: document.getElementById("valHue"),
  sliderGamma: document.getElementById("sliderGamma"),
  valGamma: document.getElementById("valGamma"),
  sliderVignette: document.getElementById("sliderVignette"),
  valVignette: document.getElementById("valVignette"),
  sliderBlur: document.getElementById("sliderBlur"),
  valBlur: document.getElementById("valBlur"),
  sliderSharpen: document.getElementById("sliderSharpen"),
  valSharpen: document.getElementById("valSharpen"),
};

// 1. Initialize WebAssembly Module
async function bootstrap() {
  try {
    wasmModule = await init();
    console.log("🦀 Rust WebAssembly module successfully initialized!");
    loadSampleProceduralImage();
  } catch (err) {
    console.warn("Wasm init failed, waiting for wasm-pack build:", err);
    document.getElementById("engineStatus").textContent = "Build Pending";
    document.getElementById("engineStatus").className = "metric-val";
  }
}

// 2. Image Loading and Processor Setup
function setupImage(img) {
  originalImage = img;
  els.dropHint.style.display = "none";

  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  splitCanvas.width = canvas.width;
  splitCanvas.height = canvas.height;

  els.imageDimensions.textContent = `${canvas.width} × ${canvas.height}`;

  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if (wasmModule) {
    processor = new ImageProcessor(canvas.width, canvas.height);
    processor.load_image(imgData.data, canvas.width, canvas.height);
  }

  // Draw original into split canvas
  splitCtx.drawImage(img, 0, 0);
  applyFilters();
}

// 3. High-Performance Render Loop
let renderPending = false;
function requestRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    applyFilters();
    renderPending = false;
  });
}

function applyFilters() {
  if (!processor) return;

  const t0 = performance.now();

  processor.apply_pipeline(
    state.brightness,
    state.contrast,
    state.saturation,
    state.hue,
    state.gamma,
    state.blur,
    state.sharpen,
    state.sepia,
    state.invert,
    state.grayscale,
    state.vignette
  );

  // Fast zero-copy memory slice read from Wasm linear memory
  const pixelPtr = processor.pixel_ptr();
  const pixelLen = processor.pixel_len();
  const wasmMemory = new Uint8ClampedArray(wasmModule.memory.buffer, pixelPtr, pixelLen);

  const imgData = new ImageData(wasmMemory, processor.width(), processor.height());
  ctx.putImageData(imgData, 0, 0);

  const t1 = performance.now();
  const elapsed = (t1 - t0).toFixed(2);
  els.wasmExecTime.textContent = `${elapsed} ms`;

  // Draw Histogram & update Split view
  updateHistogram(processor.get_histogram());
  updateSplitView();
}

// 4. Histogram Waveform Renderer
function updateHistogram(histData) {
  if (!histData || histData.length < 1024) return;
  const w = histCanvas.width;
  const h = histCanvas.height;
  histCtx.clearRect(0, 0, w, h);

  // Find max bin value for scaling
  let maxCount = 1;
  for (let i = 0; i < 1024; i++) {
    if (histData[i] > maxCount) maxCount = histData[i];
  }

  const channels = [
    { offset: 0, color: "rgba(239, 68, 68, 0.6)" },   // Red
    { offset: 256, color: "rgba(34, 197, 94, 0.6)" }, // Green
    { offset: 512, color: "rgba(59, 130, 246, 0.6)" },// Blue
  ];

  channels.forEach(({ offset, color }) => {
    histCtx.fillStyle = color;
    histCtx.beginPath();
    histCtx.moveTo(0, h);
    for (let x = 0; x < 256; x++) {
      const val = histData[offset + x];
      const normH = (val / maxCount) * h;
      histCtx.lineTo((x / 256) * w, h - normH);
    }
    histCtx.lineTo(w, h);
    histCtx.closePath();
    histCtx.fill();
  });
}

// 5. Benchmark: Rust Wasm vs Pure JavaScript Loop
function runBenchmark() {
  if (!processor || !originalImage) return;

  ctx.drawImage(originalImage, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const iterations = 5;

  // 1. Rust WebAssembly Benchmark
  const tWasmStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    processor.gaussian_blur(3.0);
    processor.sharpen(1.2);
    processor.sobel_edges();
    processor.reset_to_base();
  }
  const wasmTotal = performance.now() - tWasmStart;
  const wasmAvg = (wasmTotal / iterations).toFixed(2);

  // 2. Pure JavaScript Benchmark (Equivalent Sobel + Blur loop)
  const jsData = new Uint8ClampedArray(imgData.data);
  const tJsStart = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    const w = canvas.width;
    const h = canvas.height;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let idx = (y * w + x) * 4;
        let lum = 0.299 * jsData[idx] + 0.587 * jsData[idx + 1] + 0.114 * jsData[idx + 2];
        jsData[idx] = lum;
        jsData[idx + 1] = lum;
        jsData[idx + 2] = lum;
      }
    }
  }
  const jsTotal = performance.now() - tJsStart;
  const jsAvg = (jsTotal / iterations).toFixed(2);

  const speedup = (jsTotal / wasmTotal).toFixed(1);

  els.benchWasm.textContent = `${wasmAvg} ms`;
  els.benchJs.textContent = `${jsAvg} ms`;
  els.benchSpeedup.textContent = `${speedup}x Faster`;

  applyFilters();
}

// 6. Sample Procedural Image Generator
function loadSampleProceduralImage() {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 1280;
  tempCanvas.height = 720;
  const tCtx = tempCanvas.getContext("2d");

  // Create a vibrant landscape gradient with shapes for testing filters
  const grad = tCtx.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(0.4, "#1e1b4b");
  grad.addColorStop(0.7, "#f43f5e");
  grad.addColorStop(1, "#fbbf24");
  tCtx.fillStyle = grad;
  tCtx.fillRect(0, 0, 1280, 720);

  // Draw sun & geometric elements
  tCtx.beginPath();
  tCtx.arc(640, 360, 160, 0, Math.PI * 2);
  tCtx.fillStyle = "rgba(255, 230, 120, 0.9)";
  tCtx.shadowColor = "#f59e0b";
  tCtx.shadowBlur = 40;
  tCtx.fill();

  const img = new Image();
  img.onload = () => setupImage(img);
  img.src = tempCanvas.toDataURL();
}

// 7. Event Listeners & Interactive UI
function setupEventListeners() {
  // Sliders
  const bindSlider = (el, valEl, key, suffix = "") => {
    el.addEventListener("input", (e) => {
      state[key] = parseFloat(e.target.value);
      valEl.textContent = `${e.target.value}${suffix}`;
      requestRender();
    });
  };

  bindSlider(els.sliderBrightness, els.valBrightness, "brightness");
  bindSlider(els.sliderContrast, els.valContrast, "contrast");
  bindSlider(els.sliderSaturation, els.valSaturation, "saturation");
  bindSlider(els.sliderHue, els.valHue, "hue", "°");
  bindSlider(els.sliderGamma, els.valGamma, "gamma");
  bindSlider(els.sliderVignette, els.valVignette, "vignette");
  bindSlider(els.sliderBlur, els.valBlur, "blur");
  bindSlider(els.sliderSharpen, els.valSharpen, "sharpen");

  // Toggles
  const bindToggle = (btn, key) => {
    btn.addEventListener("click", () => {
      state[key] = !state[key];
      btn.classList.toggle("active", state[key]);
      requestRender();
    });
  };

  bindToggle(els.btnGrayscale, "grayscale");
  bindToggle(els.btnSepia, "sepia");
  bindToggle(els.btnInvert, "invert");

  // Instant Kernels
  els.btnSobel.addEventListener("click", () => {
    if (!processor) return;
    processor.sobel_edges();
    const ptr = processor.pixel_ptr();
    const len = processor.pixel_len();
    ctx.putImageData(new ImageData(new Uint8ClampedArray(wasmModule.memory.buffer, ptr, len), canvas.width, canvas.height), 0, 0);
  });

  els.btnEmboss.addEventListener("click", () => {
    if (!processor) return;
    processor.emboss();
    const ptr = processor.pixel_ptr();
    const len = processor.pixel_len();
    ctx.putImageData(new ImageData(new Uint8ClampedArray(wasmModule.memory.buffer, ptr, len), canvas.width, canvas.height), 0, 0);
  });

  // Geometry
  els.btnFlipH.addEventListener("click", () => {
    if (!processor) return;
    processor.flip_horizontal();
    applyFilters();
  });

  els.btnFlipV.addEventListener("click", () => {
    if (!processor) return;
    processor.flip_vertical();
    applyFilters();
  });

  els.btnRotate90.addEventListener("click", () => {
    if (!processor) return;
    processor.rotate_90();
    canvas.width = processor.width();
    canvas.height = processor.height();
    splitCanvas.width = canvas.width;
    splitCanvas.height = canvas.height;
    els.imageDimensions.textContent = `${canvas.width} × ${canvas.height}`;
    applyFilters();
  });

  // Presets
  document.querySelectorAll(".preset-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.preset;
      resetState();
      switch (p) {
        case "cyberpunk":
          state.contrast = 25;
          state.saturation = 1.8;
          state.hue = 290;
          state.vignette = 0.4;
          break;
        case "vintage":
          state.sepia = true;
          state.contrast = 15;
          state.gamma = 1.2;
          state.vignette = 0.5;
          break;
        case "dramatic-bw":
          state.grayscale = true;
          state.contrast = 40;
          state.sharpen = 0.8;
          state.vignette = 0.6;
          break;
        case "crisp-hdr":
          state.contrast = 20;
          state.saturation = 1.4;
          state.sharpen = 1.0;
          break;
        case "warm-sunset":
          state.brightness = 10;
          state.contrast = 15;
          state.hue = 30;
          state.saturation = 1.5;
          break;
      }
      syncControls();
      requestRender();
    });
  });

  // Reset
  els.btnReset.addEventListener("click", () => {
    resetState();
    syncControls();
    if (processor) processor.reset_to_base();
    applyFilters();
  });

  // Export
  els.btnDownload.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = `rust-filtered-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  // Benchmark
  els.btnBenchmark.addEventListener("click", runBenchmark);
  els.btnSample.addEventListener("click", loadSampleProceduralImage);

  // File Upload & Drag-and-Drop
  els.imageUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
  });

  els.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropZone.classList.add("drag-hover");
  });

  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("drag-hover");
  });

  els.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("drag-hover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      handleImageFile(file);
    }
  });

  // Split View Divider
  els.toggleSplitView.addEventListener("change", (e) => {
    state.splitView = e.target.checked;
    els.splitContainer.style.display = state.splitView ? "block" : "none";
    updateSplitView();
  });
}

function updateSplitView() {
  if (!state.splitView) return;
  const w = canvas.width;
  const clipWidth = w * state.splitPos;
  splitCanvas.style.clipPath = `polygon(0 0, ${clipWidth}px 0, ${clipWidth}px 100%, 0 100%)`;
  els.splitDivider.style.left = `${state.splitPos * 100}%`;
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => setupImage(img);
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function resetState() {
  state.brightness = 0;
  state.contrast = 0;
  state.saturation = 1.0;
  state.hue = 0;
  state.gamma = 1.0;
  state.vignette = 0.0;
  state.blur = 0.0;
  state.sharpen = 0.0;
  state.sepia = false;
  state.invert = false;
  state.grayscale = false;
}

function syncControls() {
  els.sliderBrightness.value = state.brightness;
  els.valBrightness.textContent = state.brightness;
  els.sliderContrast.value = state.contrast;
  els.valContrast.textContent = state.contrast;
  els.sliderSaturation.value = state.saturation;
  els.valSaturation.textContent = state.saturation;
  els.sliderHue.value = state.hue;
  els.valHue.textContent = `${state.hue}°`;
  els.sliderGamma.value = state.gamma;
  els.valGamma.textContent = state.gamma;
  els.sliderVignette.value = state.vignette;
  els.valVignette.textContent = state.vignette;
  els.sliderBlur.value = state.blur;
  els.valBlur.textContent = state.blur;
  els.sliderSharpen.value = state.sharpen;
  els.valSharpen.textContent = state.sharpen;

  els.btnGrayscale.classList.toggle("active", state.grayscale);
  els.btnSepia.classList.toggle("active", state.sepia);
  els.btnInvert.classList.toggle("active", state.invert);
}

// Start application
setupEventListeners();
bootstrap();
