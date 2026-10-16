/**
 * Blackboard Course Downloader — Download Orchestrator
 *
 * Manages user settings, gathers original course files uploaded by professors,
 * extracts exact filenames from HTTP Content-Disposition headers, and streams
 * them into a clean, organized ZIP archive (via client-zip).
 */

// ---------------------------------------------------------------------------
// Default Settings
// ---------------------------------------------------------------------------

const SETTING_DEFAULTS = {
  contentTypes: {
    files: true,          // Real course materials uploaded by professors (PDFs, PPTX, DOCX, etc.)
    pages: false,         // Keep disabled so no .md clutter is generated
    announcements: false, // Optional announcements export
    grades: false,        // Optional gradebook export
  },
  conflictAction: "uniquify",
  folderPrefix: "",
  zipMode: true,
  excludeVideos: false,
  maxFileSizeMB: 0,
  exportFormat: "md",
};

/**
 * Loads user settings from chrome.storage.sync.
 */
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTING_DEFAULTS, (settings) => resolve(settings));
  });
}

// ---------------------------------------------------------------------------
// ZIP Streaming & Download Handlers
// ---------------------------------------------------------------------------

let activeAbortController = null;

/**
 * Downloads all prepared items into a single organized ZIP archive.
 */
async function downloadAsZip(items, courseName, settings, log = () => {}) {
  const safeCourseName = sanitizeFilename(courseName);
  const totalItems = items.length;
  let completed = 0;
  let failed = 0;
  const failedFiles = [];

  createDownloadPanel();
  activeAbortController = new AbortController();
  const cancelWatch = setInterval(() => {
    if (downloadCancelled && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
    }
  }, 100);

  async function* fileSource() {
    const now = new Date();
    for (const item of items) {
      if (activeAbortController.signal.aborted) return;

      updateDownloadPanel({
        total: totalItems,
        completed,
        failed,
        queued: totalItems - completed - failed,
        downloading: 1,
        currentFile: item.filename,
        failedFiles,
        done: false,
        cancelled: false,
      });

      try {
        let input;
        let resolvedFilename = item.filename;

        if (item.data) {
          // Pre-generated text / CSV content
          if (typeof item.data === "string") {
            input = new TextEncoder().encode(item.data);
          } else {
            input = item.data;
          }
        } else if (item.url) {
          const res = await fetch(item.url, { signal: activeAbortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          // Extract the exact filename from Content-Disposition headers
          const headerName = extractFilenameFromHeaders(res.headers, item.filename);
          if (headerName) {
            resolvedFilename = headerName;
          }

          input = res.body;
        }

        const fullPath = `${item.path}${resolvedFilename}`;
        completed++;
        yield {
          name: fullPath,
          input,
          lastModified: now,
        };
      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.warn(`[Blackboard Downloader] Failed to fetch ${item.filename}:`, err);
        failed++;
        failedFiles.push(item.filename);
      }
    }
  }

  log("Building ZIP archive (streaming)...");

  let blob;
  try {
    const response = downloadZip(fileSource(), { buffersAreUTF8: true });
    blob = await response.blob();
  } catch (err) {
    clearInterval(cancelWatch);
    if (activeAbortController.signal.aborted || downloadCancelled) {
      log("Cancelled.");
      updateDownloadPanel({
        total: totalItems, completed, failed, queued: 0, downloading: 0,
        currentFile: null, failedFiles, done: true, cancelled: true,
      });
      return { cancelled: true };
    }
    console.error("[Blackboard Downloader] ZIP error:", err);
    updateDownloadPanel({
      total: totalItems, completed, failed, queued: 0, downloading: 0,
      currentFile: "ZIP error — see console", failedFiles, done: true, cancelled: false,
    });
    throw err;
  }

  clearInterval(cancelWatch);

  if (downloadCancelled) {
    updateDownloadPanel({
      total: totalItems, completed, failed, queued: 0, downloading: 0,
      currentFile: null, failedFiles, done: true, cancelled: true,
    });
    return { cancelled: true };
  }

  const url = URL.createObjectURL(blob);
  const prefix = settings.folderPrefix ? `${sanitizeFilename(settings.folderPrefix)}/` : "";
  const filename = `${prefix}${safeCourseName}.zip`;

  await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "START_DOWNLOAD",
        payload: {
          files: [{ url, filename, path: "" }],
          courseName: "",
          conflictAction: settings.conflictAction,
          throttleMs: 0,
          folderPrefix: ""
        }
      },
      (res) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(res);
      }
    );
  });

  setTimeout(() => URL.revokeObjectURL(url), 60000);

  updateDownloadPanel({
    total: totalItems,
    completed,
    failed,
    queued: 0,
    downloading: 0,
    currentFile: null,
    failedFiles,
    done: true,
    cancelled: false,
  });

  log(`Done! ${safeCourseName}.zip saved (${completed} files, ${failed} failed).`);
  return { cancelled: false, completed, failed };
}

/**
 * Downloads items individually into organized subfolders using Chrome downloads API.
 */
async function downloadDirect(items, courseName, settings, log = () => {}) {
  const safeCourseName = sanitizeFilename(courseName);
  const prefix = settings.folderPrefix ? `${sanitizeFilename(settings.folderPrefix)}/` : "";
  const baseFolder = `${prefix}${safeCourseName}/`;

  createDownloadPanel();

  const preparedFiles = [];
  for (const item of items) {
    let url = item.url;
    if (item.data) {
      const blob = new Blob([item.data], { type: "text/plain;charset=utf-8" });
      url = URL.createObjectURL(blob);
    }
    preparedFiles.push({
      url,
      path: `${baseFolder}${item.path}`,
      filename: item.filename,
    });
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "START_DOWNLOAD",
        payload: {
          files: preparedFiles,
          courseName: safeCourseName,
          conflictAction: settings.conflictAction,
          throttleMs: 200,
          folderPrefix: settings.folderPrefix
        }
      },
      (res) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(res);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Course Downloader Workflow
// ---------------------------------------------------------------------------

/**
 * Downloads everything requested for a specific Blackboard course.
 */
async function downloadCourse(courseId, courseName, domain, onProgress = () => {}) {
  const settings = await loadSettings();
  const types = settings.contentTypes;
  downloadCancelled = false;

  onProgress("Scanning course contents and folders...");

  const allItems = [];

  // 1. Fetch Course Files & Attachments (PDFs, Slides, Word docs, ZIPs, etc.)
  if (types.files || types.pages) {
    onProgress("Traversing course folders for files...");
    let { files, pages } = await fetchCourseContentTree(courseId, onProgress);

    // Fallback: If REST API returned nothing (disabled by university), use DOM scraper
    if (files.length === 0) {
      onProgress("Checking visible course files (DOM fallback)...");
      const scraped = scrapeDomCourseFiles();
      files.push(...scraped);
    }

    // Add real uploaded files
    if (types.files) {
      for (const f of files) {
        if (settings.excludeVideos) {
          const lower = f.filename.toLowerCase();
          if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".avi") || lower.endsWith(".mkv")) {
            continue;
          }
        }
        allItems.push(f);
      }
    }

    // Add page notes ONLY if explicitly requested in settings
    if (types.pages && pages.length > 0) {
      for (const p of pages) {
        const content = settings.exportFormat === "html" ? p.html : htmlToMarkdown(p.html, p.title);
        const ext = settings.exportFormat === "html" ? ".html" : ".md";
        allItems.push({
          filename: `${sanitizeFilename(p.title)}${ext}`,
          path: `${p.path}Course Notes/`,
          data: content,
          source: "page-content"
        });
      }
    }
  }

  // 2. Fetch Announcements (optional)
  if (types.announcements) {
    onProgress("Fetching announcements...");
    const announcements = await fetchCourseAnnouncements(courseId);
    if (announcements.length > 0) {
      let docContent = "";
      if (settings.exportFormat === "html") {
        docContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Announcements</title></head><body><h1>Announcements</h1>`;
        for (const a of announcements) {
          docContent += `<hr><h2>${sanitizeFilename(a.title)}</h2><p><small>${a.created || ""}</small></p>${a.body}`;
        }
        docContent += `</body></html>`;
      } else {
        docContent = `# Announcements — ${courseName}\n\n`;
        for (const a of announcements) {
          docContent += `## ${a.title}\n*Posted: ${a.created || "Unknown"}*\n\n${htmlToMarkdown(a.body)}\n---\n\n`;
        }
      }

      allItems.push({
        filename: settings.exportFormat === "html" ? "Announcements.html" : "Announcements.md",
        path: "Announcements/",
        data: docContent,
        source: "announcements"
      });
    }
  }

  // 3. Fetch Grades (optional)
  if (types.grades) {
    onProgress("Fetching grades...");
    const { columns, userGrades } = await fetchCourseGrades(courseId);
    if (columns.length > 0 || userGrades.length > 0) {
      const csvData = exportGradesCsv(columns, userGrades);
      const mdData = exportGradesMarkdown(columns, userGrades, courseName);

      allItems.push({
        filename: "Grades.csv",
        path: "Grades/",
        data: csvData,
        source: "grades-csv"
      });
      allItems.push({
        filename: "Grades.md",
        path: "Grades/",
        data: mdData,
        source: "grades-md"
      });
    }
  }

  if (allItems.length === 0) {
    showToast("No course materials or files found in this course.", "info");
    return { cancelled: false, count: 0 };
  }

  onProgress(`Found ${allItems.length} files. Starting download...`);

  if (settings.zipMode) {
    return await downloadAsZip(allItems, courseName, settings, onProgress);
  } else {
    return await downloadDirect(allItems, courseName, settings, onProgress);
  }
}

/**
 * Downloads the current course the user is looking at.
 */
async function downloadCurrentCourse() {
  const courseId = getCourseId();
  if (!courseId) {
    showToast("Could not detect course ID. Navigate to a Blackboard course first.", "error");
    return;
  }

  const courseName = getCourseName();
  const domain = window.location.origin;

  try {
    await downloadCourse(courseId, courseName, domain, (msg) => {
      console.log(`[Blackboard Downloader] ${msg}`);
    });
  } catch (err) {
    console.error("[Blackboard Downloader] Download failed:", err);
    showToast(`Error: ${err.message || err}`, "error");
  }
}
