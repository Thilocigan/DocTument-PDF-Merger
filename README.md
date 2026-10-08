# DocTument 📄✨

> **Smart Folder Parser • Natural Numerical Sorter • Fullscreen PDF Studio Editor • 100% Client-Side In-Browser PDF Merger**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Pure Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![100% Offline](https://img.shields.io/badge/Offline-Private-success.svg)](#privacy--security)
[![No Cloud Uploads](https://img.shields.io/badge/Data_Privacy-100%25_Client--Side-brightgreen.svg)](#privacy--security)

**DocTument** is a modern, privacy-first web application that allows users to upload entire directories of documents, automatically parses file names to group them by person, sorts numbered documents in natural numerical sequence, provides intuitive drag-and-drop file reordering, and merges grouped files into individual, cleanly formatted PDFs per person.

It also features a dedicated **Fullscreen Free-Space PDF Studio Editor** with unlimited multi-image & text layer management, full Undo/Redo history, visual alignment presets, and native Windows "Save As" location dialogs.

---

## 🌟 Key Features

### 1. 📁 Smart Folder Parsing & Grouping
- **Upload Folders or Batch Files**: Recursively traverse directory structures using `<input webkitdirectory>` or drag-and-drop.
- **Intelligent Person Name Parsing**:
  - Automatically identifies person names and numbered sequences:
    - `Alice_Smith_01.pdf`, `Alice_Smith_02.pdf`, `Alice_Smith_10.pdf` &rarr; **Alice Smith**
    - `Bob Johnson - Part 1.pdf`, `Bob Johnson - Part 2.pdf` &rarr; **Bob Johnson**
    - `Charlie Davis (1).pdf`, `Charlie Davis (2).pdf` &rarr; **Charlie Davis**
    - `Diana_Prince_page_1.pdf` &rarr; **Diana Prince**
    - Subfolder matching: `Reports/John Doe/file 1.pdf` &rarr; **John Doe**
  - **4 Flexible Parsing Modes**:
    1. *Smart Auto-Detect* (Default)
    2. *Subfolder Name as Person*
    3. *Delimiter Split* (`_`, `-`, etc.)
    4. *Custom Regular Expressions* with live pattern testing.

### 2. 🔢 Natural Numerical Sorting
- Prevents annoying alphabetical sorting traps (where `10` sorts before `2`).
- Files are sorted in intuitive human order: `#1, #2, #3 ... #9, #10, #11`.
- Per-person and global 1-click sorting buttons.

### 3. 🗂️ Interactive Documents Overview & Rearranging
- **Whole PDF Documents**: Each uploaded file is presented as a whole card with a live cover preview, format badge, and page count.
- **Visual Drag-and-Drop Reordering**: Drag whole PDF cards to customize the exact merge sequence.
- **Per-Document Controls**: Dedicated buttons to move up, move down, preview, edit, or delete individual files.

### 4. 🎨 Dedicated Fullscreen PDF Editor Studio (`editor.html`)
- Opens in a clean, distraction-free fullscreen workspace without cramped sidebars.
- **Unlimited Images & Signatures**:
  - Upload multiple stamps, logos, signatures, or photos.
  - Independent positioning, scaling (10%–200%), and opacity controls.
  - **9 Quick Alignment Presets**: Snap to Top-Left, Top-Center, Top-Right, Mid-Left, Center, Mid-Right, Bottom-Left, Bottom-Center, Bottom-Right.
  - **Apply to ALL Pages**: Watermark or stamp across every page in the PDF with a single toggle.
- **Unlimited Text & Annotations**:
  - Add multiple text boxes per document.
  - Custom font sizes, colors (Black, Dark Gray, Red, Blue, Green, White), and background whiteout box (for redacting and replacing text).
- **Interactive Multi-Item Management**:
  - Click any placed item directly on the page to select, drag, configure, or delete it individually.
  - Items remain **fully re-editable anytime**, even after clicking "Save Changes".
- **Undo & Redo System**:
  - Full multi-level action history with `Ctrl+Z` and `Ctrl+Y` keyboard shortcuts and top-bar buttons.

### 5. 💾 Native Windows "Save As" & Naming Convention
- **Confirmation & Location Window**: Clicking "Merge PDF" or "Merge All & Download ZIP" prompts for confirmation and opens the native Windows File Explorer "Save As" location window (`window.showSaveFilePicker`).
- **Standardized Filename Format**: Merged files are automatically named with the person's name first, ending with `REPORTS.pdf` (e.g. **`JOHN REPORTS.pdf`**).
- **Batch ZIP Export**: Packages all merged PDFs into a single ZIP archive with 1-click "Save As" location selection.

### 6. 🔒 100% Offline & Private
- All processing is conducted client-side via WebAssembly / JavaScript using **pdf-lib**, **PDF.js**, and **JSZip**.
- **Zero server uploads**: Your confidential documents never leave your computer.
- Bundled with local vendor libraries in `/vendor` for offline usage without an internet connection.

---

## 🚀 Quick Start

### Option A: Open Directly (No Installation Required)
Double-click [`index.html`](index.html) in your file explorer to launch the application directly in any modern browser (Chrome, Edge, Firefox, Safari, Brave, Opera).

### Option B: Local Web Server
If you prefer running a local HTTP server:

```bash
# Using Node.js (npx serve)
npx serve -l 3000 .

# Or using Python 3
python -m http.server 3000
```
Then navigate to `http://localhost:3000` in your browser.

---

## 🧪 Testing with Included Sample Files

The repository includes pre-built sample test documents in [`sample_documents/`](sample_documents/):
1. Launch **DocTument**.
2. Click **"Load Sample Documents"** (or click **"Upload Folder"** and choose the `sample_documents/` folder).
3. The workspace will immediately populate with grouped files for *Alice Smith*, *Bob Johnson*, *Charlie Davis*, and *Diana Prince*.
4. Test rearranging documents, editing PDFs in the Fullscreen Studio, and merging with the Windows "Save As" location dialog.

---

## 📁 Repository Structure

```
DocTument/
├── index.html               # Main workspace UI
├── style.css                # Stylesheet with responsive light/dark themes
├── app.js                   # Main application engine (parser, sorter, merge controller)
├── editor.html              # Dedicated Fullscreen PDF Editor Studio
├── editor.css               # Stylesheet for visual canvas & layer controls
├── editor.js                # Studio editor engine (multi-item layers, undo/redo, canvas)
├── favicon.svg              # Brand vector favicon
├── favicon.png              # 64x64 raster favicon
├── favicon.ico              # Multi-resolution icon file
├── vendor/                  # Bundled offline dependencies
│   ├── pdf-lib.min.js       # Client-side PDF generation & editing
│   ├── pdf.min.js           # Client-side PDF rendering
│   ├── pdf.worker.min.js    # PDF.js Web Worker
│   └── jszip.min.js         # Client-side ZIP archive generation
├── sample_documents/        # Ready-to-use sample PDFs for quick testing
├── package.json             # NPM metadata and scripts
├── .gitignore               # Ignored files (node_modules, OS files, logs)
└── README.md                # Project documentation
```

---

## 💻 Browser Support

| Browser | Supported | Native Windows "Save As" Dialog |
| :--- | :---: | :---: |
| Google Chrome | ✅ Full Support | ✅ Yes (`showSaveFilePicker`) |
| Microsoft Edge | ✅ Full Support | ✅ Yes (`showSaveFilePicker`) |
| Brave Browser | ✅ Full Support | ✅ Yes (`showSaveFilePicker`) |
| Mozilla Firefox | ✅ Full Support | 🔄 Graceful fallback download |
| Apple Safari | ✅ Full Support | 🔄 Graceful fallback download |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
