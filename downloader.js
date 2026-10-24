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

  const usedPaths = new Set();
  const maxBytes = (settings.maxFileSizeMB || 0) * 1024 * 1024;

  async function* fileSource() {
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
        let lastModified = new Date();

        if (item.data) {
          // Pre-generated text / CSV content
          if (typeof item.data === "string") {
            input = new TextEncoder().encode(item.data);
          } else {
            input = item.data;
          }
        } else if (item.url) {
          const res = await fetchWithRetry(item.url, { signal: activeAbortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          if (maxBytes > 0) {
            const len = Number(res.headers.get("content-length"));
            if (len > maxBytes) {
              res.body?.cancel();
              throw new Error(`Larger than ${settings.maxFileSizeMB} MB limit`);
            }
          }

          // Extract the exact filename from Content-Disposition headers
          const headerName = extractFilenameFromHeaders(res.headers, item.filename);
          if (headerName) {
            resolvedFilename = headerName;
          }

          if (settings.excludeVideos && isVideoName(resolvedFilename)) continue;

          input = res.body;
          const lm = Date.parse(res.headers.get("last-modified") || "");
          if (!Number.isNaN(lm)) lastModified = new Date(lm);
        }

        if (input === undefined) throw new Error("No content");

        const fullPath = uniqueName(`${item.path}${resolvedFilename}`, usedPaths);
        yield {
          name: fullPath,
          input,
          lastModified,
        };
        completed++;
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

  const maxBytes = (settings.maxFileSizeMB || 0) * 1024 * 1024;
  const usedPaths = new Set();
  const blobUrls = [];
  const abort = new AbortController();
  activeAbortController = abort;
  const cancelWatch = setInterval(() => {
    if (downloadCancelled) abort.abort();
  }, 100);

  // Resolve real filenames (Content-Disposition) up front, like ZIP mode does.
  let completedSoFar = 0;
  const resolved = await mapPool(items, 5, async (item) => {
    if (abort.signal.aborted) return null;
    if (item.data) {
      const type = item.filename.endsWith(".csv") ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
      const url = URL.createObjectURL(new Blob([item.data], { type }));
      blobUrls.push(url);
      return { url, path: item.path, filename: item.filename };
    }

    let filename = item.filename;
    try {
      const res = await fetchWithRetry(item.url, { signal: abort.signal });
      if (res.ok) {
        filename = extractFilenameFromHeaders(res.headers, item.filename) || filename;
        const len = Number(res.headers.get("content-length"));
        res.body?.cancel();
        if (maxBytes > 0 && len > maxBytes) return null;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return null;
      // Fall back to the provisional name if the header probe fails
    }
    if (settings.excludeVideos && isVideoName(filename)) return null;
    updateDownloadPanel({
      total: items.length, completed: ++completedSoFar, failed: 0, queued: 0, downloading: 1,
      currentFile: `Preparing: ${filename}`, failedFiles: [], done: false, cancelled: false,
    });
    return { url: item.url, path: item.path, filename };
  });
  clearInterval(cancelWatch);

  if (downloadCancelled) {
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
    updateDownloadPanel({
      total: items.length, completed: 0, failed: 0, queued: 0, downloading: 0,
      currentFile: null, failedFiles: [], done: true, cancelled: true,
    });
    return { cancelled: true };
  }

  const preparedFiles = [];
  for (const r of resolved) {
    if (!r) continue;
    const unique = uniqueName(`${baseFolder}${r.path}${r.filename}`, usedPaths);
    const slash = unique.lastIndexOf("/");
    preparedFiles.push({
      url: r.url,
      path: unique.slice(0, slash + 1),
      filename: unique.slice(slash + 1),
    });
  }

  if (blobUrls.length) setTimeout(() => blobUrls.forEach((u) => URL.revokeObjectURL(u)), 10 * 60 * 1000);

  if (preparedFiles.length === 0) {
    showToast("No files left to download after applying your filters.", "info");
    return { cancelled: false, count: 0 };
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
  apiAuthFailed = false;

  // Show the panel right away so the user sees scanning progress
  resetDownloadPanel();
  const baseProgress = onProgress;
  onProgress = (msg) => {
    updateDownloadPanel({ scanning: msg, total: 0, completed: 0, failed: 0, queued: 0, done: false, cancelled: false });
    baseProgress(msg);
  };

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

    // Add real uploaded files (video filtering happens once real filenames are known)
    if (types.files) {
      for (const f of files) {
        allItems.push(f);
      }
    }

    // Add page notes ONLY if explicitly requested in settings
    if (types.pages && pages.length > 0) {
      for (const p of pages) {
        const content = settings.exportFormat === "html"
          ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(p.title)}</title></head><body><h1>${escapeHtml(p.title)}</h1>${sanitizeHtml(p.html)}</body></html>`
          : htmlToMarkdown(p.html, p.title);
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
          docContent += `<hr><h2>${escapeHtml(a.title)}</h2><p><small>${escapeHtml(a.created || "")}</small></p>${sanitizeHtml(a.body)}`;
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
    resetDownloadPanel(true);
    if (apiAuthFailed) {
      showToast("Blackboard denied access (401/403). Your session may have expired — refresh the page and sign in again.", "error");
    } else {
      showToast("No course materials or files found in this course.", "info");
    }
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
