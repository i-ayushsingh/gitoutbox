# Build and Development Guide

This guide covers building the GitOutbox desktop application from source and compiling Windows installers (MSI / NSIS).

---

## 1. Prerequisites

Before compiling, install the following tools:
* **Node.js**: v20 or v24 (includes `npm` v10+)
* **Rust**: v1.75+ or v1.96+ (via [rustup](https://rustup.rs/))
* **C++ Build Tools**: Install "Desktop development with C++" workload via the [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-loop/).
* **WiX Toolset**: Required to build MSI packages. Tauri 2.0 will attempt to download this automatically during the build process, but you can also install it manually.

---

## 2. Dependency Configurations

### Crate Structure
* `gitoutbox-core`: Standard Rust library containing independent Git and scheduling algorithms.
* `gitoutbox` (`src-tauri`): Tauri application wrapper connecting UI commands to the database and execution loop.

---

## 3. Running Locally (Development)

1. Clone the repository and navigate to the directory:
   ```bash
   git clone https://github.com/i-ayushsingh/gitoutbox.git
   cd gitoutbox
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server and the Tauri desktop runner:
   ```bash
   npm run dev
   ```
   *Note: This runs in development mode. The frontend will have Hot Module Replacement (HMR) enabled, and Rust files will recompile automatically on changes.*

---

## 4. Production Compilation & Packaging

To compile a production build and generate installers:

```bash
npx tauri build
```

This command runs the following sequence:
1. Executes `npm run build` (which runs `tsc --noEmit` and builds optimized web assets via `vite build` into the `dist/` directory).
2. Compiles the Rust backend in release mode.
3. Packages the application executable.
4. Generates installation packages inside `src-tauri/target/release/bundle/`:
   - **MSI installer**: `src-tauri/target/release/bundle/msi/GitOutbox_0.1.0_x64_en-US.msi`
   - **NSIS setup executable**: `src-tauri/target/release/bundle/nsis/GitOutbox_0.1.0_x64-setup.exe`

---

## 5. Build Configurations (`tauri.conf.json`)

The packaging is controlled by [tauri.conf.json](file:///c:/Projects/Gitlater/src-tauri/tauri.conf.json):
* **Identifier**: `app.gitoutbox.desktop` (used for directory paths, registry, and notifications).
* **Icons**: Icon definitions are located in `src-tauri/icons/` and include sizes from `32x32` to `512x512` along with `icon.ico`.
* **NSIS Settings**: Customizes installer/uninstaller headers, sidebar images, and icons during setup.
* **WiX Settings**: Configures the banner and dialog images for MSI installations.
