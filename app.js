/**
 * DocTument - Smart PDF Sorter & Merger
 * - Whole PDF Document grouping, natural numerical sorting, and drag-and-drop file rearranging.
 * - Dedicated Interactive PDF Editor Studio for each PDF (Add & Align Images on all/single pages, Edit & Whiteout Replace Text).
 * - Client-side in-browser PDF merging and ZIP export (100% private & offline).
 */

(function () {
  'use strict';

  // Configure PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  // =========================================================================
  // State Management
  // =========================================================================
  const state = {
    // Array of raw file objects with metadata
    allFiles: [],
    // Map of personName -> Array of file objects
    groups: new Map(),
    // Search / filter query
    searchQuery: '',
    // Accordion state: personName -> boolean (collapsed)
    collapsedGroups: new Set(),
    // File list drag tracking
    draggedItem: null,
    // Active object URLs for cleanup
    activeObjectUrls: new Set(),
    // Settings
    settings: {
      parseMode: 'smart', // 'smart', 'subfolder', 'delimiter', 'custom'
      delimiter: '_',
      customRegex: '^(.*?)[_\\s\\-]+(?:page|part)?\\s*(\\d+)',
      cleanWhitespace: true,
      titleCase: true,
      addPageNumbers: false,
      compressOutput: true
    }
  };

  // State for Modal 1: Person Documents Overview & Rearranging
  const docStudioState = {
    activePersonName: null,
    activeFiles: [],
    viewMode: 'grid', // 'grid' | 'full'
    draggedDocId: null,
    currentPreviewBlobUrl: null
  };

  // State for Modal 2: Dedicated Single PDF Editor
  const singlePdfEditState = {
    fileItem: null,
    personName: null,
    pdfjsDoc: null,
    numPages: 1,
    currentPage: 1,
    zoomScale: 1.0,
    hasUnsavedEdits: false,
    pageDimensions: { width: 595, height: 842 },

    // Image overlay
    image: {
      active: false,
      file: null,
      dataUrl: null,
      imgEl: null,
      naturalWidth: 100,
      naturalHeight: 100,
      scalePct: 40,
      opacityPct: 100,
      align: 'center', // 'top-left', 'top-center', 'top-right', 'mid-left', 'center', 'mid-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom'
      allPages: true, // "shown in all and every pages in pdf"
      relX: 0.5,
      relY: 0.5
    },

    // Text overlay
    text: {
      active: false,
      content: 'CONFIDENTIAL',
      fontSize: 16,
      color: 'dark',
      whiteout: false,
      allPages: false,
      relX: 0.5,
      relY: 0.2
    }
  };

  // State for Modal 3: Merge Confirmation & Location Selection
  const mergeConfirmState = {
    mode: 'single', // 'single' | 'zip'
    personName: null,
    files: [],
    suggestedFilename: ''
  };

  // =========================================================================
  // DOM Elements
  // =========================================================================
  const elements = {
    // Theme
    themeToggleBtn: document.getElementById('themeToggleBtn'),

    // Inputs & Drop Zone
    dropZone: document.getElementById('dropZone'),
    folderInput: document.getElementById('folderInput'),
    filesInput: document.getElementById('filesInput'),
    btnUploadFolder: document.getElementById('btnUploadFolder'),
    btnUploadFiles: document.getElementById('btnUploadFiles'),
    btnLoadDemo: document.getElementById('btnLoadDemo'),

    // Settings
    settingsToggle: document.getElementById('settingsToggle'),
    settingsBody: document.getElementById('settingsBody'),
    parseModeSelect: document.getElementById('parseModeSelect'),
    parseModeHint: document.getElementById('parseModeHint'),
    delimiterGroup: document.getElementById('delimiterGroup'),
    delimiterInput: document.getElementById('delimiterInput'),
    customRegexGroup: document.getElementById('customRegexGroup'),
    customRegexInput: document.getElementById('customRegexInput'),
    chkCleanWhitespace: document.getElementById('chkCleanWhitespace'),
    chkTitleCase: document.getElementById('chkTitleCase'),
    chkAddPageNumbers: document.getElementById('chkAddPageNumbers'),
    chkCompressOutput: document.getElementById('chkCompressOutput'),
    btnReparse: document.getElementById('btnReparse'),

    // Workspace & Summary
    workspaceSection: document.getElementById('workspaceSection'),
    emptyGuideSection: document.getElementById('emptyGuideSection'),
    metricPersons: document.getElementById('metricPersons'),
    metricFiles: document.getElementById('metricFiles'),
    metricStatus: document.getElementById('metricStatus'),
    searchInput: document.getElementById('searchInput'),
    btnClearSearch: document.getElementById('btnClearSearch'),
    btnSortAll: document.getElementById('btnSortAll'),
    btnToggleAllCards: document.getElementById('btnToggleAllCards'),
    toggleAllText: document.getElementById('toggleAllText'),
    btnMergeAllZip: document.getElementById('btnMergeAllZip'),
    btnClearAll: document.getElementById('btnClearAll'),
    groupsContainer: document.getElementById('groupsContainer'),

    // MODAL 1: Person Documents Overview & Rearrange Studio
    previewModal: document.getElementById('previewModal'),
    previewModalTitle: document.getElementById('previewModalTitle'),
    previewModalSub: document.getElementById('previewModalSub'),
    editorDocCountBadge: document.getElementById('editorDocCountBadge'),
    btnViewGrid: document.getElementById('btnViewGrid'),
    btnViewFull: document.getElementById('btnViewFull'),
    btnSaveEditedPdf: document.getElementById('btnSaveEditedPdf'),
    btnClosePreviewModal: document.getElementById('btnClosePreviewModal'),
    btnSortDocsNumerically: document.getElementById('btnSortDocsNumerically'),
    btnReverseDocs: document.getElementById('btnReverseDocs'),
    btnOverviewEditAll: document.getElementById('btnOverviewEditAll'),
    editorDocGridContainer: document.getElementById('editorDocGridContainer'),
    editorFullPreviewContainer: document.getElementById('editorFullPreviewContainer'),
    previewIframe: document.getElementById('previewIframe'),
    studioLoading: document.getElementById('studioLoading'),
    studioLoadingText: document.getElementById('studioLoadingText'),
    editorStatusMsg: document.getElementById('editorStatusMsg'),
    editorTotalPagesCount: document.getElementById('editorTotalPagesCount'),

    // MODAL 2: Dedicated PDF Editor Studio
    pdfEditorModal: document.getElementById('pdfEditorModal'),
    pdfEditorTitle: document.getElementById('pdfEditorTitle'),
    pdfEditorSub: document.getElementById('pdfEditorSub'),
    pdfEditorPageBadge: document.getElementById('pdfEditorPageBadge'),
    btnSavePdfEdits: document.getElementById('btnSavePdfEdits'),
    btnDownloadSingleEditedPdf: document.getElementById('btnDownloadSingleEditedPdf'),
    btnHeaderOpenFullscreen: document.getElementById('btnHeaderOpenFullscreen'),
    btnToolbarOpenFullscreen: document.getElementById('btnToolbarOpenFullscreen'),
    btnClosePdfEditor: document.getElementById('btnClosePdfEditor'),
    pdfAddImageInput: document.getElementById('pdfAddImageInput'),
    btnTriggerAddImage: document.getElementById('btnTriggerAddImage'),
    btnTriggerAddText: document.getElementById('btnTriggerAddText'),
    btnPdfPrevPage: document.getElementById('btnPdfPrevPage'),
    btnPdfNextPage: document.getElementById('btnPdfNextPage'),
    pdfPageNavIndicator: document.getElementById('pdfPageNavIndicator'),

    // Image Drawer
    imageEditDrawer: document.getElementById('imageEditDrawer'),
    imageDrawerTitle: document.getElementById('imageDrawerTitle'),
    btnRemoveImage: document.getElementById('btnRemoveImage'),
    sliderImageScale: document.getElementById('sliderImageScale'),
    lblImageScale: document.getElementById('lblImageScale'),
    sliderImageOpacity: document.getElementById('sliderImageOpacity'),
    lblImageOpacity: document.getElementById('lblImageOpacity'),
    chkImageAllPages: document.getElementById('chkImageAllPages'),

    // Text Drawer
    textEditDrawer: document.getElementById('textEditDrawer'),
    txtEditContent: document.getElementById('txtEditContent'),
    selTextFontSize: document.getElementById('selTextFontSize'),
    selTextColor: document.getElementById('selTextColor'),
    chkTextWhiteout: document.getElementById('chkTextWhiteout'),
    chkTextAllPages: document.getElementById('chkTextAllPages'),
    btnRemoveText: document.getElementById('btnRemoveText'),

    // Stage
    pdfEditorLoading: document.getElementById('pdfEditorLoading'),
    pdfEditorLoadingText: document.getElementById('pdfEditorLoadingText'),
    pdfStageContainer: document.getElementById('pdfStageContainer'),
    pdfCanvasWrapper: document.getElementById('pdfCanvasWrapper'),
    pdfActivePageCanvas: document.getElementById('pdfActivePageCanvas'),
    pdfOverlayLayer: document.getElementById('pdfOverlayLayer'),
    imageOverlayElement: document.getElementById('imageOverlayElement'),
    imageOverlayImg: document.getElementById('imageOverlayImg'),
    imageOverlayBadge: document.getElementById('imageOverlayBadge'),
    textOverlayElement: document.getElementById('textOverlayElement'),
    textOverlaySpan: document.getElementById('textOverlaySpan'),
    pdfEditorStatusMsg: document.getElementById('pdfEditorStatusMsg'),
    pdfEditorChangesBadge: document.getElementById('pdfEditorChangesBadge'),

    // Progress Modal & Toasts
    progressModal: document.getElementById('progressModal'),
    progressModalTitle: document.getElementById('progressModalTitle'),
    progressStatusText: document.getElementById('progressStatusText'),
    progressPercentageText: document.getElementById('progressPercentageText'),
    progressBarFill: document.getElementById('progressBarFill'),
    progressDetailText: document.getElementById('progressDetailText'),
    toastContainer: document.getElementById('toastContainer'),

    // Merge Confirmation & Location Modal
    mergeConfirmModal: document.getElementById('mergeConfirmModal'),
    mergeConfirmTitle: document.getElementById('mergeConfirmTitle'),
    mergeConfirmDescription: document.getElementById('mergeConfirmDescription'),
    lblConfirmPersonName: document.getElementById('lblConfirmPersonName'),
    txtConfirmFilename: document.getElementById('txtConfirmFilename'),
    lblConfirmHint: document.getElementById('lblConfirmHint'),
    lblConfirmLocationNote: document.getElementById('lblConfirmLocationNote'),
    lblConfirmButtonText: document.getElementById('lblConfirmButtonText'),
    btnCloseMergeConfirm: document.getElementById('btnCloseMergeConfirm'),
    btnCancelMergeConfirm: document.getElementById('btnCancelMergeConfirm'),
    btnExecuteMergeConfirm: document.getElementById('btnExecuteMergeConfirm')
  };

  // =========================================================================
  // Initialization
  // =========================================================================
  function init() {
    initTheme();
    bindEventListeners();
    updateSettingsVisibility();
  }

  function initTheme() {
    const savedTheme = localStorage.getItem('pdf_sorter_theme') || 'theme-light';
    document.body.className = savedTheme;
  }

  function toggleTheme() {
    const isDark = document.body.classList.contains('theme-dark');
    const newTheme = isDark ? 'theme-light' : 'theme-dark';
    document.body.className = newTheme;
    localStorage.setItem('pdf_sorter_theme', newTheme);
  }

  // =========================================================================
  // Event Listeners
  // =========================================================================
  function bindEventListeners() {
    // Theme toggle
    elements.themeToggleBtn.addEventListener('click', toggleTheme);

    // Upload buttons
    elements.btnUploadFolder.addEventListener('click', () => elements.folderInput.click());
    elements.btnUploadFiles.addEventListener('click', () => elements.filesInput.click());
    elements.btnLoadDemo.addEventListener('click', loadDemoDocuments);

    elements.folderInput.addEventListener('change', handleFileInputChange);
    elements.filesInput.addEventListener('change', handleFileInputChange);

    // Drop zone drag and drop
    ['dragenter', 'dragover'].forEach(eventName => {
      elements.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        elements.dropZone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      elements.dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        elements.dropZone.classList.remove('drag-active');
      });
    });

    elements.dropZone.addEventListener('drop', handleDrop);

    // Settings Toggle & Changes
    elements.settingsToggle.addEventListener('click', () => {
      elements.settingsToggle.classList.toggle('active');
      elements.settingsBody.classList.toggle('active');
    });

    elements.parseModeSelect.addEventListener('change', () => {
      state.settings.parseMode = elements.parseModeSelect.value;
      updateSettingsVisibility();
    });

    elements.delimiterInput.addEventListener('input', (e) => {
      state.settings.delimiter = e.target.value;
    });

    elements.customRegexInput.addEventListener('input', (e) => {
      state.settings.customRegex = e.target.value;
    });

    elements.chkCleanWhitespace.addEventListener('change', (e) => {
      state.settings.cleanWhitespace = e.target.checked;
    });

    elements.chkTitleCase.addEventListener('change', (e) => {
      state.settings.titleCase = e.target.checked;
    });

    elements.chkAddPageNumbers.addEventListener('change', (e) => {
      state.settings.addPageNumbers = e.target.checked;
    });

    elements.chkCompressOutput.addEventListener('change', (e) => {
      state.settings.compressOutput = e.target.checked;
    });

    elements.btnReparse.addEventListener('click', reparseAllFiles);

    // Search & Filter
    elements.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      elements.btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
      renderGroups();
    });

    elements.btnClearSearch.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.searchQuery = '';
      elements.btnClearSearch.style.display = 'none';
      renderGroups();
    });

    // Batch Actions
    elements.btnSortAll.addEventListener('click', sortAllGroups);
    elements.btnToggleAllCards.addEventListener('click', toggleAllCards);
    elements.btnMergeAllZip.addEventListener('click', promptMergeAllAndZip);
    elements.btnClearAll.addEventListener('click', clearAllData);

    // Modal 1: Person Documents Studio Events
    elements.btnClosePreviewModal.addEventListener('click', closePersonDocumentsStudio);
    elements.previewModal.addEventListener('click', (e) => {
      if (e.target === elements.previewModal) closePersonDocumentsStudio();
    });

    elements.btnViewGrid.addEventListener('click', () => switchDocStudioView('grid'));
    elements.btnViewFull.addEventListener('click', () => switchDocStudioView('full'));

    elements.btnSortDocsNumerically.addEventListener('click', () => {
      sortFileListNumerically(docStudioState.activeFiles);
      renderDocGrid();
      showToast('Documents sorted in natural numerical order', 'info');
    });

    elements.btnReverseDocs.addEventListener('click', () => {
      docStudioState.activeFiles.reverse();
      renderDocGrid();
      showToast('Document order reversed', 'info');
    });

    elements.btnSaveEditedPdf.addEventListener('click', () => {
      promptMergeAndDownload(docStudioState.activePersonName, docStudioState.activeFiles);
    });

    // Fullscreen Studio Openers ("Edit All (Open in New Page)")
    if (elements.btnOverviewEditAll) {
      elements.btnOverviewEditAll.addEventListener('click', () => {
        openFullscreenStudio(null, docStudioState.activePersonName);
      });
    }

    if (elements.btnHeaderOpenFullscreen) {
      elements.btnHeaderOpenFullscreen.addEventListener('click', () => {
        openFullscreenStudio(singlePdfEditState.fileItem, singlePdfEditState.personName);
      });
    }

    if (elements.btnToolbarOpenFullscreen) {
      elements.btnToolbarOpenFullscreen.addEventListener('click', () => {
        openFullscreenStudio(singlePdfEditState.fileItem, singlePdfEditState.personName);
      });
    }

    // Modal 2: Dedicated PDF Editor Events
    elements.btnClosePdfEditor.addEventListener('click', closeSinglePdfEditor);
    elements.pdfEditorModal.addEventListener('click', (e) => {
      if (e.target === elements.pdfEditorModal) closeSinglePdfEditor();
    });

    elements.btnPdfPrevPage.addEventListener('click', goToPrevEditorPage);
    elements.btnPdfNextPage.addEventListener('click', goToNextEditorPage);

    elements.btnTriggerAddImage.addEventListener('click', () => elements.pdfAddImageInput.click());
    elements.pdfAddImageInput.addEventListener('change', handleEditorImageUpload);

    elements.btnTriggerAddText.addEventListener('click', toggleTextDrawer);

    // Alignment Preset Buttons
    document.querySelectorAll('.btn-align-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const align = btn.dataset.align;
        applyImageAlignPreset(align);
      });
    });

    // Sliders
    elements.sliderImageScale.addEventListener('input', (e) => {
      const scale = parseInt(e.target.value, 10);
      singlePdfEditState.image.scalePct = scale;
      elements.lblImageScale.textContent = `${scale}%`;
      updateImageOverlayStyle();
    });

    elements.sliderImageOpacity.addEventListener('input', (e) => {
      const opacity = parseInt(e.target.value, 10);
      singlePdfEditState.image.opacityPct = opacity;
      elements.lblImageOpacity.textContent = `${opacity}%`;
      updateImageOverlayStyle();
    });

    // Scope Checkboxes
    elements.chkImageAllPages.addEventListener('change', (e) => {
      singlePdfEditState.image.allPages = e.target.checked;
      elements.imageOverlayBadge.textContent = e.target.checked ? 'All Pages' : `Page ${singlePdfEditState.currentPage}`;
    });

    elements.chkTextAllPages.addEventListener('change', (e) => {
      singlePdfEditState.text.allPages = e.target.checked;
    });

    elements.chkTextWhiteout.addEventListener('change', (e) => {
      singlePdfEditState.text.whiteout = e.target.checked;
      updateTextOverlayStyle();
    });

    elements.txtEditContent.addEventListener('input', (e) => {
      singlePdfEditState.text.content = e.target.value;
      elements.textOverlaySpan.textContent = e.target.value || ' ';
    });

    elements.selTextFontSize.addEventListener('change', (e) => {
      singlePdfEditState.text.fontSize = parseInt(e.target.value, 10);
      updateTextOverlayStyle();
    });

    elements.selTextColor.addEventListener('change', (e) => {
      singlePdfEditState.text.color = e.target.value;
      updateTextOverlayStyle();
    });

    elements.btnRemoveImage.addEventListener('click', removeActiveImageOverlay);
    elements.btnRemoveText.addEventListener('click', removeActiveTextOverlay);

    // Save & Download from Editor
    elements.btnSavePdfEdits.addEventListener('click', savePdfEdits);
    elements.btnDownloadSingleEditedPdf.addEventListener('click', downloadSingleEditedPdf);

    // Draggable Overlays on Canvas
    initOverlayDragHandlers();

    // Modal 3: Merge Confirmation & Location Windows Picker
    if (elements.btnCloseMergeConfirm) {
      elements.btnCloseMergeConfirm.addEventListener('click', closeMergeConfirmModal);
    }
    if (elements.btnCancelMergeConfirm) {
      elements.btnCancelMergeConfirm.addEventListener('click', closeMergeConfirmModal);
    }
    if (elements.mergeConfirmModal) {
      elements.mergeConfirmModal.addEventListener('click', (e) => {
        if (e.target === elements.mergeConfirmModal) closeMergeConfirmModal();
      });
    }
    if (elements.btnExecuteMergeConfirm) {
      elements.btnExecuteMergeConfirm.addEventListener('click', executeMergeConfirm);
    }
    if (elements.txtConfirmFilename) {
      elements.txtConfirmFilename.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          executeMergeConfirm();
        }
      });
    }

    // Keyboard ESC closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (elements.mergeConfirmModal && elements.mergeConfirmModal.style.display !== 'none') {
          closeMergeConfirmModal();
        } else if (elements.pdfEditorModal && elements.pdfEditorModal.style.display !== 'none') {
          closeSinglePdfEditor();
        } else if (elements.previewModal && elements.previewModal.style.display !== 'none') {
          closePersonDocumentsStudio();
        }
      }
    });
  }

  function updateSettingsVisibility() {
    const mode = state.settings.parseMode;
    elements.delimiterGroup.style.display = (mode === 'delimiter') ? 'flex' : 'none';
    elements.customRegexGroup.style.display = (mode === 'custom') ? 'flex' : 'none';

    if (mode === 'smart') {
      elements.parseModeHint.textContent = 'Auto-detects Person Name followed by numbers/parts (e.g. "John_Doe_01", "Bob - Part 2", "Alice (1)").';
    } else if (mode === 'subfolder') {
      elements.parseModeHint.textContent = 'Uses the immediate directory name containing each file as the person name.';
    } else if (mode === 'delimiter') {
      elements.parseModeHint.textContent = 'Splits filename on delimiter. The prefix becomes the person name.';
    } else if (mode === 'custom') {
      elements.parseModeHint.textContent = 'Uses regular expression: Group 1 matches person name, Group 2 matches file sequence number.';
    }
  }

  // =========================================================================
  // Filename Parsing & Normalization Engine
  // =========================================================================
  function parseFileMetadata(file, relativePath = '') {
    const fullName = file.name;
    const extMatch = fullName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : '';
    const baseName = fullName.replace(/\.[^/.]+$/, '');
    const pathStr = relativePath || file.webkitRelativePath || '';

    let personName = baseName;
    let pageNumber = null;

    const mode = state.settings.parseMode;

    if (mode === 'subfolder' && pathStr) {
      const parts = pathStr.split(/[/\\]/);
      if (parts.length > 1) {
        personName = parts[parts.length - 2];
        pageNumber = extractPageNumberFromStr(baseName);
      } else {
        const res = parseSmart(baseName);
        personName = res.personName;
        pageNumber = res.pageNumber;
      }
    } else if (mode === 'delimiter') {
      const delim = state.settings.delimiter || '_';
      const delimIndex = baseName.indexOf(delim);
      if (delimIndex !== -1) {
        personName = baseName.substring(0, delimIndex);
        const remainder = baseName.substring(delimIndex + delim.length);
        pageNumber = extractPageNumberFromStr(remainder);
      } else {
        const res = parseSmart(baseName);
        personName = res.personName;
        pageNumber = res.pageNumber;
      }
    } else if (mode === 'custom') {
      try {
        const regex = new RegExp(state.settings.customRegex || '^(.*?)[_\\s\\-]+(\\d+)', 'i');
        const match = baseName.match(regex);
        if (match) {
          if (match[1]) personName = match[1];
          if (match[2]) pageNumber = parseInt(match[2], 10);
        } else {
          const res = parseSmart(baseName);
          personName = res.personName;
          pageNumber = res.pageNumber;
        }
      } catch (err) {
        console.warn('Invalid custom regex:', err);
        const res = parseSmart(baseName);
        personName = res.personName;
        pageNumber = res.pageNumber;
      }
    } else {
      const res = parseSmart(baseName);
      personName = res.personName;
      pageNumber = res.pageNumber;
    }

    personName = normalizePersonName(personName);

    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) || file.type.startsWith('image/');

    return {
      id: 'file_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
      file: file,
      name: file.name,
      baseName: baseName,
      ext: ext,
      path: pathStr,
      size: file.size,
      personName: personName || 'Unassigned',
      pageNumber: pageNumber,
      isPdf: isPdf,
      isImage: isImage,
      type: file.type,
      pageCount: isPdf ? 1 : 1, // updated dynamically when previewed
      coverCanvas: null
    };
  }

  function parseSmart(baseName) {
    const patterns = [
      /^(.*?)[_\s\-\.]+[\(\[]\s*(\d+)\s*[\)\]]$/i,
      /^(.*?)[_\s\-\.]+(?:page|part|vol|volume|v|p|no|num|#)[_\s\-\.]*(\d+)$/i,
      /^(.*?)[_\s\-\.]+(\d+)$/i,
      /^([a-zA-Z\s]+?)(\d+)$/i
    ];

    let personName = baseName;
    let pageNumber = null;

    for (const pattern of patterns) {
      const match = baseName.match(pattern);
      if (match) {
        personName = match[1];
        pageNumber = parseInt(match[2], 10);
        break;
      }
    }

    return { personName, pageNumber };
  }

  function extractPageNumberFromStr(str) {
    const numMatch = str.match(/\b(\d+)\b/) || str.match(/(\d+)/);
    return numMatch ? parseInt(numMatch[1], 10) : null;
  }

  function normalizePersonName(name) {
    let clean = name || '';

    if (state.settings.cleanWhitespace) {
      clean = clean.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (state.settings.titleCase && clean) {
      if (clean === clean.toUpperCase() || clean === clean.toLowerCase()) {
        clean = clean.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      }
    }

    return clean.trim();
  }

  // =========================================================================
  // File Intake Handling
  // =========================================================================
  async function handleFileInputChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processIncomingFiles(files);
    e.target.value = '';
  }

  async function handleDrop(e) {
    const dt = e.dataTransfer;
    if (!dt) return;

    let files = [];

    if (dt.items && dt.items.length > 0 && typeof dt.items[0].webkitGetAsEntry === 'function') {
      const entries = [];
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
      }
      files = await scanEntries(entries);
    } else if (dt.files && dt.files.length > 0) {
      files = Array.from(dt.files);
    }

    if (files.length > 0) {
      await processIncomingFiles(files);
    }
  }

  async function scanEntries(entries) {
    const files = [];

    async function traverse(entry, path = '') {
      if (entry.isFile) {
        return new Promise(resolve => {
          entry.file(f => {
            Object.defineProperty(f, 'webkitRelativePath', {
              value: path + f.name,
              writable: false
            });
            files.push(f);
            resolve();
          }, () => resolve());
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readAllEntries = () => new Promise(resolve => {
          dirReader.readEntries(async (subEntries) => {
            if (subEntries.length === 0) {
              resolve();
            } else {
              for (const sub of subEntries) {
                await traverse(sub, path + entry.name + '/');
              }
              await readAllEntries();
              resolve();
            }
          }, () => resolve());
        });
        await readAllEntries();
      }
    }

    for (const entry of entries) {
      await traverse(entry);
    }

    return files;
  }

  async function processIncomingFiles(rawFiles) {
    let supportedCount = 0;
    let skippedCount = 0;

    const newParsedFiles = [];

    for (const file of rawFiles) {
      const isPdf = file.name.match(/\.pdf$/i) || file.type === 'application/pdf';
      const isImg = file.name.match(/\.(png|jpe?g|webp)$/i) || file.type.startsWith('image/');

      if (isPdf || isImg) {
        const meta = parseFileMetadata(file, file.webkitRelativePath);
        newParsedFiles.push(meta);
        supportedCount++;
      } else {
        skippedCount++;
      }
    }

    if (supportedCount === 0) {
      showToast('No supported PDF or image files found in upload.', 'error');
      return;
    }

    state.allFiles = state.allFiles.concat(newParsedFiles);
    buildGroupsFromAllFiles();

    let msg = `Loaded ${supportedCount} file${supportedCount === 1 ? '' : 's'} across ${state.groups.size} person group${state.groups.size === 1 ? '' : 's'}.`;
    if (skippedCount > 0) {
      msg += ` (${skippedCount} non-document files skipped)`;
    }
    showToast(msg, 'success');

    updateWorkspaceUI();
  }

  // =========================================================================
  // Grouping & Sorting
  // =========================================================================
  function buildGroupsFromAllFiles() {
    const groupsMap = new Map();

    for (const item of state.allFiles) {
      const pName = item.personName || 'Unassigned';
      if (!groupsMap.has(pName)) {
        groupsMap.set(pName, []);
      }
      groupsMap.get(pName).push(item);
    }

    groupsMap.forEach((fileList) => {
      sortFileListNumerically(fileList);
    });

    state.groups = groupsMap;
  }

  function sortFileListNumerically(fileList) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    fileList.sort((a, b) => {
      if (a.pageNumber !== null && b.pageNumber !== null) {
        if (a.pageNumber !== b.pageNumber) {
          return a.pageNumber - b.pageNumber;
        }
      }
      if (a.pageNumber !== null && b.pageNumber === null) return -1;
      if (a.pageNumber === null && b.pageNumber !== null) return 1;

      return collator.compare(a.name, b.name);
    });
  }

  function sortAllGroups() {
    state.groups.forEach((fileList) => {
      sortFileListNumerically(fileList);
    });
    renderGroups();
    showToast('All groups re-sorted in natural numerical order (1 → N)', 'info');
  }

  function reparseAllFiles() {
    if (state.allFiles.length === 0) {
      showToast('No files loaded to re-parse.', 'info');
      return;
    }

    state.allFiles.forEach(item => {
      const parsed = parseFileMetadata(item.file, item.path);
      item.personName = parsed.personName;
      item.pageNumber = parsed.pageNumber;
    });

    buildGroupsFromAllFiles();
    updateWorkspaceUI();
    showToast(`Re-parsed ${state.allFiles.length} files according to updated rules.`, 'success');
  }

  // =========================================================================
  // Demo Documents Generator
  // =========================================================================
  async function loadDemoDocuments() {
    if (typeof PDFLib === 'undefined') {
      showToast('PDF-Lib library is loading, please wait a moment...', 'info');
      return;
    }

    elements.btnLoadDemo.disabled = true;
    showToast('Generating sample documents in memory...', 'info');

    try {
      const demoSets = [
        { name: 'Thilo', page: 1, total: 3, file: 'thilo 1.png', isImage: true },
        { name: 'Thilo', page: 2, total: 3, file: 'thilo 2.pdf', pagesCount: 2, color: [0.2, 0.45, 0.9] },
        { name: 'Thilo', page: 3, total: 3, file: 'thilo 3.pdf', pagesCount: 3, color: [0.15, 0.68, 0.38] },
        { name: 'Thilo', page: 4, total: 3, file: 'thilo 4.pdf', pagesCount: 13, color: [0.55, 0.27, 0.68] }
      ];

      const generatedFiles = [];

      for (const item of demoSets) {
        if (item.isImage) {
          // Generate demo PNG image via canvas
          const c = document.createElement('canvas');
          c.width = 600;
          c.height = 400;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, 600, 400);
          ctx.fillStyle = '#6366f1';
          ctx.fillRect(20, 20, 560, 360);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 32px sans-serif';
          ctx.fillText('SAMPLE CERTIFICATE', 60, 100);
          ctx.font = '20px sans-serif';
          ctx.fillText('Issued to: ' + item.name, 60, 160);
          ctx.fillText('Document: ' + item.file, 60, 210);

          const blob = await new Promise(res => c.toBlob(res, 'image/png'));
          generatedFiles.push(new File([blob], item.file, { type: 'image/png' }));
        } else {
          // Generate multi-page PDF
          const doc = await PDFLib.PDFDocument.create();
          const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
          const regularFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica);

          const count = item.pagesCount || 2;
          for (let p = 1; p <= count; p++) {
            const page = doc.addPage([595.28, 841.89]);
            const { width, height } = page.getSize();

            page.drawRectangle({
              x: 0,
              y: height - 80,
              width: width,
              height: 80,
              color: PDFLib.rgb(item.color[0], item.color[1], item.color[2])
            });

            page.drawText(`${item.name} - ${item.file}`, {
              x: 40,
              y: height - 50,
              size: 20,
              font: font,
              color: PDFLib.rgb(1, 1, 1)
            });

            page.drawText(`Page ${p} of ${count}`, {
              x: 40,
              y: height - 70,
              size: 12,
              font: regularFont,
              color: PDFLib.rgb(0.9, 0.9, 0.9)
            });

            page.drawRectangle({
              x: 40,
              y: 100,
              width: width - 80,
              height: height - 210,
              color: PDFLib.rgb(0.98, 0.98, 0.99),
              borderColor: PDFLib.rgb(0.85, 0.85, 0.88),
              borderWidth: 1
            });

            page.drawText(`Content for ${item.file} - Page ${p}`, {
              x: 65,
              y: height - 150,
              size: 16,
              font: font,
              color: PDFLib.rgb(0.2, 0.2, 0.3)
            });

            page.drawText('This PDF can be edited individually! Click "Edit PDF" to add images or edit text.', {
              x: 65,
              y: height - 190,
              size: 12,
              font: regularFont,
              color: PDFLib.rgb(0.4, 0.4, 0.5)
            });
          }

          const pdfBytes = await doc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          generatedFiles.push(new File([blob], item.file, { type: 'application/pdf' }));
        }
      }

      await processIncomingFiles(generatedFiles);
    } catch (err) {
      console.error('Error generating demo documents:', err);
      showToast('Failed to generate demo documents: ' + err.message, 'error');
    } finally {
      elements.btnLoadDemo.disabled = false;
    }
  }

  // =========================================================================
  // Workspace UI & Group Rendering
  // =========================================================================
  function updateWorkspaceUI() {
    const hasFiles = state.allFiles.length > 0;
    elements.workspaceSection.style.display = hasFiles ? 'flex' : 'none';
    elements.emptyGuideSection.style.display = hasFiles ? 'none' : 'block';

    if (!hasFiles) return;

    elements.metricPersons.textContent = state.groups.size;
    elements.metricFiles.textContent = state.allFiles.length;

    renderGroups();
  }

  function renderGroups() {
    elements.groupsContainer.innerHTML = '';

    const query = state.searchQuery;
    let visibleGroupCount = 0;

    const sortedGroups = Array.from(state.groups.entries()).sort((a, b) => {
      return a[0].localeCompare(b[0]);
    });

    sortedGroups.forEach(([personName, files]) => {
      const matchesPerson = personName.toLowerCase().includes(query);
      const matchesFiles = files.some(f => f.name.toLowerCase().includes(query));

      if (query && !matchesPerson && !matchesFiles) {
        return;
      }

      visibleGroupCount++;
      const isCollapsed = state.collapsedGroups.has(personName);

      const card = createPersonCard(personName, files, isCollapsed);
      elements.groupsContainer.appendChild(card);
    });

    if (visibleGroupCount === 0 && query) {
      const emptySearch = document.createElement('div');
      emptySearch.className = 'empty-search-msg';
      emptySearch.style.textAlign = 'center';
      emptySearch.style.padding = '3rem 1rem';
      emptySearch.style.color = 'var(--text-muted)';
      emptySearch.innerHTML = `<p>No persons or files found matching <strong>"${escapeHtml(query)}"</strong></p>`;
      elements.groupsContainer.appendChild(emptySearch);
    }
  }

  function createPersonCard(personName, files, isCollapsed) {
    const card = document.createElement('div');
    card.className = 'person-card';
    card.dataset.person = personName;

    const avatarBg = generateAvatarColor(personName);
    const initials = getInitials(personName);

    const header = document.createElement('div');
    header.className = 'person-header';
    header.innerHTML = `
      <div class="person-info">
        <div class="person-avatar" style="background-color: ${avatarBg}">${escapeHtml(initials)}</div>
        <div class="person-title-wrap">
          <div class="person-name-group">
            <h3 class="person-name" title="Click to rename person">${escapeHtml(personName)}</h3>
            <button class="icon-btn btn-xs btn-edit-name" title="Rename Person" aria-label="Rename">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
          </div>
          <div class="person-meta">
            <span class="badge badge-count">${files.length} Document${files.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      <div class="person-actions">
        <button class="btn btn-secondary btn-sm btn-sort-group" title="Sort this person's files in natural numerical order">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M6 12h12m-9 6h6"></path>
          </svg>
          <span>Sort 1&rarr;N</span>
        </button>

        <button class="btn btn-primary btn-sm btn-preview-studio" title="Preview whole PDF files, rearrange by dragging, or edit PDFs">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
          <span>Preview &amp; Rearrange</span>
        </button>

        <button class="btn btn-success btn-sm btn-merge-download" title="Merge and download this person's PDF">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Merge PDF</span>
        </button>

        <button class="icon-btn btn-delete-group" title="Remove this person and their files" aria-label="Delete Group">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
          </svg>
        </button>

        <button class="icon-btn btn-collapse-toggle" title="Collapse / Expand list" aria-label="Toggle Expand">
          <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: ${isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)'}">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
    `;

    card.appendChild(header);

    const body = document.createElement('div');
    body.className = `person-body ${isCollapsed ? 'collapsed' : ''}`;
    body.dataset.person = personName;

    attachGroupBodyDragEvents(body, personName);

    files.forEach((fileItem, index) => {
      const fileRow = createFileRow(fileItem, index, files.length, personName);
      body.appendChild(fileRow);
    });

    card.appendChild(body);
    attachHeaderEvents(header, personName, files, isCollapsed);

    return card;
  }

  function createFileRow(fileItem, index, totalFiles, personName) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.draggable = true;
    item.dataset.fileId = fileItem.id;
    item.dataset.person = personName;
    item.dataset.index = index;

    const isFirst = index === 0;
    const isLast = index === totalFiles - 1;

    const fileIconSvg = fileItem.isPdf
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
           <polyline points="14 2 14 8 20 8"></polyline>
         </svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
           <circle cx="8.5" cy="8.5" r="1.5"></circle>
           <polyline points="21 15 16 10 5 21"></polyline>
         </svg>`;

    const pageTagHtml = fileItem.pageNumber !== null
      ? `<span class="page-tag" title="Parsed index: ${fileItem.pageNumber}">Num: #${fileItem.pageNumber}</span>`
      : '';

    const allPersons = Array.from(state.groups.keys());
    let moveOptionsHtml = `<option value="" disabled selected>Move to...</option>`;
    allPersons.forEach(p => {
      if (p !== personName) {
        moveOptionsHtml += `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`;
      }
    });
    moveOptionsHtml += `<option value="__NEW__">+ New Person...</option>`;

    item.innerHTML = `
      <div class="drag-handle" title="Drag to reorder file">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="9" cy="5" r="1"></circle>
          <circle cx="9" cy="12" r="1"></circle>
          <circle cx="9" cy="19" r="1"></circle>
          <circle cx="15" cy="5" r="1"></circle>
          <circle cx="15" cy="12" r="1"></circle>
          <circle cx="15" cy="19" r="1"></circle>
        </svg>
      </div>

      <div class="item-index-badge" title="File sequence position">#${index + 1}</div>

      <div class="file-type-icon ${fileItem.isPdf ? 'file-type-pdf' : 'file-type-img'}">
        ${fileIconSvg}
      </div>

      <div class="file-info">
        <span class="file-name" title="${escapeHtml(fileItem.name)}">${escapeHtml(fileItem.name)}</span>
        <div class="file-meta-row">
          <span>${formatBytes(fileItem.size)}</span>
          ${pageTagHtml}
        </div>
      </div>

      <div class="file-controls">
        <button class="btn btn-secondary btn-xs btn-open-edit-pdf" title="Edit this PDF: Add images, align &amp; edit text">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          <span>Edit PDF</span>
        </button>

        <div class="reorder-btns">
          <button class="reorder-btn btn-move-up" ${isFirst ? 'disabled' : ''} title="Move Up (▲)" aria-label="Move Up">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </button>
          <button class="reorder-btn btn-move-down" ${isLast ? 'disabled' : ''} title="Move Down (▼)" aria-label="Move Down">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
        </div>

        <select class="move-select" title="Move file to another person" aria-label="Move to person">
          ${moveOptionsHtml}
        </select>

        <button class="icon-btn btn-remove-file" title="Remove file" aria-label="Remove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    attachFileItemEvents(item, fileItem, index, personName);
    return item;
  }

  function attachFileItemEvents(rowElement, fileItem, index, personName) {
    rowElement.addEventListener('dragstart', (e) => {
      state.draggedItem = {
        fileId: fileItem.id,
        fromPerson: personName,
        fromIndex: index
      };
      rowElement.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', fileItem.id);
    });

    rowElement.addEventListener('dragend', () => {
      rowElement.classList.remove('dragging');
      clearAllDragHoverStates();
      state.draggedItem = null;
    });

    rowElement.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      if (!state.draggedItem) return;

      const rect = rowElement.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      rowElement.classList.remove('drag-over-top', 'drag-over-bottom');
      if (e.clientY < midY) {
        rowElement.classList.add('drag-over-top');
      } else {
        rowElement.classList.add('drag-over-bottom');
      }
    });

    rowElement.addEventListener('dragleave', (e) => {
      if (!rowElement.contains(e.relatedTarget)) {
        rowElement.classList.remove('drag-over-top', 'drag-over-bottom');
      }
    });

    rowElement.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const dragged = state.draggedItem;
      if (!dragged) return;

      const rect = rowElement.getBoundingClientRect();
      const insertBefore = e.clientY < (rect.top + rect.height / 2);

      let targetIndex = index;
      if (!insertBefore) targetIndex += 1;

      executeMoveFile(dragged.fromPerson, dragged.fileId, personName, targetIndex);
    });

    const btnUp = rowElement.querySelector('.btn-move-up');
    const btnDown = rowElement.querySelector('.btn-move-down');
    const btnOpenEdit = rowElement.querySelector('.btn-open-edit-pdf');
    const btnRemove = rowElement.querySelector('.btn-remove-file');
    const selectMove = rowElement.querySelector('.move-select');

    if (btnUp) {
      btnUp.addEventListener('click', () => {
        executeReorderInGroup(personName, index, index - 1);
      });
    }

    if (btnDown) {
      btnDown.addEventListener('click', () => {
        executeReorderInGroup(personName, index, index + 1);
      });
    }

    if (btnOpenEdit) {
      btnOpenEdit.addEventListener('click', () => {
        openSinglePdfEditor(fileItem, personName);
      });
    }

    if (btnRemove) {
      btnRemove.addEventListener('click', () => {
        removeFileFromGroup(personName, fileItem.id);
      });
    }

    if (selectMove) {
      selectMove.addEventListener('change', (e) => {
        const targetPerson = e.target.value;
        if (targetPerson === '__NEW__') {
          const newName = prompt('Enter new person name:');
          if (newName && newName.trim()) {
            executeMoveFile(personName, fileItem.id, newName.trim(), 99999);
          } else {
            selectMove.value = '';
          }
        } else if (targetPerson) {
          executeMoveFile(personName, fileItem.id, targetPerson, 99999);
        }
      });
    }
  }

  function attachGroupBodyDragEvents(bodyElement, personName) {
    bodyElement.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    bodyElement.addEventListener('drop', (e) => {
      if (e.target === bodyElement) {
        e.preventDefault();
        const dragged = state.draggedItem;
        if (dragged) {
          executeMoveFile(dragged.fromPerson, dragged.fileId, personName, 99999);
        }
      }
    });
  }

  function clearAllDragHoverStates() {
    document.querySelectorAll('.file-item, .doc-card').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-left', 'drag-over-right', 'dragging');
    });
  }

  function executeReorderInGroup(personName, fromIdx, toIdx) {
    const list = state.groups.get(personName);
    if (!list) return;
    if (toIdx < 0 || toIdx >= list.length) return;

    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);

    renderGroups();
  }

  function executeMoveFile(fromPerson, fileId, toPerson, targetIdx) {
    clearAllDragHoverStates();

    const fromList = state.groups.get(fromPerson);
    if (!fromList) return;

    const foundIdx = fromList.findIndex(f => f.id === fileId);
    if (foundIdx === -1) return;

    const [fileItem] = fromList.splice(foundIdx, 1);
    fileItem.personName = toPerson;

    if (fromList.length === 0) {
      state.groups.delete(fromPerson);
    }

    if (!state.groups.has(toPerson)) {
      state.groups.set(toPerson, []);
    }
    const toList = state.groups.get(toPerson);

    if (targetIdx >= toList.length) {
      toList.push(fileItem);
    } else {
      toList.splice(targetIdx, 0, fileItem);
    }

    renderGroups();
    showToast(`Moved "${fileItem.name}" to ${toPerson}`, 'info');
  }

  function removeFileFromGroup(personName, fileId) {
    const list = state.groups.get(personName);
    if (!list) return;

    const index = list.findIndex(f => f.id === fileId);
    if (index === -1) return;

    const [removed] = list.splice(index, 1);

    const allIdx = state.allFiles.findIndex(f => f.id === fileId);
    if (allIdx !== -1) {
      state.allFiles.splice(allIdx, 1);
    }

    if (list.length === 0) {
      state.groups.delete(personName);
    }

    updateWorkspaceUI();
    showToast(`Removed "${removed.name}"`, 'info');
  }

  function attachHeaderEvents(headerElement, personName, files, isCollapsed) {
    const btnSort = headerElement.querySelector('.btn-sort-group');
    if (btnSort) {
      btnSort.addEventListener('click', () => {
        sortFileListNumerically(files);
        renderGroups();
        showToast(`Sorted ${personName}'s files numerically`, 'info');
      });
    }

    const btnPreviewStudio = headerElement.querySelector('.btn-preview-studio');
    if (btnPreviewStudio) {
      btnPreviewStudio.addEventListener('click', () => {
        openPersonDocumentsStudio(personName, files);
      });
    }

    const btnMerge = headerElement.querySelector('.btn-merge-download');
    if (btnMerge) {
      btnMerge.addEventListener('click', () => {
        promptMergeAndDownload(personName, files);
      });
    }

    const btnDelete = headerElement.querySelector('.btn-delete-group');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        if (confirm(`Remove person "${personName}" and all ${files.length} associated files?`)) {
          const fileIds = new Set(files.map(f => f.id));
          state.allFiles = state.allFiles.filter(f => !fileIds.has(f.id));
          state.groups.delete(personName);
          updateWorkspaceUI();
          showToast(`Deleted group "${personName}"`, 'info');
        }
      });
    }

    const btnCollapse = headerElement.querySelector('.btn-collapse-toggle');
    if (btnCollapse) {
      btnCollapse.addEventListener('click', () => {
        if (state.collapsedGroups.has(personName)) {
          state.collapsedGroups.delete(personName);
        } else {
          state.collapsedGroups.add(personName);
        }
        renderGroups();
      });
    }

    const nameEl = headerElement.querySelector('.person-name');
    const btnEdit = headerElement.querySelector('.btn-edit-name');

    const startRename = () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'person-name-edit-input';
      input.value = personName;

      const finishRename = () => {
        const newName = input.value.trim();
        if (newName && newName !== personName) {
          renamePersonGroup(personName, newName);
        } else {
          renderGroups();
        }
      };

      input.addEventListener('blur', finishRename);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finishRename();
        if (e.key === 'Escape') renderGroups();
      });

      nameEl.replaceWith(input);
      input.focus();
      input.select();
    };

    if (nameEl) nameEl.addEventListener('click', startRename);
    if (btnEdit) btnEdit.addEventListener('click', startRename);
  }

  function renamePersonGroup(oldName, newName) {
    if (!state.groups.has(oldName)) return;

    const files = state.groups.get(oldName);
    files.forEach(f => f.personName = newName);

    state.groups.delete(oldName);

    if (state.groups.has(newName)) {
      state.groups.set(newName, state.groups.get(newName).concat(files));
    } else {
      state.groups.set(newName, files);
    }

    renderGroups();
    showToast(`Renamed "${oldName}" to "${newName}"`, 'info');
  }

  function toggleAllCards() {
    const shouldCollapse = state.collapsedGroups.size < state.groups.size;
    if (shouldCollapse) {
      state.groups.forEach((_, key) => state.collapsedGroups.add(key));
      elements.toggleAllText.textContent = 'Expand All';
    } else {
      state.collapsedGroups.clear();
      elements.toggleAllText.textContent = 'Collapse All';
    }
    renderGroups();
  }

  function clearAllData() {
    if (confirm('Are you sure you want to clear all loaded files and groups?')) {
      state.activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
      state.activeObjectUrls.clear();

      state.allFiles = [];
      state.groups.clear();
      state.collapsedGroups.clear();
      state.searchQuery = '';
      elements.searchInput.value = '';

      updateWorkspaceUI();
      showToast('Workspace cleared.', 'info');
    }
  }

  // =========================================================================
  // MODAL 1: PERSON DOCUMENTS OVERVIEW & REARRANGE STUDIO
  // (Shows WHOLE PDF documents - NOT fragmented into individual pages)
  // =========================================================================
  async function openPersonDocumentsStudio(personName, filesList) {
    docStudioState.activePersonName = personName;
    docStudioState.activeFiles = filesList;
    docStudioState.viewMode = 'grid';

    elements.previewModalTitle.textContent = `${personName} - PDF Documents Overview & Rearrange`;
    elements.previewModalSub.textContent = `Drag whole PDF files to rearrange merge sequence • Click "✏️ Edit PDF" on any file to add images or edit text`;
    elements.previewModal.style.display = 'flex';

    switchDocStudioView('grid');

    // Show loading spinner
    elements.studioLoading.style.display = 'flex';
    elements.studioLoadingText.textContent = 'Rendering PDF document cover previews...';
    elements.editorDocGridContainer.style.display = 'none';

    try {
      // Render cover thumbnails and calculate page counts for each file
      for (const fileItem of filesList) {
        if (!fileItem.coverCanvas) {
          if (fileItem.isPdf) {
            const ab = await fileItem.file.arrayBuffer();
            if (typeof pdfjsLib !== 'undefined') {
              const loadingTask = pdfjsLib.getDocument({ data: ab.slice(0) });
              const pdfDoc = await loadingTask.promise;
              fileItem.pageCount = pdfDoc.numPages;

              const page = await pdfDoc.getPage(1);
              const viewport = page.getViewport({ scale: 0.35 });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              canvas.className = 'doc-cover-canvas';
              const ctx = canvas.getContext('2d');
              await page.render({ canvasContext: ctx, viewport: viewport }).promise;
              fileItem.coverCanvas = canvas;
            } else {
              fileItem.coverCanvas = createFallbackThumbnailCanvas(fileItem.name, 1);
            }
          } else if (fileItem.isImage) {
            fileItem.pageCount = 1;
            fileItem.coverCanvas = await createImageThumbnailCanvas(fileItem.file);
          }
        }
      }

      elements.studioLoading.style.display = 'none';
      elements.editorDocGridContainer.style.display = 'grid';

      renderDocGrid();
    } catch (err) {
      console.error('Error opening person documents studio:', err);
      elements.studioLoading.style.display = 'none';
      showToast('Error loading documents: ' + err.message, 'error');
    }
  }

  function renderDocGrid() {
    elements.editorDocGridContainer.innerHTML = '';

    const files = docStudioState.activeFiles;
    const totalDocs = files.length;
    elements.editorDocCountBadge.textContent = `${totalDocs} Document${totalDocs === 1 ? '' : 's'}`;

    let totalPages = 0;
    files.forEach(f => totalPages += (f.pageCount || 1));
    elements.editorTotalPagesCount.textContent = `${totalPages} Total Pages`;

    files.forEach((fileItem, index) => {
      const card = createDocCardElement(fileItem, index, totalDocs);
      elements.editorDocGridContainer.appendChild(card);
    });

    elements.editorStatusMsg.textContent = `Showing ${totalDocs} document(s). Drag any card to reorder, or click Edit PDF.`;
  }

  function createDocCardElement(fileItem, index, totalDocs) {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.draggable = true;
    card.dataset.fileId = fileItem.id;
    card.dataset.index = index;

    const isFirst = index === 0;
    const isLast = index === totalDocs - 1;

    // Header
    const header = document.createElement('div');
    header.className = 'doc-card-header';
    header.innerHTML = `
      <div class="doc-card-header-left">
        <span class="doc-index-badge">#${index + 1}</span>
        <span class="doc-format-badge">${fileItem.isPdf ? 'PDF' : 'IMAGE'}</span>
      </div>
      <span class="badge badge-count">${fileItem.pageCount || 1} Page${(fileItem.pageCount || 1) === 1 ? '' : 's'}</span>
    `;
    card.appendChild(header);

    // Cover Box
    const coverBox = document.createElement('div');
    coverBox.className = 'doc-cover-preview-box';
    if (fileItem.coverCanvas) {
      coverBox.appendChild(fileItem.coverCanvas);
    }
    card.appendChild(coverBox);

    // Info
    const info = document.createElement('div');
    info.className = 'doc-card-info';
    info.innerHTML = `
      <span class="doc-title" title="${escapeHtml(fileItem.name)}">${escapeHtml(fileItem.name)}</span>
      <div class="doc-meta-row">
        <span>${formatBytes(fileItem.size)}</span>
        <span>Order #${index + 1}</span>
      </div>
    `;
    card.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'doc-card-actions';
    actions.innerHTML = `
      <button class="btn-edit-pdf-prominent btn-trigger-doc-edit" title="Edit this PDF (Quick Modal)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span>Edit PDF</span>
      </button>

      <button class="btn-edit-pdf-prominent btn-trigger-doc-fullscreen" title="Edit All in Fullscreen Studio (New Webpage - Unconstrained Free Space)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        <span>Edit All</span>
      </button>

      <div class="reorder-btns" style="display:flex; gap:2px;">
        <button class="page-btn btn-doc-move-left" ${isFirst ? 'disabled' : ''} title="Move Left (◀)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <button class="page-btn btn-doc-move-right" ${isLast ? 'disabled' : ''} title="Move Right (▶)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
    `;
    card.appendChild(actions);

    attachDocCardEvents(card, fileItem, index);

    return card;
  }

  function attachDocCardEvents(cardEl, fileItem, index) {
    // Drag & Drop
    cardEl.addEventListener('dragstart', (e) => {
      docStudioState.draggedDocId = fileItem.id;
      cardEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', fileItem.id);
    });

    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      clearAllDragHoverStates();
      docStudioState.draggedDocId = null;
    });

    cardEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      if (!docStudioState.draggedDocId || docStudioState.draggedDocId === fileItem.id) return;

      const rect = cardEl.getBoundingClientRect();
      const isLeft = e.clientX < (rect.left + rect.width / 2);

      cardEl.classList.remove('drag-over-left', 'drag-over-right');
      if (isLeft) {
        cardEl.classList.add('drag-over-left');
      } else {
        cardEl.classList.add('drag-over-right');
      }
    });

    cardEl.addEventListener('dragleave', (e) => {
      if (!cardEl.contains(e.relatedTarget)) {
        cardEl.classList.remove('drag-over-left', 'drag-over-right');
      }
    });

    cardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const draggedId = docStudioState.draggedDocId;
      if (!draggedId || draggedId === fileItem.id) return;

      const rect = cardEl.getBoundingClientRect();
      const insertBefore = e.clientX < (rect.left + rect.width / 2);

      const fromIdx = docStudioState.activeFiles.findIndex(f => f.id === draggedId);
      if (fromIdx === -1) return;

      const [movedDoc] = docStudioState.activeFiles.splice(fromIdx, 1);
      
      let targetIdx = docStudioState.activeFiles.findIndex(f => f.id === fileItem.id);
      if (!insertBefore) targetIdx += 1;

      docStudioState.activeFiles.splice(targetIdx, 0, movedDoc);

      renderDocGrid();
      showToast(`Moved "${movedDoc.name}" to position #${targetIdx + 1}`, 'info');
    });

    // Buttons
    const btnEditPdf = cardEl.querySelector('.btn-trigger-doc-edit');
    const btnFullscreen = cardEl.querySelector('.btn-trigger-doc-fullscreen');
    const btnLeft = cardEl.querySelector('.btn-doc-move-left');
    const btnRight = cardEl.querySelector('.btn-doc-move-right');

    if (btnEditPdf) {
      btnEditPdf.addEventListener('click', () => {
        openSinglePdfEditor(fileItem, docStudioState.activePersonName);
      });
    }

    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', () => {
        openFullscreenStudio(fileItem, docStudioState.activePersonName);
      });
    }

    if (btnLeft) {
      btnLeft.addEventListener('click', () => {
        if (index > 0) {
          const [moved] = docStudioState.activeFiles.splice(index, 1);
          docStudioState.activeFiles.splice(index - 1, 0, moved);
          renderDocGrid();
        }
      });
    }

    if (btnRight) {
      btnRight.addEventListener('click', () => {
        if (index < docStudioState.activeFiles.length - 1) {
          const [moved] = docStudioState.activeFiles.splice(index, 1);
          docStudioState.activeFiles.splice(index + 1, 0, moved);
          renderDocGrid();
        }
      });
    }
  }

  async function switchDocStudioView(mode) {
    docStudioState.viewMode = mode;

    if (mode === 'grid') {
      elements.btnViewGrid.classList.add('active');
      elements.btnViewFull.classList.remove('active');
      elements.editorDocGridContainer.style.display = 'grid';
      elements.editorFullPreviewContainer.style.display = 'none';
    } else {
      elements.btnViewGrid.classList.remove('active');
      elements.btnViewFull.classList.add('active');
      elements.editorDocGridContainer.style.display = 'none';
      elements.editorFullPreviewContainer.style.display = 'block';

      elements.studioLoading.style.display = 'flex';
      elements.studioLoadingText.textContent = 'Generating full merged document preview...';

      try {
        const blob = await mergeFilesToBlob(docStudioState.activePersonName, docStudioState.activeFiles);
        if (docStudioState.currentPreviewBlobUrl) {
          URL.revokeObjectURL(docStudioState.currentPreviewBlobUrl);
        }
        docStudioState.currentPreviewBlobUrl = URL.createObjectURL(blob);
        elements.previewIframe.src = docStudioState.currentPreviewBlobUrl + '#toolbar=1';
      } catch (err) {
        console.error('Error generating merged view:', err);
        showToast('Preview error: ' + err.message, 'error');
      } finally {
        elements.studioLoading.style.display = 'none';
      }
    }
  }

  function closePersonDocumentsStudio() {
    elements.previewModal.style.display = 'none';
    elements.previewIframe.src = 'about:blank';
    if (docStudioState.currentPreviewBlobUrl) {
      URL.revokeObjectURL(docStudioState.currentPreviewBlobUrl);
      docStudioState.currentPreviewBlobUrl = null;
    }
  }

  // =========================================================================
  // FULLSCREEN STUDIO INTEGRATION (OPEN IN NEW WEBPAGE)
  // Free space, unconstrained workspace ("without dungeon space")
  // =========================================================================
  const STUDIO_DB_NAME = 'PDFMergerStudioDB';
  const STUDIO_DB_VERSION = 1;
  const STUDIO_STORE_NAME = 'activeSessions';

  function openStudioDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(STUDIO_DB_NAME, STUDIO_DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STUDIO_STORE_NAME)) {
          db.createObjectStore(STUDIO_STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveSessionToIndexedDB(data) {
    try {
      const db = await openStudioDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STUDIO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(STUDIO_STORE_NAME);
        const req = store.put(data);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('saveSessionToIndexedDB error:', e);
      return false;
    }
  }

  async function getSavedResultFromIndexedDB() {
    try {
      const db = await openStudioDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STUDIO_STORE_NAME, 'readonly');
        const store = tx.objectStore(STUDIO_STORE_NAME);
        const req = store.get('savedResult');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('getSavedResultFromIndexedDB error:', e);
      return null;
    }
  }

  async function openFullscreenStudio(fileItem, personName) {
    if (!fileItem) {
      // Pick first document from active files or first group
      if (docStudioState.activeFiles && docStudioState.activeFiles.length > 0) {
        fileItem = docStudioState.activeFiles[0];
        personName = docStudioState.activePersonName;
      } else {
        const firstEntry = state.groups.entries().next().value;
        if (firstEntry) {
          personName = firstEntry[0];
          fileItem = firstEntry[1][0];
        }
      }
    }

    if (!fileItem) {
      showToast('No PDF document loaded yet to open in Fullscreen Studio.', 'warning');
      return;
    }

    try {
      showToast(`Preparing "${fileItem.name}" for Fullscreen Studio...`, 'info');

      let fileBlob = fileItem.file;
      // If it's an image file, convert it to a PDF first
      if (fileItem.isImage && !fileItem.isPdf) {
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const ab = await fileItem.file.arrayBuffer();
        const img = fileItem.type === 'image/png' || fileItem.name.endsWith('.png')
          ? await pdfDoc.embedPng(ab)
          : await pdfDoc.embedJpg(ab);
        const p = pdfDoc.addPage([img.width, img.height]);
        p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        const bytes = await pdfDoc.save();
        fileBlob = new Blob([bytes], { type: 'application/pdf' });
      }

      await saveSessionToIndexedDB({
        id: 'currentDoc',
        docName: fileItem.name.replace(/\.[^/.]+$/, '') + '.pdf',
        personName: personName || 'User',
        fileId: fileItem.id,
        fileBlob: fileBlob,
        editableItems: fileItem.editableItems || [],
        updatedAt: Date.now()
      });

      // Launch editor.html in a new tab/window
      window.open('editor.html', '_blank');
    } catch (err) {
      console.error('Failed to open Fullscreen Studio:', err);
      showToast('Error opening Fullscreen Studio: ' + err.message, 'error');
    }
  }

  // Setup BroadcastChannel to sync edits from editor.html back into index.html
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const syncChannel = new BroadcastChannel('pdf_merger_studio_sync');
      syncChannel.onmessage = async (e) => {
        if (e.data && e.data.type === 'PDF_UPDATED') {
          const res = await getSavedResultFromIndexedDB();
          if (res && res.fileBlob) {
            let matched = state.allFiles.find(f => f.id === res.fileId || f.name === res.docName);
            if (matched) {
              matched.file = new File([res.fileBlob], res.docName, { type: 'application/pdf' });
              matched.isPdf = true;
              matched.size = res.fileBlob.size;
              matched.coverCanvas = null;
              if (res.editableItems) {
                matched.editableItems = res.editableItems;
              }
            }

            if (docStudioState.activeFiles) {
              let studioDoc = docStudioState.activeFiles.find(f => f.id === res.fileId || f.name === res.docName);
              if (studioDoc) {
                studioDoc.file = new File([res.fileBlob], res.docName, { type: 'application/pdf' });
                studioDoc.isPdf = true;
                studioDoc.size = res.fileBlob.size;
                studioDoc.coverCanvas = null;
                if (res.editableItems) {
                  studioDoc.editableItems = res.editableItems;
                }
              }
              renderDocGrid();
            }

            renderGroups();
            showToast(`Synchronized "${res.docName}" from Fullscreen Studio!`, 'success');
          }
        }
      };
    } catch (err) {
      console.warn('Sync channel init failed:', err);
    }
  }

  // =========================================================================
  // MODAL 2: DEDICATED SINGLE PDF EDITOR STUDIO
  // (Add Images, Align into PDF, Show on ALL and every page, Edit Text with Whiteout)
  // =========================================================================
  async function openSinglePdfEditor(fileItem, personName) {
    singlePdfEditState.fileItem = fileItem;
    singlePdfEditState.personName = personName;
    singlePdfEditState.currentPage = 1;
    singlePdfEditState.hasUnsavedEdits = false;

    elements.pdfEditorTitle.textContent = `Edit PDF: ${fileItem.name}`;
    elements.pdfEditorSub.textContent = `Add images, align across all pages, and edit/replace text in this document`;
    elements.pdfEditorModal.style.display = 'flex';

    elements.pdfEditorLoading.style.display = 'flex';
    elements.pdfEditorLoadingText.textContent = 'Loading PDF pages...';
    elements.pdfCanvasWrapper.style.display = 'none';

    try {
      const ab = await fileItem.file.arrayBuffer();

      if (fileItem.isPdf && typeof pdfjsLib !== 'undefined') {
        const loadingTask = pdfjsLib.getDocument({ data: ab.slice(0) });
        singlePdfEditState.pdfjsDoc = await loadingTask.promise;
        singlePdfEditState.numPages = singlePdfEditState.pdfjsDoc.numPages;
      } else {
        singlePdfEditState.pdfjsDoc = null;
        singlePdfEditState.numPages = 1;
      }

      elements.pdfEditorLoading.style.display = 'none';
      elements.pdfCanvasWrapper.style.display = 'inline-block';

      await renderActiveEditorPage();
    } catch (err) {
      console.error('Failed to load single PDF editor:', err);
      elements.pdfEditorLoading.style.display = 'none';
      showToast('Error opening editor: ' + err.message, 'error');
    }
  }

  async function renderActiveEditorPage() {
    const pageNum = singlePdfEditState.currentPage;
    const totalPages = singlePdfEditState.numPages;

    elements.pdfPageNavIndicator.textContent = `Page ${pageNum} of ${totalPages}`;
    elements.pdfEditorPageBadge.textContent = `Page ${pageNum} of ${totalPages}`;

    elements.btnPdfPrevPage.disabled = (pageNum <= 1);
    elements.btnPdfNextPage.disabled = (pageNum >= totalPages);

    const canvas = elements.pdfActivePageCanvas;
    const fileItem = singlePdfEditState.fileItem;

    if (fileItem.isPdf && singlePdfEditState.pdfjsDoc) {
      const page = await singlePdfEditState.pdfjsDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.2 }); // Clear crisp editing view

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      singlePdfEditState.pageDimensions = { width: viewport.width, height: viewport.height };
    } else {
      // Image file as single-page document
      const img = new Image();
      const url = URL.createObjectURL(fileItem.file);
      await new Promise(res => {
        img.onload = () => {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          singlePdfEditState.pageDimensions = { width: img.naturalWidth, height: img.naturalHeight };
          res();
        };
        img.src = url;
      });
    }

    // Refresh overlay sizes and positions
    updateImageOverlayStyle();
    updateTextOverlayStyle();
  }

  function goToPrevEditorPage() {
    if (singlePdfEditState.currentPage > 1) {
      singlePdfEditState.currentPage--;
      renderActiveEditorPage();
    }
  }

  function goToNextEditorPage() {
    if (singlePdfEditState.currentPage < singlePdfEditState.numPages) {
      singlePdfEditState.currentPage++;
      renderActiveEditorPage();
    }
  }

  // Handle Image Upload into Editor
  async function handleEditorImageUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const img = new Image();
      img.onload = () => {
        singlePdfEditState.image.active = true;
        singlePdfEditState.image.file = file;
        singlePdfEditState.image.dataUrl = dataUrl;
        singlePdfEditState.image.naturalWidth = img.naturalWidth;
        singlePdfEditState.image.naturalHeight = img.naturalHeight;
        singlePdfEditState.image.imgEl = img;
        singlePdfEditState.hasUnsavedEdits = true;

        elements.imageOverlayImg.src = dataUrl;
        elements.imageEditDrawer.style.display = 'block';
        elements.imageDrawerTitle.textContent = `Image: ${file.name} (${img.naturalWidth}x${img.naturalHeight}px)`;

        // Default: Center alignment, shown on all pages!
        applyImageAlignPreset('center');
        showToast(`Image loaded. Aligned to center across all pages. Drag to reposition!`, 'success');
      };
      img.src = dataUrl;
    } catch (err) {
      showToast('Failed to load image: ' + err.message, 'error');
    }

    e.target.value = '';
  }

  // Alignment Preset Handler (Top-Left, Center, Bottom-Right, etc.)
  function applyImageAlignPreset(align) {
    singlePdfEditState.image.align = align;

    // Update active button state
    document.querySelectorAll('.btn-align-preset').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.align === align);
    });

    const canvasW = elements.pdfActivePageCanvas.width || 600;
    const canvasH = elements.pdfActivePageCanvas.height || 800;

    const scale = singlePdfEditState.image.scalePct / 100;
    const imgW = (singlePdfEditState.image.naturalWidth || 150) * scale;
    const imgH = (singlePdfEditState.image.naturalHeight || 150) * scale;

    const marginX = 25;
    const marginY = 25;

    let posX = marginX;
    let posY = marginY;

    if (align === 'top-left') {
      posX = marginX; posY = marginY;
    } else if (align === 'top-center') {
      posX = (canvasW - imgW) / 2; posY = marginY;
    } else if (align === 'top-right') {
      posX = canvasW - imgW - marginX; posY = marginY;
    } else if (align === 'mid-left') {
      posX = marginX; posY = (canvasH - imgH) / 2;
    } else if (align === 'center') {
      posX = (canvasW - imgW) / 2; posY = (canvasH - imgH) / 2;
    } else if (align === 'mid-right') {
      posX = canvasW - imgW - marginX; posY = (canvasH - imgH) / 2;
    } else if (align === 'bottom-left') {
      posX = marginX; posY = canvasH - imgH - marginY;
    } else if (align === 'bottom-center') {
      posX = (canvasW - imgW) / 2; posY = canvasH - imgH - marginY;
    } else if (align === 'bottom-right') {
      posX = canvasW - imgW - marginX; posY = canvasH - imgH - marginY;
    }

    singlePdfEditState.image.relX = posX / canvasW;
    singlePdfEditState.image.relY = posY / canvasH;

    updateImageOverlayStyle();
  }

  function updateImageOverlayStyle() {
    const imgState = singlePdfEditState.image;
    if (!imgState.active) {
      elements.imageOverlayElement.style.display = 'none';
      return;
    }

    // Check if should be visible on current page
    const isVisibleOnPage = imgState.allPages || (singlePdfEditState.currentPage === 1);
    elements.imageOverlayElement.style.display = isVisibleOnPage ? 'inline-flex' : 'none';

    const canvasW = elements.pdfActivePageCanvas.width || 600;
    const canvasH = elements.pdfActivePageCanvas.height || 800;

    const scale = imgState.scalePct / 100;
    const imgW = (imgState.naturalWidth || 150) * scale;
    const imgH = (imgState.naturalHeight || 150) * scale;

    const posX = imgState.relX * canvasW;
    const posY = imgState.relY * canvasH;

    elements.imageOverlayElement.style.width = `${imgW}px`;
    elements.imageOverlayElement.style.height = `${imgH}px`;
    elements.imageOverlayElement.style.left = `${posX}px`;
    elements.imageOverlayElement.style.top = `${posY}px`;
    elements.imageOverlayElement.style.opacity = `${imgState.opacityPct / 100}`;

    elements.imageOverlayBadge.textContent = imgState.allPages ? 'All Pages' : `Page ${singlePdfEditState.currentPage}`;
  }

  function removeActiveImageOverlay() {
    singlePdfEditState.image.active = false;
    singlePdfEditState.image.file = null;
    singlePdfEditState.image.dataUrl = null;
    elements.imageEditDrawer.style.display = 'none';
    elements.imageOverlayElement.style.display = 'none';
    showToast('Image removed from PDF', 'info');
  }

  // Text Drawer Toggle & Overlay Styling
  function toggleTextDrawer() {
    const isVisible = elements.textEditDrawer.style.display !== 'none';
    if (!isVisible) {
      elements.textEditDrawer.style.display = 'block';
      singlePdfEditState.text.active = true;
      singlePdfEditState.hasUnsavedEdits = true;
      updateTextOverlayStyle();
      showToast('Text tool active. Drag text box on page to position.', 'info');
    } else {
      elements.textEditDrawer.style.display = 'none';
    }
  }

  function updateTextOverlayStyle() {
    const txtState = singlePdfEditState.text;
    if (!txtState.active) {
      elements.textOverlayElement.style.display = 'none';
      return;
    }

    const isVisible = txtState.allPages || (singlePdfEditState.currentPage === 1);
    elements.textOverlayElement.style.display = isVisible ? 'inline-flex' : 'none';

    const canvasW = elements.pdfActivePageCanvas.width || 600;
    const canvasH = elements.pdfActivePageCanvas.height || 800;

    const posX = txtState.relX * canvasW;
    const posY = txtState.relY * canvasH;

    elements.textOverlayElement.style.left = `${posX}px`;
    elements.textOverlayElement.style.top = `${posY}px`;
    elements.textOverlayElement.style.fontSize = `${txtState.fontSize}px`;

    // Color
    let colorHex = '#0f172a';
    if (txtState.color === 'red') colorHex = '#dc2626';
    if (txtState.color === 'blue') colorHex = '#2563eb';
    if (txtState.color === 'green') colorHex = '#16a34a';
    if (txtState.color === 'white') colorHex = '#ffffff';
    elements.textOverlaySpan.style.color = colorHex;

    // Whiteout box
    elements.textOverlayElement.classList.toggle('whiteout-active', txtState.whiteout);
  }

  function removeActiveTextOverlay() {
    singlePdfEditState.text.active = false;
    elements.textEditDrawer.style.display = 'none';
    elements.textOverlayElement.style.display = 'none';
    showToast('Text overlay removed', 'info');
  }

  // Draggable Overlays Engine (Mouse Drag on Stage)
  function initOverlayDragHandlers() {
    makeElementDraggable(elements.imageOverlayElement, (newX, newY) => {
      const canvasW = elements.pdfActivePageCanvas.width || 600;
      const canvasH = elements.pdfActivePageCanvas.height || 800;
      singlePdfEditState.image.relX = newX / canvasW;
      singlePdfEditState.image.relY = newY / canvasH;
      singlePdfEditState.image.align = 'custom';
      document.querySelectorAll('.btn-align-preset').forEach(b => b.classList.remove('active'));
    });

    makeElementDraggable(elements.textOverlayElement, (newX, newY) => {
      const canvasW = elements.pdfActivePageCanvas.width || 600;
      const canvasH = elements.pdfActivePageCanvas.height || 800;
      singlePdfEditState.text.relX = newX / canvasW;
      singlePdfEditState.text.relY = newY / canvasH;
    });
  }

  function makeElementDraggable(element, onMoveCallback) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    element.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = parseFloat(element.style.left) || 0;
      initialTop = parseFloat(element.style.top) || 0;
      element.classList.add('active');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = Math.max(0, initialLeft + dx);
      let newTop = Math.max(0, initialTop + dy);

      element.style.left = `${newLeft}px`;
      element.style.top = `${newTop}px`;

      if (onMoveCallback) onMoveCallback(newLeft, newTop);
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.classList.remove('active');
      }
    });
  }

  // =========================================================================
  // BURN EDITS INTO PDF (pdf-lib)
  // =========================================================================
  async function savePdfEdits() {
    const fileItem = singlePdfEditState.fileItem;
    if (!fileItem) return;

    if (!singlePdfEditState.image.active && !singlePdfEditState.text.active) {
      showToast('No active image or text edits to apply.', 'info');
      closeSinglePdfEditor();
      return;
    }

    elements.pdfEditorLoading.style.display = 'flex';
    elements.pdfEditorLoadingText.textContent = 'Burning images and text into PDF pages...';

    try {
      const { PDFDocument, rgb, StandardFonts } = PDFLib;
      let pdfDoc;

      if (fileItem.isPdf) {
        const ab = await fileItem.file.arrayBuffer();
        pdfDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
      } else {
        // Convert image file into PDF first
        pdfDoc = await PDFDocument.create();
        const ab = await fileItem.file.arrayBuffer();
        const img = fileItem.type === 'image/png' || fileItem.name.endsWith('.png')
          ? await pdfDoc.embedPng(ab)
          : await pdfDoc.embedJpg(ab);
        const p = pdfDoc.addPage([img.width, img.height]);
        p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }

      const pages = pdfDoc.getPages();
      const canvasW = elements.pdfActivePageCanvas.width || 600;
      const canvasH = elements.pdfActivePageCanvas.height || 800;

      // 1. BURN IMAGE OVERLAY
      if (singlePdfEditState.image.active && singlePdfEditState.image.file) {
        const imgFile = singlePdfEditState.image.file;
        let imgBytes = await imgFile.arrayBuffer();
        let embeddedImg;

        if (imgFile.type === 'image/png' || imgFile.name.toLowerCase().endsWith('.png')) {
          embeddedImg = await pdfDoc.embedPng(imgBytes);
        } else if (imgFile.type === 'image/jpeg' || imgFile.name.toLowerCase().match(/\.jpe?g$/)) {
          embeddedImg = await pdfDoc.embedJpg(imgBytes);
        } else {
          const pngBlob = await convertImageToPngBlob(imgFile);
          const pngBytes = await pngBlob.arrayBuffer();
          embeddedImg = await pdfDoc.embedPng(pngBytes);
        }

        const targetPages = singlePdfEditState.image.allPages ? pages : [pages[singlePdfEditState.currentPage - 1]];

        for (const page of targetPages) {
          const { width: pWidth, height: pHeight } = page.getSize();

          // Calculate dimensions relative to PDF point size
          const scale = singlePdfEditState.image.scalePct / 100;
          const displayW = (singlePdfEditState.image.naturalWidth || 150) * scale;
          const displayH = (singlePdfEditState.image.naturalHeight || 150) * scale;

          const ratioW = pWidth / canvasW;
          const ratioH = pHeight / canvasH;

          const finalW = displayW * ratioW;
          const finalH = displayH * ratioH;

          // Convert coordinates (PDF 0,0 is bottom-left)
          const finalX = singlePdfEditState.image.relX * pWidth;
          const finalY = pHeight - (singlePdfEditState.image.relY * pHeight) - finalH;

          page.drawImage(embeddedImg, {
            x: Math.max(0, finalX),
            y: Math.max(0, finalY),
            width: finalW,
            height: finalH,
            opacity: singlePdfEditState.image.opacityPct / 100
          });
        }
      }

      // 2. BURN TEXT OVERLAY
      if (singlePdfEditState.text.active && singlePdfEditState.text.content) {
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const txtState = singlePdfEditState.text;
        const targetPages = txtState.allPages ? pages : [pages[singlePdfEditState.currentPage - 1]];

        let colorRgb = rgb(0.1, 0.1, 0.1);
        if (txtState.color === 'red') colorRgb = rgb(0.85, 0.15, 0.15);
        if (txtState.color === 'blue') colorRgb = rgb(0.15, 0.35, 0.85);
        if (txtState.color === 'green') colorRgb = rgb(0.1, 0.65, 0.25);
        if (txtState.color === 'white') colorRgb = rgb(1, 1, 1);

        for (const page of targetPages) {
          const { width: pWidth, height: pHeight } = page.getSize();
          const ratio = pWidth / canvasW;

          const fontSizePt = txtState.fontSize * ratio;
          const textW = font.widthOfTextAtSize(txtState.content, fontSizePt);

          const finalX = txtState.relX * pWidth;
          const finalY = pHeight - (txtState.relY * pHeight) - fontSizePt;

          // Whiteout background box if enabled
          if (txtState.whiteout) {
            page.drawRectangle({
              x: finalX - 4,
              y: finalY - 4,
              width: textW + 8,
              height: fontSizePt + 8,
              color: rgb(1, 1, 1)
            });
          }

          page.drawText(txtState.content, {
            x: finalX,
            y: finalY,
            size: fontSizePt,
            font: font,
            color: colorRgb
          });
        }
      }

      const updatedPdfBytes = await pdfDoc.save();
      const updatedBlob = new Blob([updatedPdfBytes], { type: 'application/pdf' });
      const updatedFile = new File([updatedBlob], fileItem.name.replace(/\.[^/.]+$/, '') + '.pdf', { type: 'application/pdf' });

      // Replace file in state
      fileItem.file = updatedFile;
      fileItem.isPdf = true;
      fileItem.size = updatedBlob.size;
      fileItem.coverCanvas = null; // force redraw cover thumbnail

      elements.pdfEditorLoading.style.display = 'none';
      closeSinglePdfEditor();

      // Refresh documents grid
      renderDocGrid();
      showToast(`Successfully saved edits to "${fileItem.name}"!`, 'success');
    } catch (err) {
      console.error('Failed to save PDF edits:', err);
      elements.pdfEditorLoading.style.display = 'none';
      showToast('Error saving edits: ' + err.message, 'error');
    }
  }

  async function downloadSingleEditedPdf() {
    await savePdfEdits();
    const filename = singlePdfEditState.fileItem.name;
    const blob = singlePdfEditState.fileItem.file;

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
        showToast(`Saved "${handle.name || filename}"!`, 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError') {
          showToast('Save cancelled.', 'info');
          return;
        }
        console.warn('File picker fallback:', err);
      }
    }
    downloadBlob(blob, filename);
  }

  function closeSinglePdfEditor() {
    elements.pdfEditorModal.style.display = 'none';
    elements.imageEditDrawer.style.display = 'none';
    elements.textEditDrawer.style.display = 'none';
  }

  // =========================================================================
  // Standard Merging Engine
  // =========================================================================
  async function mergeFilesToBlob(personName, filesList) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const mergedDoc = await PDFDocument.create();

    for (const fileItem of filesList) {
      const ab = await fileItem.file.arrayBuffer();
      if (fileItem.isPdf) {
        const srcDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
        const pages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(p => mergedDoc.addPage(p));
      } else if (fileItem.isImage) {
        let img;
        if (fileItem.type === 'image/png' || fileItem.name.endsWith('.png')) {
          img = await mergedDoc.embedPng(ab);
        } else {
          img = await mergedDoc.embedJpg(ab);
        }
        const p = mergedDoc.addPage([img.width, img.height]);
        p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
    }

    if (state.settings.addPageNumbers) {
      const font = await mergedDoc.embedFont(StandardFonts.Helvetica);
      const total = mergedDoc.getPageCount();
      for (let i = 0; i < total; i++) {
        const p = mergedDoc.getPage(i);
        const { width } = p.getSize();
        const text = `Page ${i + 1} of ${total}`;
        const txtW = font.widthOfTextAtSize(text, 9);
        p.drawText(text, {
          x: width / 2 - txtW / 2,
          y: 20,
          size: 9,
          font: font,
          color: rgb(0.35, 0.35, 0.4)
        });
      }
    }

    const bytes = await mergedDoc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function getPersonReportFilename(personName) {
    if (!personName || !personName.trim()) {
      return 'REPORTS.pdf';
    }
    let cleanPerson = personName
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Avoid duplicate REPORTS if already present
    if (/[\s_-]*reports$/i.test(cleanPerson)) {
      cleanPerson = cleanPerson.replace(/[\s_-]*reports$/i, '').trim();
    }

    return `${cleanPerson} REPORTS.pdf`;
  }

  // =========================================================================
  // Merge Confirmation & Windows Location Picker
  // =========================================================================
  function promptMergeAndDownload(personName, files) {
    if (!personName || !files || files.length === 0) {
      showToast('No documents found to merge for this person.', 'warning');
      return;
    }

    mergeConfirmState.mode = 'single';
    mergeConfirmState.personName = personName;
    mergeConfirmState.files = files;
    const suggested = getPersonReportFilename(personName);
    mergeConfirmState.suggestedFilename = suggested;

    if (elements.mergeConfirmTitle) {
      elements.mergeConfirmTitle.textContent = 'Confirm Merge & Save Location';
    }
    if (elements.mergeConfirmDescription) {
      elements.mergeConfirmDescription.innerHTML = `Ready to merge files for <strong style="color: var(--text-primary);">${personName}</strong>. A Windows save window will open for you to select your save location.`;
    }
    if (elements.txtConfirmFilename) {
      elements.txtConfirmFilename.value = suggested;
    }
    if (elements.lblConfirmHint) {
      elements.lblConfirmHint.textContent = 'The person name comes first and ends with "REPORTS.pdf".';
    }
    if (elements.lblConfirmLocationNote) {
      elements.lblConfirmLocationNote.innerHTML = '<strong>Windows Location Selection:</strong> Clicking "Choose Location &amp; Save" will open the Windows Explorer window to select your destination folder.';
    }
    if (elements.lblConfirmButtonText) {
      elements.lblConfirmButtonText.textContent = 'Choose Location & Save';
    }

    if (elements.mergeConfirmModal) {
      elements.mergeConfirmModal.style.display = 'flex';
      setTimeout(() => {
        if (elements.txtConfirmFilename) {
          elements.txtConfirmFilename.focus();
          elements.txtConfirmFilename.select();
        }
      }, 50);
    } else {
      performMergeAndSave(personName, files, suggested, null);
    }
  }

  function promptMergeAllAndZip() {
    if (state.groups.size === 0) {
      showToast('No groups available to merge.', 'info');
      return;
    }

    mergeConfirmState.mode = 'zip';
    mergeConfirmState.personName = null;
    mergeConfirmState.files = [];

    const totalPersons = state.groups.size;
    const totalFiles = state.allFiles.length;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const suggestedZip = `Merged_Documents_${timestamp}.zip`;
    mergeConfirmState.suggestedFilename = suggestedZip;

    if (elements.mergeConfirmTitle) {
      elements.mergeConfirmTitle.textContent = 'Confirm Batch Merge & Save Location';
    }
    if (elements.mergeConfirmDescription) {
      elements.mergeConfirmDescription.innerHTML = `Ready to merge files for all <strong style="color: var(--text-primary);">${totalPersons} ${totalPersons === 1 ? 'person' : 'persons'}</strong> (${totalFiles} ${totalFiles === 1 ? 'document' : 'documents'}) into individual PDFs and package them into a ZIP archive. A Windows Save As window will open for you to select your save location.`;
    }
    if (elements.txtConfirmFilename) {
      elements.txtConfirmFilename.value = suggestedZip;
    }
    if (elements.lblConfirmHint) {
      elements.lblConfirmHint.textContent = 'Each person\'s merged PDF inside will be named "[Person Name] REPORTS.pdf".';
    }
    if (elements.lblConfirmLocationNote) {
      elements.lblConfirmLocationNote.innerHTML = '<strong>Windows Location Selection:</strong> Clicking "Choose Location &amp; Save ZIP" will open the Windows Explorer window to choose where to save your ZIP archive.';
    }
    if (elements.lblConfirmButtonText) {
      elements.lblConfirmButtonText.textContent = 'Choose Location & Save ZIP';
    }

    if (elements.mergeConfirmModal) {
      elements.mergeConfirmModal.style.display = 'flex';
      setTimeout(() => {
        if (elements.txtConfirmFilename) {
          elements.txtConfirmFilename.focus();
          elements.txtConfirmFilename.select();
        }
      }, 50);
    } else {
      executeBatchMergeAndSave(suggestedZip, null);
    }
  }

  function closeMergeConfirmModal() {
    if (elements.mergeConfirmModal) {
      elements.mergeConfirmModal.style.display = 'none';
    }
    mergeConfirmState.mode = 'single';
    mergeConfirmState.personName = null;
    mergeConfirmState.files = [];
  }

  async function executeMergeConfirm() {
    let targetFilename = (elements.txtConfirmFilename ? elements.txtConfirmFilename.value : '').trim();
    const isZip = (mergeConfirmState.mode === 'zip');

    if (!targetFilename) {
      targetFilename = mergeConfirmState.suggestedFilename || (isZip ? 'Merged_Documents.zip' : 'REPORTS.pdf');
    }

    if (isZip) {
      if (!targetFilename.toLowerCase().endsWith('.zip')) {
        targetFilename += '.zip';
      }
    } else {
      if (!targetFilename.toLowerCase().endsWith('.pdf')) {
        targetFilename += '.pdf';
      }
    }

    if (!isZip) {
      const personName = mergeConfirmState.personName;
      const files = mergeConfirmState.files;
      if (!personName || !files || files.length === 0) {
        closeMergeConfirmModal();
        showToast('No documents found to merge.', 'warning');
        return;
      }
    } else {
      if (state.groups.size === 0) {
        closeMergeConfirmModal();
        showToast('No groups available to merge.', 'warning');
        return;
      }
    }

    // Windows Save As location selection via File System Access API
    let fileHandle = null;
    if ('showSaveFilePicker' in window) {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: targetFilename,
          types: isZip ? [{
            description: 'ZIP Archive (*.zip)',
            accept: {
              'application/zip': ['.zip']
            }
          }] : [{
            description: 'PDF Document (*.pdf)',
            accept: {
              'application/pdf': ['.pdf']
            }
          }]
        });
      } catch (pickerErr) {
        if (pickerErr.name === 'AbortError') {
          // User clicked Cancel in Windows File Explorer
          showToast('Save cancelled by user.', 'info');
          closeMergeConfirmModal();
          return;
        }
        console.warn('Native file picker not accessible or threw error:', pickerErr);
        fileHandle = null;
      }
    }

    const savedPersonName = mergeConfirmState.personName;
    const savedFiles = mergeConfirmState.files;

    closeMergeConfirmModal();

    if (isZip) {
      await executeBatchMergeAndSave(targetFilename, fileHandle);
    } else {
      await performMergeAndSave(savedPersonName, savedFiles, targetFilename, fileHandle);
    }
  }

  async function performMergeAndSave(personName, files, targetFilename, fileHandle = null) {
    showProgressModal(`Merging documents for ${personName}...`);

    try {
      const blob = await mergeFilesToBlob(personName, files);

      if (fileHandle) {
        updateProgressModal('Writing to selected Windows folder...', 90, `Saving ${fileHandle.name || targetFilename}`);
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        showToast(`Successfully saved "${fileHandle.name || targetFilename}" to selected location!`, 'success');
      } else {
        downloadBlob(blob, targetFilename);
        showToast(`Successfully merged and downloaded "${targetFilename}"`, 'success');
      }
    } catch (err) {
      console.error('Merge error:', err);
      showToast('Error merging documents: ' + err.message, 'error');
    } finally {
      closeProgressModal();
    }
  }

  async function mergeAndDownloadForPerson(personName, files) {
    promptMergeAndDownload(personName, files);
  }

  async function executeBatchMergeAndSave(zipFilename, fileHandle = null) {
    if (state.groups.size === 0) {
      showToast('No groups available to merge.', 'info');
      return;
    }

    if (typeof JSZip === 'undefined') {
      showToast('JSZip library is missing.', 'error');
      return;
    }

    showProgressModal('Preparing Batch Merge...');

    try {
      const zip = new JSZip();
      const groupsList = Array.from(state.groups.entries());
      const totalGroups = groupsList.length;

      for (let gIdx = 0; gIdx < totalGroups; gIdx++) {
        const [personName, files] = groupsList[gIdx];

        const groupPercent = Math.round((gIdx / totalGroups) * 85);
        updateProgressModal(
          `Merging Person ${gIdx + 1} of ${totalGroups}: ${personName}`,
          groupPercent,
          `${files.length} documents being combined...`
        );

        const pdfBlob = await mergeFilesToBlob(personName, files);
        const filename = getPersonReportFilename(personName);
        zip.file(filename, pdfBlob);
      }

      updateProgressModal('Compressing into ZIP archive...', 90, 'Finalizing download package...');

      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        (meta) => {
          updateProgressModal('Compressing ZIP archive...', 90 + Math.round(meta.percent * 0.08), `${Math.round(meta.percent)}% completed`);
        }
      );

      if (fileHandle) {
        updateProgressModal('Writing to selected Windows folder...', 99, `Saving ${fileHandle.name || zipFilename}`);
        const writable = await fileHandle.createWritable();
        await writable.write(zipBlob);
        await writable.close();
        showToast(`Batch merge complete! Saved "${fileHandle.name || zipFilename}" to your chosen location!`, 'success');
      } else {
        downloadBlob(zipBlob, zipFilename);
        showToast(`Batch merge complete! Downloaded "${zipFilename}"`, 'success');
      }
    } catch (err) {
      console.error('Batch merge error:', err);
      showToast('Batch merge failed: ' + err.message, 'error');
    } finally {
      closeProgressModal();
    }
  }

  async function mergeAllAndZip() {
    promptMergeAllAndZip();
  }

  // =========================================================================
  // Helpers
  // =========================================================================
  function createImageThumbnailCanvas(file) {
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        const maxH = 190;
        const scale = Math.min(1, maxH / img.naturalHeight);
        canvas.width = img.naturalWidth * scale;
        canvas.height = img.naturalHeight * scale;
        canvas.className = 'doc-cover-canvas';
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(createFallbackThumbnailCanvas(file.name, 1));
      };
      img.src = url;
    });
  }

  function createFallbackThumbnailCanvas(filename, pNum) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 220;
    canvas.className = 'doc-cover-canvas';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#4f46e5';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DOCUMENT', canvas.width / 2, 70);

    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.fillText(filename.length > 18 ? filename.substr(0, 16) + '...' : filename, canvas.width / 2, 110);
    return canvas;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function convertImageToPngBlob(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => resolve(blob), 'image/png');
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function showProgressModal(title) {
    elements.progressModalTitle.textContent = title;
    elements.progressStatusText.textContent = 'Initializing...';
    elements.progressPercentageText.textContent = '0%';
    elements.progressBarFill.style.width = '0%';
    elements.progressDetailText.textContent = 'Please wait...';
    elements.progressModal.style.display = 'flex';
  }

  function updateProgressModal(status, percentage, detail) {
    elements.progressStatusText.textContent = status || '';
    const pct = Math.min(100, Math.max(0, percentage || 0));
    elements.progressPercentageText.textContent = `${pct}%`;
    elements.progressBarFill.style.width = `${pct}%`;
    if (detail) elements.progressDetailText.textContent = detail;
  }

  function closeProgressModal() {
    elements.progressModal.style.display = 'none';
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `
      <div style="color: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--primary)'}">
        ${iconSvg}
      </div>
      <div>${escapeHtml(message)}</div>
    `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  function sanitizeFilename(name) {
    return name
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .trim();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getInitials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  function generateAvatarColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 65%, 45%)`;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
