# 🦀⚡ Rust + WebAssembly In-Browser Image Filter Studio

A high-performance, real-time image filtering and spatial processing engine written in **Rust**, compiled to **WebAssembly (Wasm)**, and executed directly in the browser with **zero-copy memory sharing** via HTML5 Canvas.

---

## ✨ Features

- **🚀 Near-Native Rust Execution**: High-throughput pixel processing compiled with `opt-level = 3` and LTO.
- **⚡ Zero-Copy Memory Pipeline**: Uses `Uint8ClampedArray` views directly over WebAssembly linear memory to eliminate serialization and copy overheads.
- **🎨 Rich Filter Suite**:
  - **Color & Tone**: Brightness, Contrast, Saturation, Hue Rotation, Gamma (LUT-accelerated), Sepia, Invert, Grayscale, Vignette.
  - **Convolutions & Spatial Filtering**: Separable Gaussian Blur ($O(2K)$ passes), Sharpen, Emboss, Sobel Edge Magnitude Detection.
  - **Geometric Operations**: 90°/180°/270° Rotation, Horizontal & Vertical in-place Flipping.
- **📊 Real-Time Waveform Histogram**: 4-channel live visualization (Red, Green, Blue, Luminance).
- **🔄 Before / After Comparison**: Interactive split slider to compare processed vs original images in real-time.
- **⚡ Live In-Browser Benchmark**: Compares Rust Wasm execution speed against pure JavaScript loops with real-time speedup calculation.
- **💾 Full Export Capabilities**: Download high-resolution processed results as PNG/JPEG.

---

## 🏗️ Architecture

See the complete [ARCHITECTURE.md](ARCHITECTURE.md) for full architectural diagrams, memory layouts, and mathematical kernel formulations.

---

## 🛠️ Prerequisites & Setup

To build and run this project, make sure you have:

1. **Rust & Cargo**: [Install Rust via rustup](https://rustup.rs/)
2. **wasm-pack**:
   ```bash
   cargo install wasm-pack
   ```
3. **Node.js & npm** (or Bun):
   ```bash
   node -v
   ```

---

## 🚀 Quick Start

### 1. Build the Rust WebAssembly package
From the project root:
```bash
wasm-pack build --target web --out-dir www/pkg
```

### 2. Start the Frontend Development Server
Navigate to the `www/` directory and install dependencies:
```bash
cd www
npm install
npm run dev
```

Open your browser at `http://localhost:3000`.

---

## 📂 Project Structure

```
wasm-image-processor/
├── Cargo.toml               # Rust dependencies and release compiler optimizations
├── ARCHITECTURE.md          # In-depth architectural diagrams & memory specs
├── README.md                # Project documentation & setup instructions
├── build.ps1                # One-click Windows build and launch script
├── .gitignore
├── src/
│   ├── lib.rs               # ImageProcessor Wasm export & pipeline orchestration
│   ├── filters.rs           # Pure Rust color, tone, and LUT gamma kernels
│   ├── convolutions.rs      # Separable Gaussian blur, Sobel, Sharpen, Emboss
│   ├── transform.rs         # In-place flipping and 90/180/270 degree rotations
│   └── utils.rs             # Panic hook integration and logging macros
└── www/
    ├── index.html           # Modern dark-mode UI with Split View & Histogram
    ├── style.css            # Responsive layout & custom sliders
    ├── main.js              # Wasm bridge, zero-copy buffer view, and render loop
    ├── vite.config.js       # Vite configuration with Wasm top-level await plugins
    └── package.json         # Frontend dependencies
```

---

## 📜 License
MIT License.
