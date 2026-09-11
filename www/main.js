import init, { ImageProcessor, generate_spline_lut, is_simd_available } from "./pkg/wasm_image_processor.js";

// Global Application State
let wasmModule = null;
let mainThreadProcessor = null;
let worker = null;
let workerReady = false;
let offscreenTransferred = false;
let originalImage = null;
let originalRawData = null;

let canvas = document.getElementById("mainCanvas");
let ctx = canvas.getContext("2d", { willReadFrequently: true });
let splitCanvas = document.getElementById("splitCanvas");
let splitCtx = splitCanvas.getContext("2d");
let histCanvas = document.getElementById("histogramCanvas");
let histCtx = histCanvas.getContext("2d");

// Curve State
let activeChannel = "master";
const curves = {
  master: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  g: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  b: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
};

const luts = {
  master: new Uint8Array(256),
  r: new Uint8Array(256),
  g: new Uint8Array(256),
  b: new Uint8Array(256),
};

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
  unsharpAmount: 0.0,
  unsharpRadius: 1.0,
  bilateralSpatial: 0.0,
  bilateralRange: 30.0,
  simdEnabled: true,
  workerEnabled: true,
  sepia: false,
  invert: false,
  grayscale: false,
  splitView: false,
  splitPos: 0.5
};

// UI Elements
const els = {
  threadStatus: document.getElementById("threadStatus"),
  uiFps: document.getElementById("uiFps"),
  wasmExecTime: document.getElementById("wasmExecTime"),
  imageDimensions: document.getElementById("imageDimensions"),
  simdStatus: document.getElementById("simdStatus"),
  toggleWorker: document.getElementById("toggleWorker"),
  toggleSimd: document.getElementById("toggleSimd"),
  dropZone: document.getElementById("dropZone"),
  dropHint: document.getElementById("dropHint"),
  imageUpload: document.getElementById("imageUpload"),
  btnSample: document.getElementById("btnSample"),
  btnBenchmark: document.getElementById("btnBenchmark"),
  btnReset: document.getElementById("btnReset"),
  btnResetCurve: document.getElementById("btnResetCurve"),
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
  benchScalar: document.getElementById("benchScalar"),
  benchSimd: document.getElementById("benchSimd"),
  benchJs: document.getElementById("benchJs"),
  benchSpeedup: document.getElementById("benchSpeedup"),
  // Tone Curve Elements
  curveSvg: document.getElementById("curveSvg"),
  curvePath: document.getElementById("curvePath"),
  curvePointsGroup: document.getElementById("curvePoints"),
  // Sliders
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
  sliderUnsharpAmount: document.getElementById("sliderUnsharpAmount"),
  valUnsharpAmount: document.getElementById("valUnsharpAmount"),
  sliderUnsharpRadius: document.getElementById("sliderUnsharpRadius"),
  valUnsharpRadius: document.getElementById("valUnsharpRadius"),
  sliderBilateralSpatial: document.getElementById("sliderBilateralSpatial"),
  valBilateralSpatial: document.getElementById("valBilateralSpatial"),
  sliderBilateralRange: document.getElementById("sliderBilateralRange"),
  valBilateralRange: document.getElementById("valBilateralRange"),
};

// 1. Live UI FPS Meter
let frameCount = 0;
let lastFpsUpdate = performance.now();
function updateFpsLoop() {
  frameCount++;
  const now = performance.now();
  if (now - lastFpsUpdate >= 500) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
    if (els.uiFps) {
      els.uiFps.textContent = `${fps} FPS`;
      els.uiFps.className = `metric-val ${fps >= 55 ? "fps-high" : fps >= 30 ? "fps-med" : "fps-low"}`;
    }
  }
  requestAnimationFrame(updateFpsLoop);
}
requestAnimationFrame(updateFpsLoop);

// 2. Initialize Web Worker & Main Thread Engine
async function bootstrap() {
  try {
    wasmModule = await init();
    const simdActive = typeof is_simd_available === "function" ? is_simd_available() : false;
    state.simdEnabled = simdActive;

    if (els.simdStatus) {
      els.simdStatus.textContent = simdActive ? "SIMD128 ⚡" : "Scalar Mode";
      els.simdStatus.className = simdActive ? "metric-val status-online" : "metric-val";
      els.toggleSimd.checked = simdActive;
    }

    // Initialize Web Worker
    initWorker();
    updateAllLuts();
    loadSampleProceduralImage();
  } catch (err) {
    console.warn("Bootstrap error:", err);
  }
}

function initWorker() {
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

    worker.onmessage = (e) => {
      const { type, duration, histogram, pixels, width, height, jsAvg, scalarAvg, simdAvg, speedup } = e.data;

      if (type === "INIT_SUCCESS") {
        workerReady = true;
        updateThreadStatus();
      } else if (type === "IMAGE_LOADED") {
        if (histogram) updateHistogram(histogram);
      } else if (type === "RENDER_COMPLETE") {
        if (duration && els.wasmExecTime) {
          els.wasmExecTime.textContent = `${duration} ms`;
        }
        if (histogram) updateHistogram(histogram);
        if (pixels && !offscreenTransferred) {
          const imgData = new ImageData(new Uint8ClampedArray(pixels), width, height);
          ctx.putImageData(imgData, 0, 0);
        }
        updateSplitView();
      } else if (type === "TRANSFORM_COMPLETE") {
        canvas.width = width;
        canvas.height = height;
        splitCanvas.width = width;
        splitCanvas.height = height;
        els.imageDimensions.textContent = `${width} × ${height}`;
        requestRender();
      } else if (type === "BENCHMARK_COMPLETE") {
        els.benchJs.textContent = `${jsAvg} ms`;
        els.benchScalar.textContent = `${scalarAvg} ms`;
        els.benchSimd.textContent = `${simdAvg} ms`;
        els.benchSpeedup.textContent = `${speedup}x vs JS`;
        requestRender();
      }
    };

    worker.postMessage({ type: "INIT_WASM" });
  } catch (err) {
    console.warn("Web Worker initialization failed, falling back to Main Thread:", err);
    state.workerEnabled = false;
    updateThreadStatus();
  }
}

function updateThreadStatus() {
  if (els.threadStatus) {
    if (state.workerEnabled && workerReady) {
      els.threadStatus.textContent = offscreenTransferred ? "Offscreen ⚡" : "Worker 🧵";
      els.threadStatus.className = "metric-val status-online";
    } else {
      els.threadStatus.textContent = "Main Thread";
      els.threadStatus.className = "metric-val";
    }
  }
}

// 3. Tone Curve Spline & LUT Generation
function updateChannelLut(channel) {
  const pts = curves[channel];
  const flat = [];
  pts.forEach(p => { flat.push(p.x); flat.push(p.y); });
  
  if (wasmModule && generate_spline_lut) {
    luts[channel] = generate_spline_lut(new Float32Array(flat));
  } else {
    for (let i = 0; i < 256; i++) luts[channel][i] = i;
  }
}

function updateAllLuts() {
  ["master", "r", "g", "b"].forEach(ch => updateChannelLut(ch));
  renderCurveSvg();
}

function renderCurveSvg() {
  const pts = curves[activeChannel];
  const lut = luts[activeChannel];
  
  let d = `M 0 ${256 - lut[0]}`;
  for (let x = 1; x < 256; x += 2) {
    d += ` L ${x} ${256 - lut[x]}`;
  }
  els.curvePath.setAttribute("d", d);

  const colors = {
    master: "var(--accent)",
    r: "#f87171",
    g: "#4ade80",
    b: "#60a5fa"
  };
  els.curvePath.setAttribute("stroke", colors[activeChannel]);

  els.curvePointsGroup.innerHTML = "";
  pts.forEach((p, idx) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", 256 - p.y);
    circle.setAttribute("r", "5");
    circle.setAttribute("class", "curve-point");
    circle.setAttribute("data-index", idx);
    els.curvePointsGroup.appendChild(circle);
  });
}

// 4. Image Loading and Processor Setup
function setupImage(img) {
  originalImage = img;
  els.dropHint.style.display = "none";

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  canvas.width = w;
  canvas.height = h;
  splitCanvas.width = w;
  splitCanvas.height = h;

  els.imageDimensions.textContent = `${w} × ${h}`;

  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  originalRawData = new Uint8ClampedArray(imgData.data);

  // Main Thread Processor Fallback
  mainThreadProcessor = new ImageProcessor(w, h);
  mainThreadProcessor.load_image(originalRawData, w, h);
  mainThreadProcessor.set_simd_enabled(state.simdEnabled);

  // Offload to Web Worker
  if (worker && workerReady) {
    worker.postMessage({
      type: "LOAD_IMAGE",
      payload: {
        data: originalRawData,
        width: w,
        height: h
      }
    });
  }

  splitCtx.drawImage(img, 0, 0);
  requestRender();
}

// 5. Render Request Loop
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
  if (state.workerEnabled && worker && workerReady) {
    // Background Worker Pipeline (Non-blocking)
    worker.postMessage({
      type: "RENDER",
      payload: {
        state,
        curves
      }
    });
  } else if (mainThreadProcessor) {
    // Main Thread Pipeline (Fallback)
    const t0 = performance.now();

    mainThreadProcessor.set_simd_enabled(state.simdEnabled);
    mainThreadProcessor.apply_pipeline(
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

    const pixelPtr = mainThreadProcessor.pixel_ptr();
    const pixelLen = mainThreadProcessor.pixel_len();
    const wasmMemory = new Uint8ClampedArray(wasmModule.memory.buffer, pixelPtr, pixelLen);
    const imgData = new ImageData(wasmMemory, mainThreadProcessor.width(), mainThreadProcessor.height());
    ctx.putImageData(imgData, 0, 0);

    const t1 = performance.now();
    const elapsed = (t1 - t0).toFixed(2);
    els.wasmExecTime.textContent = `${elapsed} ms`;

    updateHistogram(mainThreadProcessor.get_histogram());
    updateSplitView();
  }
}

// 6. Histogram Waveform Renderer
function updateHistogram(histData) {
  if (!histData || histData.length < 1024) return;
  const w = histCanvas.width;
  const h = histCanvas.height;
  histCtx.clearRect(0, 0, w, h);

  let maxCount = 1;
  for (let i = 0; i < 1024; i++) {
    if (histData[i] > maxCount) maxCount = histData[i];
  }

  const channels = [
    { offset: 0, color: "rgba(239, 68, 68, 0.6)" },
    { offset: 256, color: "rgba(34, 197, 94, 0.6)" },
    { offset: 512, color: "rgba(59, 130, 246, 0.6)" },
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

// 7. 3-Way Benchmark Runner
function runBenchmark() {
  if (!originalRawData || !originalImage) return;

  if (state.workerEnabled && worker && workerReady) {
    worker.postMessage({
      type: "RUN_BENCHMARK",
      payload: {
        originalData: originalRawData,
        width: canvas.width,
        height: canvas.height,
        iterations: 5
      }
    });
  } else if (mainThreadProcessor) {
    const iterations = 5;
    const w = canvas.width;
    const h = canvas.height;

    // JS Loop
    const jsData = new Uint8ClampedArray(originalRawData);
    const tJsStart = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let idx = (y * w + x) * 4;
          let lum = 0.299 * jsData[idx] + 0.587 * jsData[idx + 1] + 0.114 * jsData[idx + 2];
          jsData[idx] = lum; jsData[idx + 1] = lum; jsData[idx + 2] = lum;
        }
      }
    }
    const jsAvg = ((performance.now() - tJsStart) / iterations).toFixed(2);

    // Scalar Wasm
    mainThreadProcessor.set_simd_enabled(false);
    const tScalarStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      mainThreadProcessor.apply_tone_curves(luts.master, luts.r, luts.g, luts.b);
      mainThreadProcessor.unsharp_mask(1.5, 1.2, 2);
      mainThreadProcessor.grayscale();
      mainThreadProcessor.invert();
      mainThreadProcessor.reset_to_base();
    }
    const scalarAvg = ((performance.now() - tScalarStart) / iterations).toFixed(2);

    // SIMD Wasm
    mainThreadProcessor.set_simd_enabled(true);
    const tSimdStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      mainThreadProcessor.apply_tone_curves(luts.master, luts.r, luts.g, luts.b);
      mainThreadProcessor.unsharp_mask(1.5, 1.2, 2);
      mainThreadProcessor.grayscale();
      mainThreadProcessor.invert();
      mainThreadProcessor.reset_to_base();
    }
    const simdTotal = performance.now() - tSimdStart;
    const simdAvg = (simdTotal / iterations).toFixed(2);

    const speedup = (parseFloat(jsAvg) / parseFloat(simdAvg)).toFixed(1);

    els.benchJs.textContent = `${jsAvg} ms`;
    els.benchScalar.textContent = `${scalarAvg} ms`;
    els.benchSimd.textContent = `${simdAvg} ms`;
    els.benchSpeedup.textContent = `${speedup}x vs JS`;

    mainThreadProcessor.set_simd_enabled(state.simdEnabled);
    requestRender();
  }
}

// 8. Sample Procedural Image Generator
function loadSampleProceduralImage() {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = 1280;
  tempCanvas.height = 720;
  const tCtx = tempCanvas.getContext("2d");

  const grad = tCtx.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, "#0f172a");
  grad.addColorStop(0.4, "#1e1b4b");
  grad.addColorStop(0.7, "#f43f5e");
  grad.addColorStop(1, "#fbbf24");
  tCtx.fillStyle = grad;
  tCtx.fillRect(0, 0, 1280, 720);

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

// 9. Event Listeners & Interactive Curve Editor
function setupEventListeners() {
  // Web Worker Hardware Toggle
  if (els.toggleWorker) {
    els.toggleWorker.addEventListener("change", (e) => {
      state.workerEnabled = e.target.checked;
      updateThreadStatus();
      requestRender();
    });
  }

  // SIMD Hardware Toggle
  if (els.toggleSimd) {
    els.toggleSimd.addEventListener("change", (e) => {
      state.simdEnabled = e.target.checked;
      if (els.simdStatus) {
        els.simdStatus.textContent = state.simdEnabled ? "SIMD128 ⚡" : "Scalar Mode";
        els.simdStatus.className = state.simdEnabled ? "metric-val status-online" : "metric-val";
      }
      if (mainThreadProcessor) {
        mainThreadProcessor.set_simd_enabled(state.simdEnabled);
      }
      requestRender();
    });
  }

  // SVG Curve Dragging & Manipulation
  let draggedPointIdx = null;

  const getSvgCoordinates = (e) => {
    const rect = els.curveSvg.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    const x = Math.round(Math.max(0, Math.min(255, ((clientX - rect.left) / rect.width) * 256)));
    const y = Math.round(Math.max(0, Math.min(255, 256 - ((clientY - rect.top) / rect.height) * 256)));
    return { x, y };
  };

  els.curveSvg.addEventListener("pointerdown", (e) => {
    const coords = getSvgCoordinates(e);
    const pts = curves[activeChannel];

    let foundIdx = null;
    pts.forEach((p, idx) => {
      const dist = Math.hypot(p.x - coords.x, p.y - coords.y);
      if (dist < 15) foundIdx = idx;
    });

    if (e.button === 2) {
      if (foundIdx !== null && foundIdx !== 0 && foundIdx !== pts.length - 1) {
        pts.splice(foundIdx, 1);
        updateChannelLut(activeChannel);
        requestRender();
      }
      return;
    }

    if (foundIdx !== null) {
      draggedPointIdx = foundIdx;
    } else {
      pts.push({ x: coords.x, y: coords.y });
      pts.sort((a, b) => a.x - b.x);
      draggedPointIdx = pts.findIndex(p => p.x === coords.x && p.y === coords.y);
      updateChannelLut(activeChannel);
      requestRender();
    }
  });

  window.addEventListener("pointermove", (e) => {
    if (draggedPointIdx === null) return;
    const coords = getSvgCoordinates(e);
    const pts = curves[activeChannel];

    if (draggedPointIdx === 0) {
      pts[0].y = coords.y;
    } else if (draggedPointIdx === pts.length - 1) {
      pts[pts.length - 1].y = coords.y;
    } else {
      const prevX = pts[draggedPointIdx - 1].x + 2;
      const nextX = pts[draggedPointIdx + 1].x - 2;
      pts[draggedPointIdx].x = Math.max(prevX, Math.min(nextX, coords.x));
      pts[draggedPointIdx].y = coords.y;
    }

    updateChannelLut(activeChannel);
    requestRender();
  });

  window.addEventListener("pointerup", () => {
    draggedPointIdx = null;
  });

  els.curveSvg.addEventListener("contextmenu", e => e.preventDefault());

  // Channel Tabs
  document.querySelectorAll(".channel-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".channel-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeChannel = tab.dataset.channel;
      renderCurveSvg();
    });
  });

  // Reset Tone Curve
  els.btnResetCurve.addEventListener("click", () => {
    curves[activeChannel] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    updateChannelLut(activeChannel);
    requestRender();
  });

  // Standard Sliders
  const bindSlider = (el, valEl, key, suffix = "") => {
    if (!el) return;
    el.addEventListener("input", (e) => {
      state[key] = parseFloat(e.target.value);
      if (valEl) valEl.textContent = `${e.target.value}${suffix}`;
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
  bindSlider(els.sliderUnsharpAmount, els.valUnsharpAmount, "unsharpAmount");
  bindSlider(els.sliderUnsharpRadius, els.valUnsharpRadius, "unsharpRadius");
  bindSlider(els.sliderBilateralSpatial, els.valBilateralSpatial, "bilateralSpatial");
  bindSlider(els.sliderBilateralRange, els.valBilateralRange, "bilateralRange");

  // Toggles
  const bindToggle = (btn, key) => {
    if (!btn) return;
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
    if (mainThreadProcessor) {
      mainThreadProcessor.sobel_edges();
      const ptr = mainThreadProcessor.pixel_ptr();
      const len = mainThreadProcessor.pixel_len();
      ctx.putImageData(new ImageData(new Uint8ClampedArray(wasmModule.memory.buffer, ptr, len), canvas.width, canvas.height), 0, 0);
    }
  });

  els.btnEmboss.addEventListener("click", () => {
    if (mainThreadProcessor) {
      mainThreadProcessor.emboss();
      const ptr = mainThreadProcessor.pixel_ptr();
      const len = mainThreadProcessor.pixel_len();
      ctx.putImageData(new ImageData(new Uint8ClampedArray(wasmModule.memory.buffer, ptr, len), canvas.width, canvas.height), 0, 0);
    }
  });

  // Geometry
  els.btnFlipH.addEventListener("click", () => {
    if (state.workerEnabled && worker && workerReady) {
      worker.postMessage({ type: "TRANSFORM", payload: { action: "FLIP_H" } });
    } else if (mainThreadProcessor) {
      mainThreadProcessor.flip_horizontal();
      applyFilters();
    }
  });

  els.btnFlipV.addEventListener("click", () => {
    if (state.workerEnabled && worker && workerReady) {
      worker.postMessage({ type: "TRANSFORM", payload: { action: "FLIP_V" } });
    } else if (mainThreadProcessor) {
      mainThreadProcessor.flip_vertical();
      applyFilters();
    }
  });

  els.btnRotate90.addEventListener("click", () => {
    if (state.workerEnabled && worker && workerReady) {
      worker.postMessage({ type: "TRANSFORM", payload: { action: "ROTATE_90" } });
    } else if (mainThreadProcessor) {
      mainThreadProcessor.rotate_90();
      canvas.width = mainThreadProcessor.width();
      canvas.height = mainThreadProcessor.height();
      splitCanvas.width = canvas.width;
      splitCanvas.height = canvas.height;
      els.imageDimensions.textContent = `${canvas.width} × ${canvas.height}`;
      applyFilters();
    }
  });

  // Presets
  document.querySelectorAll(".preset-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.preset;
      resetState();
      switch (p) {
        case "s-curve":
          curves.master = [{ x: 0, y: 0 }, { x: 64, y: 40 }, { x: 192, y: 215 }, { x: 255, y: 255 }];
          state.saturation = 1.15;
          break;
        case "matte-fade":
          curves.master = [{ x: 0, y: 35 }, { x: 75, y: 70 }, { x: 180, y: 190 }, { x: 255, y: 220 }];
          state.contrast = 10;
          state.saturation = 0.9;
          break;
        case "portrait-soft":
          state.bilateralSpatial = 2.4;
          state.bilateralRange = 45.0;
          state.contrast = 8;
          state.brightness = 6;
          state.saturation = 1.15;
          break;
        case "cinema-punch":
          curves.master = [{ x: 0, y: 0 }, { x: 70, y: 45 }, { x: 185, y: 210 }, { x: 255, y: 255 }];
          state.unsharpAmount = 1.8;
          state.unsharpRadius = 1.6;
          state.saturation = 1.35;
          state.vignette = 0.45;
          break;
        case "cyberpunk":
          curves.r = [{ x: 0, y: 0 }, { x: 128, y: 90 }, { x: 255, y: 255 }];
          curves.b = [{ x: 0, y: 20 }, { x: 128, y: 160 }, { x: 255, y: 255 }];
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
          state.unsharpAmount = 1.4;
          state.vignette = 0.6;
          break;
        case "crisp-hdr":
          state.contrast = 20;
          state.saturation = 1.4;
          state.unsharpAmount = 1.6;
          state.unsharpRadius = 1.2;
          break;
      }
      updateAllLuts();
      syncControls();
      requestRender();
    });
  });

  // Reset
  els.btnReset.addEventListener("click", () => {
    resetState();
    updateAllLuts();
    syncControls();
    if (mainThreadProcessor) mainThreadProcessor.reset_to_base();
    requestRender();
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
  state.unsharpAmount = 0.0;
  state.unsharpRadius = 1.0;
  state.bilateralSpatial = 0.0;
  state.bilateralRange = 30.0;
  state.sepia = false;
  state.invert = false;
  state.grayscale = false;

  curves.master = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  curves.r = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  curves.g = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  curves.b = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
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
  els.sliderUnsharpAmount.value = state.unsharpAmount;
  els.valUnsharpAmount.textContent = state.unsharpAmount;
  els.sliderUnsharpRadius.value = state.unsharpRadius;
  els.valUnsharpRadius.textContent = state.unsharpRadius;
  els.sliderBilateralSpatial.value = state.bilateralSpatial;
  els.valBilateralSpatial.textContent = state.bilateralSpatial;
  els.sliderBilateralRange.value = state.bilateralRange;
  els.valBilateralRange.textContent = state.bilateralRange;

  if (els.toggleSimd) els.toggleSimd.checked = state.simdEnabled;
  if (els.toggleWorker) els.toggleWorker.checked = state.workerEnabled;

  els.btnGrayscale.classList.toggle("active", state.grayscale);
  els.btnSepia.classList.toggle("active", state.sepia);
  els.btnInvert.classList.toggle("active", state.invert);
}

// Start application
setupEventListeners();
bootstrap();
