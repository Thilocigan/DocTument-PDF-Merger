/**
 * PDF Fullscreen Editor Studio Logic (editor.js)
 * - Spacious, unconstrained workspace ("free space, without dungeon space")
 * - High-resolution PDF rendering & interactive navigation with filmstrip
 * - Manage MULTIPLE images and MULTIPLE text items (unlimited)
 * - Select, drag, align, resize, and edit any item
 * - Explicit Delete function for images & Remove option for texts (on canvas & in sidebar)
 * - Full UNDO and REDO functionality (Top bar buttons + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
 * - Editable EVEN AFTER clicking "Save Changes" (preserves live interactive layers & metadata)
 * - Burn edits into PDF using pdf-lib and sync with workspace via IndexedDB & BroadcastChannel
 */

(function () {
  'use strict';

  // Configure PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  // =========================================================================
  // IndexedDB Communication Layer
  // =========================================================================
  const DB_NAME = 'PDFMergerStudioDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'activeSessions';

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getFromDB(key) {
    try {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB get error:', err);
      return null;
    }
  }

  async function saveToDB(item) {
    try {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(item);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB save error:', err);
      return false;
    }
  }

  // Broadcast Channel for syncing
  let syncChannel = null;
  try {
    syncChannel = new BroadcastChannel('pdf_merger_studio_sync');
  } catch (e) {
    console.warn('BroadcastChannel not supported');
  }

  // =========================================================================
  // Studio Editor State
  // =========================================================================
  const studioState = {
    docName: 'Document.pdf',
    personName: 'Current User',
    fileId: null,
    basePdfBytes: null, // Pristine unburnt PDF bytes (never lost!)
    pdfjsDoc: null,
    numPages: 1,
    currentPage: 1,
    zoomLevel: 1.0,
    pageDimensions: { width: 595, height: 842 },
    isSaving: false,

    // MULTI-ITEM LAYERS LIST: Array of added images and text boxes
    items: [],
    selectedItemId: null
  };

  // =========================================================================
  // History State (Undo & Redo)
  // =========================================================================
  const historyState = {
    undoStack: [],
    redoStack: [],
    maxStackSize: 40
  };

  function captureSnapshot() {
    return {
      items: JSON.parse(JSON.stringify(studioState.items)),
      selectedItemId: studioState.selectedItemId
    };
  }

  function pushHistorySnapshot(snapshot) {
    historyState.undoStack.push(snapshot);
    if (historyState.undoStack.length > historyState.maxStackSize) {
      historyState.undoStack.shift();
    }
    historyState.redoStack = [];
    updateHistoryButtons();
  }

  function recordHistorySnapshot() {
    pushHistorySnapshot(captureSnapshot());
  }

  function updateHistoryButtons() {
    if (dom.btnUndo) dom.btnUndo.disabled = (historyState.undoStack.length === 0);
    if (dom.btnRedo) dom.btnRedo.disabled = (historyState.redoStack.length === 0);
  }

  function undo() {
    if (historyState.undoStack.length === 0) {
      showToast('Nothing to undo', 'info');
      return;
    }

    const currentSnapshot = captureSnapshot();
    historyState.redoStack.push(currentSnapshot);

    const prevSnapshot = historyState.undoStack.pop();
    studioState.items = JSON.parse(JSON.stringify(prevSnapshot.items));
    studioState.selectedItemId = prevSnapshot.selectedItemId;

    updateLayersList();
    updateSelectedPanel();
    renderCanvasOverlays();
    updateHistoryButtons();

    showToast('Undid last action ↺', 'info');
  }

  function redo() {
    if (historyState.redoStack.length === 0) {
      showToast('Nothing to redo', 'info');
      return;
    }

    const currentSnapshot = captureSnapshot();
    historyState.undoStack.push(currentSnapshot);

    const nextSnapshot = historyState.redoStack.pop();
    studioState.items = JSON.parse(JSON.stringify(nextSnapshot.items));
    studioState.selectedItemId = nextSnapshot.selectedItemId;

    updateLayersList();
    updateSelectedPanel();
    renderCanvasOverlays();
    updateHistoryButtons();

    showToast('Redid action ↻', 'info');
  }

  // =========================================================================
  // DOM Elements
  // =========================================================================
  const dom = {
    // Top Bar
    studioDocTitle: document.getElementById('studioDocTitle'),
    studioPageCountBadge: document.getElementById('studioPageCountBadge'),
    btnPrevPage: document.getElementById('btnPrevPage'),
    btnNextPage: document.getElementById('btnNextPage'),
    inputPageDirect: document.getElementById('inputPageDirect'),
    lblTotalPages: document.getElementById('lblTotalPages'),
    btnZoomOut: document.getElementById('btnZoomOut'),
    btnZoomIn: document.getElementById('btnZoomIn'),
    btnZoomFit: document.getElementById('btnZoomFit'),
    lblZoomLevel: document.getElementById('lblZoomLevel'),

    // Undo & Redo Buttons
    btnUndo: document.getElementById('btnUndo'),
    btnRedo: document.getElementById('btnRedo'),

    btnSaveAndSync: document.getElementById('btnSaveAndSync'),
    btnDownloadPdf: document.getElementById('btnDownloadPdf'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),

    // Sidebar Tool Selectors
    imageFileInput: document.getElementById('imageFileInput'),
    btnSidebarAddImage: document.getElementById('btnSidebarAddImage'),
    btnSidebarAddText: document.getElementById('btnSidebarAddText'),

    // Layers / Added Items List
    lblLayerCount: document.getElementById('lblLayerCount'),
    btnClearAllLayers: document.getElementById('btnClearAllLayers'),
    layersListContainer: document.getElementById('layersListContainer'),
    layersEmptyHint: document.getElementById('layersEmptyHint'),

    // Panel: Image Controls
    panelImageControls: document.getElementById('panelImageControls'),
    btnDeleteImageFeature: document.getElementById('btnDeleteImageFeature'),
    imageStatusEmpty: document.getElementById('imageStatusEmpty'),
    imageStatusActive: document.getElementById('imageStatusActive'),
    sideImgPreview: document.getElementById('sideImgPreview'),
    sideImgName: document.getElementById('sideImgName'),
    sideImgDimensions: document.getElementById('sideImgDimensions'),
    alignButtons: document.querySelectorAll('.alignment-grid-3x3 .btn-align'),
    rangeImageScale: document.getElementById('rangeImageScale'),
    valImageScale: document.getElementById('valImageScale'),
    rangeImageOpacity: document.getElementById('rangeImageOpacity'),
    valImageOpacity: document.getElementById('valImageOpacity'),
    chkApplyImageAllPages: document.getElementById('chkApplyImageAllPages'),
    btnDirectDeleteImage: document.getElementById('btnDirectDeleteImage'),

    // Panel: Text Controls
    panelTextControls: document.getElementById('panelTextControls'),
    btnRemoveTextFeature: document.getElementById('btnRemoveTextFeature'),
    textStatusEmpty: document.getElementById('textStatusEmpty'),
    textStatusActive: document.getElementById('textStatusActive'),
    inputTextContent: document.getElementById('inputTextContent'),
    selectFontSize: document.getElementById('selectFontSize'),
    selectTextColor: document.getElementById('selectTextColor'),
    chkWhiteoutBackground: document.getElementById('chkWhiteoutBackground'),
    chkApplyTextAllPages: document.getElementById('chkApplyTextAllPages'),
    textAlignButtons: document.querySelectorAll('.text-align-buttons .btn-align-text'),
    btnDirectRemoveText: document.getElementById('btnDirectRemoveText'),

    // Canvas Stage
    studioCanvasArea: document.getElementById('studioCanvasArea'),
    canvasLoader: document.getElementById('canvasLoader'),
    loaderMessage: document.getElementById('loaderMessage'),
    pageStageWrapper: document.getElementById('pageStageWrapper'),
    mainPdfCanvas: document.getElementById('mainPdfCanvas'),
    canvasOverlayLayer: document.getElementById('canvasOverlayLayer'),

    // Filmstrip
    filmstripContainer: document.getElementById('filmstripContainer'),

    // Toast
    toastContainer: document.getElementById('toastContainer')
  };

  // =========================================================================
  // Initialization
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    bindEvents();
    updateHistoryButtons();
    loadSessionDocument();
  });

  function initTheme() {
    const savedTheme = localStorage.getItem('pdf_sorter_theme') || 'theme-light';
    document.body.className = `${savedTheme} editor-page-body`;
  }

  function toggleTheme() {
    const isDark = document.body.classList.contains('theme-dark');
    const newTheme = isDark ? 'theme-light' : 'theme-dark';
    document.body.className = `${newTheme} editor-page-body`;
    localStorage.setItem('pdf_sorter_theme', newTheme);
  }

  // =========================================================================
  // Document Loader
  // =========================================================================
  async function loadSessionDocument() {
    showLoader('Loading PDF document...');

    try {
      // 1. Try to load from IndexedDB
      const session = await getFromDB('currentDoc');

      if (session && session.fileBlob) {
        studioState.docName = session.docName || 'Document.pdf';
        studioState.personName = session.personName || 'Current User';
        studioState.fileId = session.fileId || null;
        studioState.basePdfBytes = await session.fileBlob.arrayBuffer();

        // Restore previously added items if existing (so edits are never lost!)
        if (session.editableItems && Array.isArray(session.editableItems)) {
          studioState.items = session.editableItems;
          if (studioState.items.length > 0) {
            studioState.selectedItemId = studioState.items[0].id;
          }
        }
      } else {
        // Fallback: Create sample demo PDF so page is never broken
        studioState.docName = 'Demo_Document.pdf';
        studioState.basePdfBytes = await createFallbackDemoPdf();
      }

      dom.studioDocTitle.textContent = studioState.docName;
      dom.studioDocTitle.title = studioState.docName;

      // Load with PDF.js
      const loadingTask = pdfjsLib.getDocument({ data: studioState.basePdfBytes.slice(0) });
      studioState.pdfjsDoc = await loadingTask.promise;
      studioState.numPages = studioState.pdfjsDoc.numPages;

      // Update counters
      dom.lblTotalPages.textContent = `/ ${studioState.numPages}`;
      dom.inputPageDirect.max = studioState.numPages;

      // Render Page 1
      await renderPage(1);

      // Render Filmstrip thumbnails in background
      renderFilmstrip();

      // Render initial layers list and panels
      updateLayersList();
      updateSelectedPanel();
      updateHistoryButtons();

      hideLoader();
      showToast(`Loaded "${studioState.docName}" (${studioState.numPages} pages)`, 'success');
    } catch (err) {
      console.error('Failed to load session document:', err);
      hideLoader();
      showToast('Error loading PDF: ' + err.message, 'error');
    }
  }

  async function createFallbackDemoPdf() {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    
    // Page 1
    const page1 = doc.addPage([600, 800]);
    page1.drawText('PDF Fullscreen Editor Studio', { x: 50, y: 720, size: 24, font, color: rgb(0.2, 0.2, 0.8) });
    page1.drawText('Sample Document (3 Pages)', { x: 50, y: 680, size: 14, font, color: rgb(0.4, 0.4, 0.4) });
    page1.drawText('Page 1 of 3 - Free space unconstrained workspace.', { x: 50, y: 620, size: 12, font, color: rgb(0.2, 0.2, 0.2) });

    // Page 2
    const page2 = doc.addPage([600, 800]);
    page2.drawText('Page 2 of 3', { x: 50, y: 720, size: 20, font, color: rgb(0.2, 0.2, 0.8) });
    page2.drawText('Notice added images marked "All Pages" appear across all pages.', { x: 50, y: 670, size: 12, font, color: rgb(0.3, 0.3, 0.3) });

    // Page 3
    const page3 = doc.addPage([600, 800]);
    page3.drawText('Page 3 of 3', { x: 50, y: 720, size: 20, font, color: rgb(0.2, 0.2, 0.8) });
    page3.drawText('End of document. Use + Add Image or + Add / Edit Text on the left.', { x: 50, y: 670, size: 12, font, color: rgb(0.3, 0.3, 0.3) });

    return await doc.save();
  }

  // =========================================================================
  // PDF Page Rendering
  // =========================================================================
  async function renderPage(pageNum) {
    if (!studioState.pdfjsDoc) return;
    if (pageNum < 1 || pageNum > studioState.numPages) return;

    studioState.currentPage = pageNum;
    dom.inputPageDirect.value = pageNum;
    dom.studioPageCountBadge.textContent = `Page ${pageNum} of ${studioState.numPages}`;

    // Enable/disable navigation buttons
    dom.btnPrevPage.disabled = (pageNum <= 1);
    dom.btnNextPage.disabled = (pageNum >= studioState.numPages);

    showLoader('Rendering page...');

    try {
      const page = await studioState.pdfjsDoc.getPage(pageNum);
      // High-resolution viewport scaled by zoomLevel
      const viewport = page.getViewport({ scale: 1.5 * studioState.zoomLevel });

      const canvas = dom.mainPdfCanvas;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Update stage wrapper size
      dom.pageStageWrapper.style.width = `${viewport.width}px`;
      dom.pageStageWrapper.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      studioState.pageDimensions = { width: viewport.width, height: viewport.height };

      // Render all items for this page on the canvas
      renderCanvasOverlays();

      // Highlight filmstrip item
      updateFilmstripActive();

      hideLoader();
    } catch (err) {
      console.error('Error rendering page:', err);
      hideLoader();
    }
  }

  // =========================================================================
  // Filmstrip Thumbnail Bar
  // =========================================================================
  async function renderFilmstrip() {
    dom.filmstripContainer.innerHTML = '';
    if (!studioState.pdfjsDoc) return;

    for (let pNum = 1; pNum <= studioState.numPages; pNum++) {
      const thumbItem = document.createElement('div');
      thumbItem.className = `filmstrip-thumb ${pNum === studioState.currentPage ? 'active' : ''}`;
      thumbItem.dataset.page = pNum;
      thumbItem.title = `Jump to Page ${pNum}`;

      const thumbCanvas = document.createElement('canvas');
      thumbItem.appendChild(thumbCanvas);

      const numBadge = document.createElement('span');
      numBadge.className = 'filmstrip-thumb-num';
      numBadge.textContent = pNum;
      thumbItem.appendChild(numBadge);

      dom.filmstripContainer.appendChild(thumbItem);

      renderThumbnailPage(pNum, thumbCanvas);

      thumbItem.addEventListener('click', () => {
        renderPage(pNum);
      });
    }
  }

  async function renderThumbnailPage(pNum, canvas) {
    try {
      const page = await studioState.pdfjsDoc.getPage(pNum);
      const viewport = page.getViewport({ scale: 0.18 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      console.warn('Thumb render error:', e);
    }
  }

  function updateFilmstripActive() {
    const thumbs = dom.filmstripContainer.querySelectorAll('.filmstrip-thumb');
    thumbs.forEach(t => {
      const p = parseInt(t.dataset.page, 10);
      if (p === studioState.currentPage) {
        t.classList.add('active');
        t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        t.classList.remove('active');
      }
    });
  }

  // =========================================================================
  // MULTI-ITEM OVERLAYS ON CANVAS STAGE
  // =========================================================================
  function renderCanvasOverlays() {
    dom.canvasOverlayLayer.innerHTML = '';

    const stageW = studioState.pageDimensions.width;
    const stageH = studioState.pageDimensions.height;

    studioState.items.forEach(item => {
      // Check if visible on current page
      const isVisible = item.allPages || item.pageNumber === studioState.currentPage;
      if (!isVisible) return;

      const isSelected = item.id === studioState.selectedItemId;

      const overlayEl = document.createElement('div');
      overlayEl.className = `canvas-overlay-item ${item.type === 'image' ? 'overlay-image-item' : 'overlay-text-item'} ${isSelected ? 'selected' : ''}`;
      overlayEl.dataset.id = item.id;

      // Floating Drag Handle
      const handleEl = document.createElement('div');
      handleEl.className = 'overlay-handle-top';
      handleEl.textContent = `⋮⋮ ${item.type === 'image' ? item.name : 'Text'}`;
      handleEl.title = 'Drag to move this item';
      overlayEl.appendChild(handleEl);

      // PROMINENT DELETE / REMOVE BUTTON (Floating × button on each item)
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'overlay-close-btn';
      deleteBtn.type = 'button';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = item.type === 'image' ? 'Delete this image' : 'Remove this text';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(item.id);
      });
      overlayEl.appendChild(deleteBtn);

      // Scope Badge
      const scopeBadge = document.createElement('div');
      scopeBadge.className = 'overlay-scope-tag';
      scopeBadge.textContent = item.allPages ? 'All Pages' : `Page ${item.pageNumber}`;
      overlayEl.appendChild(scopeBadge);

      if (item.type === 'image') {
        // Image content
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = item.name;
        overlayEl.appendChild(img);

        const scale = item.scalePct / 100;
        const w = (item.naturalWidth || 150) * scale * (stageW / 600);
        const h = (item.naturalHeight || 150) * scale * (stageW / 600);

        const x = Math.max(0, Math.min(stageW - w, (item.relX * stageW) - (w / 2)));
        const y = Math.max(0, Math.min(stageH - h, (item.relY * stageH) - (h / 2)));

        overlayEl.style.width = `${Math.round(w)}px`;
        overlayEl.style.height = `${Math.round(h)}px`;
        overlayEl.style.left = `${Math.round(x)}px`;
        overlayEl.style.top = `${Math.round(y)}px`;
        overlayEl.style.opacity = `${item.opacityPct / 100}`;
      } else {
        // Text content
        const span = document.createElement('span');
        span.textContent = item.content || 'Text';

        let colorCss = '#111827';
        if (item.color === 'red') colorCss = '#ef4444';
        if (item.color === 'blue') colorCss = '#3b82f6';
        if (item.color === 'green') colorCss = '#10b981';
        if (item.color === 'white') colorCss = '#ffffff';
        span.style.color = colorCss;

        const ratio = stageW / 600;
        const finalFs = Math.max(12, Math.round((item.fontSize || 16) * ratio));
        span.style.fontSize = `${finalFs}px`;
        span.style.fontWeight = 'bold';

        if (item.whiteout) {
          overlayEl.classList.add('whiteout-active');
        }

        overlayEl.appendChild(span);

        dom.canvasOverlayLayer.appendChild(overlayEl);

        const rect = overlayEl.getBoundingClientRect();
        const txtW = rect.width || 100;
        const txtH = rect.height || 30;

        const x = Math.max(0, Math.min(stageW - txtW, (item.relX * stageW) - (txtW / 2)));
        const y = Math.max(0, Math.min(stageH - txtH, (item.relY * stageH) - (txtH / 2)));

        overlayEl.style.left = `${Math.round(x)}px`;
        overlayEl.style.top = `${Math.round(y)}px`;
      }

      if (!overlayEl.parentElement) {
        dom.canvasOverlayLayer.appendChild(overlayEl);
      }

      // Attach click to select
      overlayEl.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.overlay-close-btn')) {
          selectItem(item.id);
        }
      });

      // Attach drag listeners
      attachItemDrag(overlayEl, item);
    });
  }

  // =========================================================================
  // Dragging Logic with Undo History Tracking
  // =========================================================================
  function attachItemDrag(overlayEl, item) {
    let isDragging = false;
    let hasMoved = false;
    let dragStartSnapshot = null;
    let startMouseX = 0;
    let startMouseY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    overlayEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('.overlay-close-btn')) return;

      isDragging = true;
      hasMoved = false;
      dragStartSnapshot = captureSnapshot();

      startMouseX = e.clientX;
      startMouseY = e.clientY;

      initialLeft = parseInt(overlayEl.style.left || '0', 10);
      initialTop = parseInt(overlayEl.style.top || '0', 10);

      e.preventDefault();
    });

    const onMouseMove = (e) => {
      if (!isDragging) return;

      const stageW = studioState.pageDimensions.width;
      const stageH = studioState.pageDimensions.height;
      const elW = overlayEl.offsetWidth;
      const elH = overlayEl.offsetHeight;

      const dx = (e.clientX - startMouseX) / studioState.zoomLevel;
      const dy = (e.clientY - startMouseY) / studioState.zoomLevel;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        hasMoved = true;
      }

      let newLeft = Math.max(0, Math.min(stageW - elW, initialLeft + dx));
      let newTop = Math.max(0, Math.min(stageH - elH, initialTop + dy));

      overlayEl.style.left = `${Math.round(newLeft)}px`;
      overlayEl.style.top = `${Math.round(newTop)}px`;

      // Update relative coordinates
      item.relX = (newLeft + elW / 2) / stageW;
      item.relY = (newTop + elH / 2) / stageH;

      // Clear preset button active highlight when freely dragged
      dom.alignButtons.forEach(b => b.classList.remove('active'));
      dom.textAlignButtons.forEach(b => b.classList.remove('active'));
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        if (hasMoved && dragStartSnapshot) {
          pushHistorySnapshot(dragStartSnapshot);
          dragStartSnapshot = null;
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // =========================================================================
  // MULTI-ITEM MANAGEMENT & SELECTION
  // =========================================================================
  function selectItem(itemId) {
    studioState.selectedItemId = itemId;
    updateLayersList();
    updateSelectedPanel();

    // Update canvas selections without full redraw
    const allOverlays = dom.canvasOverlayLayer.querySelectorAll('.canvas-overlay-item');
    allOverlays.forEach(el => {
      if (el.dataset.id === itemId) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
  }

  function getSelectedItem() {
    if (!studioState.selectedItemId) return null;
    return studioState.items.find(i => i.id === studioState.selectedItemId) || null;
  }

  function updateLayersList() {
    dom.lblLayerCount.textContent = studioState.items.length;
    dom.btnClearAllLayers.style.display = studioState.items.length > 0 ? 'inline-block' : 'none';

    if (studioState.items.length === 0) {
      dom.layersEmptyHint.style.display = 'block';
      dom.layersListContainer.querySelectorAll('.layer-item-row').forEach(r => r.remove());
      return;
    }

    dom.layersEmptyHint.style.display = 'none';

    // Remove existing rows
    dom.layersListContainer.querySelectorAll('.layer-item-row').forEach(r => r.remove());

    studioState.items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `layer-item-row ${item.id === studioState.selectedItemId ? 'active' : ''}`;
      row.dataset.id = item.id;

      const left = document.createElement('div');
      left.className = 'layer-row-left';

      const iconBadge = document.createElement('div');
      iconBadge.className = 'layer-icon-badge';
      iconBadge.textContent = item.type === 'image' ? '🖼️' : '🔤';
      left.appendChild(iconBadge);

      const info = document.createElement('div');
      info.className = 'layer-row-info';

      const title = document.createElement('span');
      title.className = 'layer-row-title';
      title.textContent = item.type === 'image' ? `${index + 1}. ${item.name}` : `${index + 1}. "${item.content.substring(0, 18)}"`;
      info.appendChild(title);

      const sub = document.createElement('span');
      sub.className = 'layer-row-sub';
      sub.textContent = item.allPages ? 'Repeats on All Pages' : `Page ${item.pageNumber}`;
      info.appendChild(sub);

      left.appendChild(info);
      row.appendChild(left);

      // Trash delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'layer-delete-btn';
      delBtn.type = 'button';
      delBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
        </svg>
      `;
      delBtn.title = 'Delete this item';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteItem(item.id);
      });
      row.appendChild(delBtn);

      row.addEventListener('click', () => {
        selectItem(item.id);
      });

      dom.layersListContainer.appendChild(row);
    });
  }

  function updateSelectedPanel() {
    const item = getSelectedItem();

    if (!item) {
      dom.btnSidebarAddImage.classList.remove('active');
      dom.btnSidebarAddText.classList.remove('active');
      dom.panelImageControls.style.display = 'flex';
      dom.panelTextControls.style.display = 'none';

      dom.imageStatusActive.style.display = 'none';
      dom.imageStatusEmpty.style.display = 'block';
      dom.textStatusActive.style.display = 'none';
      dom.textStatusEmpty.style.display = 'block';
      return;
    }

    if (item.type === 'image') {
      dom.btnSidebarAddImage.classList.add('active');
      dom.btnSidebarAddText.classList.remove('active');
      dom.panelImageControls.style.display = 'flex';
      dom.panelTextControls.style.display = 'none';

      dom.imageStatusEmpty.style.display = 'none';
      dom.imageStatusActive.style.display = 'flex';

      dom.sideImgPreview.src = item.dataUrl;
      dom.sideImgName.textContent = item.name;
      dom.sideImgDimensions.textContent = `${item.naturalWidth} × ${item.naturalHeight} px`;

      dom.rangeImageScale.value = item.scalePct;
      dom.valImageScale.textContent = `${item.scalePct}%`;

      dom.rangeImageOpacity.value = item.opacityPct;
      dom.valImageOpacity.textContent = `${item.opacityPct}%`;

      dom.chkApplyImageAllPages.checked = item.allPages;

      // Update preset buttons
      dom.alignButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.align === item.align);
      });
    } else {
      dom.btnSidebarAddText.classList.add('active');
      dom.btnSidebarAddImage.classList.remove('active');
      dom.panelTextControls.style.display = 'flex';
      dom.panelImageControls.style.display = 'none';

      dom.textStatusEmpty.style.display = 'none';
      dom.textStatusActive.style.display = 'flex';

      dom.inputTextContent.value = item.content;
      dom.selectFontSize.value = String(item.fontSize);
      dom.selectTextColor.value = item.color;
      dom.chkWhiteoutBackground.checked = item.whiteout;
      dom.chkApplyTextAllPages.checked = item.allPages;
    }
  }

  // =========================================================================
  // ADDING NEW IMAGES & TEXT ITEMS (UNLIMITED)
  // =========================================================================
  function addNewImageTrigger() {
    dom.imageFileInput.click();
  }

  async function handleImageFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      showLoader('Processing image...');
      const dataUrl = await readFileAsDataUrl(file);
      const img = new Image();

      img.onload = () => {
        hideLoader();

        // Record history snapshot before adding
        recordHistorySnapshot();

        const newItem = {
          id: 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          type: 'image',
          name: file.name,
          dataUrl: dataUrl,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          scalePct: 40,
          opacityPct: 100,
          align: 'center',
          allPages: true,
          pageNumber: studioState.currentPage,
          relX: 0.5,
          relY: 0.5
        };

        studioState.items.push(newItem);
        selectItem(newItem.id);
        renderCanvasOverlays();

        showToast(`Added image "${file.name}". You can drag or align it!`, 'success');
      };

      img.onerror = () => {
        hideLoader();
        showToast('Invalid image format.', 'error');
      };

      img.src = dataUrl;
    } catch (err) {
      hideLoader();
      showToast('Failed to load image: ' + err.message, 'error');
    }

    e.target.value = '';
  }

  function addNewTextItem() {
    // Record history snapshot before adding
    recordHistorySnapshot();

    const count = studioState.items.filter(i => i.type === 'text').length + 1;
    const newItem = {
      id: 'txt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      type: 'text',
      name: `Text ${count}`,
      content: count === 1 ? 'CONFIDENTIAL' : `Custom Note ${count}`,
      fontSize: 18,
      color: 'dark',
      whiteout: false,
      allPages: false,
      pageNumber: studioState.currentPage,
      relX: 0.5,
      relY: 0.25 + ((count - 1) * 0.1) % 0.5
    };

    studioState.items.push(newItem);
    selectItem(newItem.id);
    renderCanvasOverlays();

    dom.inputTextContent.focus();
    showToast(`Added text box #${count}. Type in sidebar or drag on page!`, 'info');
  }

  // =========================================================================
  // DELETING & REMOVING ITEMS (WITH UNDO SUPPORT)
  // =========================================================================
  function deleteItem(itemId) {
    const idx = studioState.items.findIndex(i => i.id === itemId);
    if (idx === -1) return;

    // Record history snapshot before deleting
    recordHistorySnapshot();

    const [deleted] = studioState.items.splice(idx, 1);

    if (studioState.selectedItemId === itemId) {
      studioState.selectedItemId = studioState.items.length > 0 ? studioState.items[0].id : null;
    }

    updateLayersList();
    updateSelectedPanel();
    renderCanvasOverlays();

    showToast(`Deleted ${deleted.type === 'image' ? 'image' : 'text'}: "${deleted.name}". (Ctrl+Z to Undo)`, 'info');
  }

  function clearAllItems() {
    if (studioState.items.length === 0) return;
    if (confirm('Are you sure you want to remove all added images and text?')) {
      recordHistorySnapshot();
      studioState.items = [];
      studioState.selectedItemId = null;
      updateLayersList();
      updateSelectedPanel();
      renderCanvasOverlays();
      showToast('All items removed. (Ctrl+Z to Undo)', 'info');
    }
  }

  // =========================================================================
  // ALIGNMENT PRESETS (APPLIES TO SELECTED ITEM WITH UNDO)
  // =========================================================================
  function applyImagePresetToSelected(alignKey) {
    const item = getSelectedItem();
    if (!item || item.type !== 'image') return;

    recordHistorySnapshot();
    item.align = alignKey;

    let rx = 0.5;
    let ry = 0.5;

    switch (alignKey) {
      case 'top-left':      rx = 0.15; ry = 0.12; break;
      case 'top-center':    rx = 0.5;  ry = 0.12; break;
      case 'top-right':     rx = 0.85; ry = 0.12; break;
      case 'mid-left':      rx = 0.15; ry = 0.5;  break;
      case 'center':        rx = 0.5;  ry = 0.5;  break;
      case 'mid-right':     rx = 0.85; ry = 0.5;  break;
      case 'bottom-left':   rx = 0.15; ry = 0.88; break;
      case 'bottom-center': rx = 0.5;  ry = 0.88; break;
      case 'bottom-right':  rx = 0.85; ry = 0.88; break;
    }

    item.relX = rx;
    item.relY = ry;

    dom.alignButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.align === alignKey);
    });

    renderCanvasOverlays();
  }

  function applyTextPresetToSelected(posKey) {
    const item = getSelectedItem();
    if (!item || item.type !== 'text') return;

    recordHistorySnapshot();

    let rx = 0.5;
    let ry = 0.5;

    if (posKey === 'top-center') {
      rx = 0.5;
      ry = 0.08;
    } else if (posKey === 'center') {
      rx = 0.5;
      ry = 0.5;
    } else if (posKey === 'bottom-center') {
      rx = 0.5;
      ry = 0.92;
    }

    item.relX = rx;
    item.relY = ry;

    dom.textAlignButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pos === posKey);
    });

    renderCanvasOverlays();
  }

  function getPersonReportFilename(personName, fallbackDocName) {
    if (!personName || personName === 'Current User' || !personName.trim()) {
      return fallbackDocName || 'REPORTS.pdf';
    }
    let cleanPerson = personName
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (/[\s_-]*reports$/i.test(cleanPerson)) {
      cleanPerson = cleanPerson.replace(/[\s_-]*reports$/i, '').trim();
    }

    return `${cleanPerson} REPORTS.pdf`;
  }

  // =========================================================================
  // COMPILING & SAVING (RE-EDITABLE EVEN AFTER CLICKING SAVE CHANGES)
  // =========================================================================
  async function compileAndSavePdf(triggerDownload = false) {
    if (!studioState.basePdfBytes) {
      showToast('No PDF loaded to compile.', 'error');
      return;
    }

    showLoader('Compiling PDF with all images & text layers...');
    studioState.isSaving = true;

    try {
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      // Load pristine base PDF (preserves pristine foundation for repeated edits!)
      const pdfDoc = await PDFDocument.load(studioState.basePdfBytes, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const canvasW = studioState.pageDimensions.width || 600;
      const canvasH = studioState.pageDimensions.height || 800;

      // Font cache
      let standardFont = null;

      // Burn EACH item in studioState.items
      for (const item of studioState.items) {
        const targetPages = item.allPages ? pages : [pages[Math.min(pages.length - 1, (item.pageNumber || 1) - 1)]];

        if (item.type === 'image' && item.dataUrl) {
          let embeddedImg;
          const imgBytes = await fetch(item.dataUrl).then(res => res.arrayBuffer());

          if (item.dataUrl.startsWith('data:image/png')) {
            embeddedImg = await pdfDoc.embedPng(imgBytes);
          } else if (item.dataUrl.startsWith('data:image/jpeg')) {
            embeddedImg = await pdfDoc.embedJpg(imgBytes);
          } else {
            const pngBlob = await convertDataUrlToPngBlob(item.dataUrl);
            const pngBytes = await pngBlob.arrayBuffer();
            embeddedImg = await pdfDoc.embedPng(pngBytes);
          }

          for (const page of targetPages) {
            const { width: pWidth, height: pHeight } = page.getSize();
            const scale = item.scalePct / 100;
            const displayW = (item.naturalWidth || 150) * scale * (canvasW / 600);
            const displayH = (item.naturalHeight || 150) * scale * (canvasW / 600);

            const ratioW = pWidth / canvasW;
            const ratioH = pHeight / canvasH;

            const finalW = displayW * ratioW;
            const finalH = displayH * ratioH;

            const finalX = (item.relX * pWidth) - (finalW / 2);
            const finalY = pHeight - (item.relY * pHeight) - (finalH / 2);

            page.drawImage(embeddedImg, {
              x: Math.max(0, finalX),
              y: Math.max(0, finalY),
              width: finalW,
              height: finalH,
              opacity: (item.opacityPct || 100) / 100
            });
          }
        } else if (item.type === 'text' && item.content) {
          if (!standardFont) {
            standardFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
          }

          let colorRgb = rgb(0.1, 0.1, 0.1);
          if (item.color === 'red') colorRgb = rgb(0.85, 0.15, 0.15);
          if (item.color === 'blue') colorRgb = rgb(0.15, 0.35, 0.85);
          if (item.color === 'green') colorRgb = rgb(0.1, 0.65, 0.25);
          if (item.color === 'white') colorRgb = rgb(1, 1, 1);

          for (const page of targetPages) {
            const { width: pWidth, height: pHeight } = page.getSize();
            const ratio = pWidth / canvasW;

            const fontSizePt = Math.max(8, (item.fontSize || 16) * ratio);
            const textW = standardFont.widthOfTextAtSize(item.content, fontSizePt);

            const finalX = (item.relX * pWidth) - (textW / 2);
            const finalY = pHeight - (item.relY * pHeight) - (fontSizePt / 2);

            // Whiteout background box if enabled
            if (item.whiteout) {
              page.drawRectangle({
                x: finalX - 4,
                y: finalY - 4,
                width: textW + 8,
                height: fontSizePt + 8,
                color: rgb(1, 1, 1)
              });
            }

            page.drawText(item.content, {
              x: finalX,
              y: finalY,
              size: fontSizePt,
              font: standardFont,
              color: colorRgb
            });
          }
        }
      }

      const updatedPdfBytes = await pdfDoc.save();
      const updatedBlob = new Blob([updatedPdfBytes], { type: 'application/pdf' });

      // Save compiled PDF result to IndexedDB so workspace receives it
      await saveToDB({
        id: 'savedResult',
        docName: studioState.docName,
        personName: studioState.personName,
        fileId: studioState.fileId,
        fileBlob: updatedBlob,
        editableItems: studioState.items,
        updatedAt: Date.now()
      });

      // ALSO SAVE LIVE EDITABLE ITEMS METADATA TO SESSION
      // (This guarantees items can be edited continuously even after saving!)
      await saveToDB({
        id: 'currentDoc',
        docName: studioState.docName,
        personName: studioState.personName,
        fileId: studioState.fileId,
        fileBlob: new Blob([studioState.basePdfBytes], { type: 'application/pdf' }),
        editableItems: studioState.items,
        updatedAt: Date.now()
      });

      // Broadcast to other tabs
      if (syncChannel) {
        syncChannel.postMessage({
          type: 'PDF_UPDATED',
          docName: studioState.docName,
          fileId: studioState.fileId
        });
      }

      hideLoader();
      studioState.isSaving = false;

      if (triggerDownload) {
        const downloadFilename = getPersonReportFilename(studioState.personName, studioState.docName);
        const saveRes = await saveBlobWithPicker(updatedBlob, downloadFilename);
        if (saveRes && saveRes.cancelled) {
          showToast('Save cancelled.', 'info');
        } else {
          showToast(`PDF compiled & saved successfully as "${(saveRes && saveRes.name) || downloadFilename}"!`, 'success');
        }
      } else {
        showToast('Saved to workspace! All items remain fully editable anytime.', 'success');
      }
    } catch (err) {
      console.error('Error compiling PDF:', err);
      hideLoader();
      studioState.isSaving = false;
      showToast('Failed to compile PDF: ' + err.message, 'error');
    }
  }

  // =========================================================================
  // Zoom Controls
  // =========================================================================
  function setZoom(newZoom) {
    const clamped = Math.max(0.4, Math.min(2.5, newZoom));
    studioState.zoomLevel = clamped;
    dom.lblZoomLevel.textContent = `${Math.round(clamped * 100)}%`;
    renderPage(studioState.currentPage);
  }

  function zoomIn() { setZoom(studioState.zoomLevel + 0.15); }
  function zoomOut() { setZoom(studioState.zoomLevel - 0.15); }
  function zoomFit() { setZoom(1.0); }

  // =========================================================================
  // Event Listeners Binding
  // =========================================================================
  function bindEvents() {
    // Theme toggle
    dom.themeToggleBtn.addEventListener('click', toggleTheme);

    // Page navigation
    dom.btnPrevPage.addEventListener('click', () => {
      if (studioState.currentPage > 1) renderPage(studioState.currentPage - 1);
    });

    dom.btnNextPage.addEventListener('click', () => {
      if (studioState.currentPage < studioState.numPages) renderPage(studioState.currentPage + 1);
    });

    dom.inputPageDirect.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1 && val <= studioState.numPages) {
        renderPage(val);
      } else {
        e.target.value = studioState.currentPage;
      }
    });

    // Zoom
    dom.btnZoomIn.addEventListener('click', zoomIn);
    dom.btnZoomOut.addEventListener('click', zoomOut);
    dom.btnZoomFit.addEventListener('click', zoomFit);

    // Undo & Redo Button Handlers
    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);

    // Save & Download
    dom.btnSaveAndSync.addEventListener('click', () => compileAndSavePdf(false));
    dom.btnDownloadPdf.addEventListener('click', () => compileAndSavePdf(true));

    // Sidebar Tool Cards (Add new items)
    dom.btnSidebarAddImage.addEventListener('click', addNewImageTrigger);
    dom.btnSidebarAddText.addEventListener('click', addNewTextItem);
    dom.imageFileInput.addEventListener('change', handleImageFileSelected);

    // Layers Clear All
    dom.btnClearAllLayers.addEventListener('click', clearAllItems);

    // Image Alignment Presets
    dom.alignButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        applyImagePresetToSelected(btn.dataset.align);
      });
    });

    // Image Sliders with Snapshot on drag start
    let sliderStartSnapshot = null;
    const onSliderStart = () => {
      sliderStartSnapshot = captureSnapshot();
    };
    const onSliderCommit = () => {
      if (sliderStartSnapshot) {
        pushHistorySnapshot(sliderStartSnapshot);
        sliderStartSnapshot = null;
      }
    };

    dom.rangeImageScale.addEventListener('mousedown', onSliderStart);
    dom.rangeImageScale.addEventListener('touchstart', onSliderStart);
    dom.rangeImageScale.addEventListener('change', onSliderCommit);
    dom.rangeImageScale.addEventListener('input', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'image') {
        item.scalePct = parseInt(e.target.value, 10);
        dom.valImageScale.textContent = `${item.scalePct}%`;
        renderCanvasOverlays();
      }
    });

    dom.rangeImageOpacity.addEventListener('mousedown', onSliderStart);
    dom.rangeImageOpacity.addEventListener('touchstart', onSliderStart);
    dom.rangeImageOpacity.addEventListener('change', onSliderCommit);
    dom.rangeImageOpacity.addEventListener('input', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'image') {
        item.opacityPct = parseInt(e.target.value, 10);
        dom.valImageOpacity.textContent = `${item.opacityPct}%`;
        renderCanvasOverlays();
      }
    });

    dom.chkApplyImageAllPages.addEventListener('change', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'image') {
        recordHistorySnapshot();
        item.allPages = e.target.checked;
        updateLayersList();
        renderCanvasOverlays();
      }
    });

    // Image Delete Buttons
    const deleteSelectedImage = () => {
      const item = getSelectedItem();
      if (item && item.type === 'image') {
        deleteItem(item.id);
      }
    };
    dom.btnDeleteImageFeature.addEventListener('click', deleteSelectedImage);
    dom.btnDirectDeleteImage.addEventListener('click', deleteSelectedImage);

    // Text Inputs with Snapshot tracking
    let textFocusSnapshot = null;
    dom.inputTextContent.addEventListener('focus', () => {
      textFocusSnapshot = captureSnapshot();
    });
    dom.inputTextContent.addEventListener('change', () => {
      if (textFocusSnapshot) {
        pushHistorySnapshot(textFocusSnapshot);
        textFocusSnapshot = null;
      }
    });
    dom.inputTextContent.addEventListener('input', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'text') {
        item.content = e.target.value;
        updateLayersList();
        renderCanvasOverlays();
      }
    });

    dom.selectFontSize.addEventListener('change', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'text') {
        recordHistorySnapshot();
        item.fontSize = parseInt(e.target.value, 10);
        renderCanvasOverlays();
      }
    });

    dom.selectTextColor.addEventListener('change', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'text') {
        recordHistorySnapshot();
        item.color = e.target.value;
        renderCanvasOverlays();
      }
    });

    dom.chkWhiteoutBackground.addEventListener('change', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'text') {
        recordHistorySnapshot();
        item.whiteout = e.target.checked;
        renderCanvasOverlays();
      }
    });

    dom.chkApplyTextAllPages.addEventListener('change', (e) => {
      const item = getSelectedItem();
      if (item && item.type === 'text') {
        recordHistorySnapshot();
        item.allPages = e.target.checked;
        updateLayersList();
        renderCanvasOverlays();
      }
    });

    dom.textAlignButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        applyTextPresetToSelected(btn.dataset.pos);
      });
    });

    // Text Remove Buttons
    const removeSelectedText = () => {
      const item = getSelectedItem();
      if (item && item.type === 'text') {
        deleteItem(item.id);
      }
    };
    dom.btnRemoveTextFeature.addEventListener('click', removeSelectedText);
    dom.btnDirectRemoveText.addEventListener('click', removeSelectedText);

    // Global Keyboard Shortcuts (Undo, Redo, Navigation, Deletion)
    window.addEventListener('keydown', (e) => {
      // Undo: Ctrl+Z or Cmd+Z (without shift)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Y, Cmd+Y, or Ctrl+Shift+Z, Cmd+Shift+Z
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
        return;
      }

      if (e.target.matches('input, textarea, select')) return;

      if (e.key === 'ArrowLeft') {
        if (studioState.currentPage > 1) renderPage(studioState.currentPage - 1);
      } else if (e.key === 'ArrowRight') {
        if (studioState.currentPage < studioState.numPages) renderPage(studioState.currentPage + 1);
      } else if (e.key === '+' || e.key === '=') {
        zoomIn();
      } else if (e.key === '-') {
        zoomOut();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (studioState.selectedItemId) {
          deleteItem(studioState.selectedItemId);
        }
      }
    });
  }

  // =========================================================================
  // Utilities
  // =========================================================================
  function showLoader(msg) {
    dom.loaderMessage.textContent = msg || 'Loading...';
    dom.canvasLoader.style.display = 'flex';
  }

  function hideLoader() {
    dom.canvasLoader.style.display = 'none';
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function convertDataUrlToPngBlob(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        c.toBlob(blob => resolve(blob), 'image/png');
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function saveBlobWithPicker(blob, filename) {
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'PDF Document (*.pdf)',
            accept: {
              'application/pdf': ['.pdf']
            }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { success: true, name: handle.name || filename };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { cancelled: true };
        }
        console.warn('showSaveFilePicker fallback:', err);
      }
    }
    downloadBlob(blob, filename);
    return { success: true, name: filename };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

})();
