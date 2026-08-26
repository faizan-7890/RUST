# Automation script to compile Rust Wasm and launch development server

Write-Host "🦀 Building Rust WebAssembly package with wasm-pack..." -ForegroundColor Cyan
wasm-pack build --target web --out-dir www/pkg

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ wasm-pack build failed. Make sure Rust and wasm-pack are installed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "📦 Installing web dependencies..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\www"
npm install

Write-Host "🚀 Starting Vite dev server..." -ForegroundColor Green
npm run dev
