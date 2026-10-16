/**
 * Blackboard Course Downloader — Blackboard API Client
 *
 * Handles communication with Blackboard Learn REST API under the active
 * authenticated browser session. Recursively traverses all course containers,
 * folders, learning modules, content attachments, WebDAV files, and DOM links.
 */

const FETCH_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      if (attempt === retries) return res;

      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      console.warn(`[Blackboard Downloader] ${res.status} on ${url}, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      console.warn(`[Blackboard Downloader] Network error on ${url}, retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function fetchAllPages(url, options = {}) {
  const results = [];
  let next = url;
  const domain = window.location.origin;

  while (next) {
    try {
      const res = await fetchWithRetry(next, {
        headers: { Accept: "application/json", ...options.headers },
        ...options
      });

      if (!res.ok) {
        console.warn(`[Blackboard Downloader] API ${res.status} on ${next}`);
        break;
      }

      const data = await res.json();
      if (Array.isArray(data.results)) {
        results.push(...data.results);
      } else if (Array.isArray(data)) {
        results.push(...data);
      }

      const nextPage = data?.paging?.nextPage;
      if (nextPage) {
        next = nextPage.startsWith("http") ? nextPage : `${domain}${nextPage}`;
      } else {
        next = null;
      }
    } catch (err) {
      console.error("[Blackboard Downloader] Pagination error:", err);
      break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helper: Content Handler Inspection
// ---------------------------------------------------------------------------

function getHandlerId(item) {
  if (!item) return "";
  if (typeof item.contentHandler === "string") return item.contentHandler.toLowerCase();
  if (typeof item.contentHandler === "object" && item.contentHandler !== null) {
    return (item.contentHandler.id || "").toLowerCase();
  }
  return "";
}

function isContainerNode(item) {
  if (!item) return false;
  if (item.hasChildren === true) return true;
  const hId = getHandlerId(item);
  return (
    hId.includes("folder") ||
    hId.includes("lesson") ||
    hId.includes("module") ||
    hId.includes("blankpage") ||
    hId.includes("courselink") ||
    hId.includes("learningunit") ||
    hId.includes("toc")
  );
}

// ---------------------------------------------------------------------------
// User & Course APIs
// ---------------------------------------------------------------------------

async function getCurrentUser() {
  const domain = window.location.origin;
  try {
    const res = await fetchWithRetry(`${domain}/learn/api/public/v1/users/me`, {
      headers: { Accept: "application/json" }
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("[Blackboard Downloader] Could not fetch /users/me:", err);
  }
  return null;
}

async function fetchCourseDetails(courseId) {
  const domain = window.location.origin;
  try {
    const res = await fetchWithRetry(`${domain}/learn/api/public/v1/courses/${courseId}`, {
      headers: { Accept: "application/json" }
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(`[Blackboard Downloader] Failed to fetch course detail for ${courseId}:`, err);
  }
  return null;
}

async function fetchAllCourses() {
  const domain = window.location.origin;
  const user = await getCurrentUser();
  const userId = user?.id || "me";

  let enrollments = [];
  try {
    enrollments = await fetchAllPages(`${domain}/learn/api/public/v1/users/${userId}/courses?limit=100`);
  } catch (err) {
    console.warn("[Blackboard Downloader] Failed to fetch user course enrollments:", err);
  }

  const courses = [];
  const seenIds = new Set();

  for (const enr of enrollments) {
    const rawId = enr.courseId;
    if (!rawId || seenIds.has(rawId)) continue;
    seenIds.add(rawId);

    const detail = await fetchCourseDetails(rawId);
    if (detail) {
      const code = detail.courseId || "";
      const name = detail.name || "Untitled Course";
      const termName = detail.term?.name || inferTerm(code, "Current Term");

      courses.push({
        id: rawId,
        name: name,
        safeName: sanitizeFilename(name),
        courseCode: code,
        term: termName,
        isCompleted: enr.enrollmentStatus === "Completed" || detail.status === "Closed"
      });
    } else {
      courses.push({
        id: rawId,
        name: `Course ${rawId}`,
        safeName: sanitizeFilename(`Course ${rawId}`),
        courseCode: rawId,
        term: "Current Term",
        isCompleted: false
      });
    }
  }

  return courses.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Course Content & Real Material Extraction
// ---------------------------------------------------------------------------

const COMMON_DOC_EXTS = new Set([
  ".pdf", ".ppt", ".pptx", ".ppsx", ".doc", ".docx", ".xls", ".xlsx",
  ".txt", ".csv", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".py", ".java", ".cpp", ".c", ".h", ".cs", ".js", ".ts",
  ".html", ".css", ".json", ".xml", ".sql", ".r", ".ipynb", ".mat", ".m",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".mp3", ".wav", ".mp4", ".mov", ".avi", ".mkv"
]);

/**
 * Extracts real uploaded file links embedded within rich-text Blackboard HTML.
 */
function extractLinksFromBody(bodyHtml, currentPath, courseDomain) {
  if (!bodyHtml) return [];
  const files = [];
  const tpl = document.createElement("template");
  tpl.innerHTML = bodyHtml;

  const anchors = tpl.content.querySelectorAll("a");
  for (const a of anchors) {
    // 1. Blackboard data-bbfile attribute (JSON containing file metadata)
    const bbfile = a.getAttribute("data-bbfile");
    if (bbfile) {
      try {
        const info = JSON.parse(bbfile);
        const displayName = info.displayName || info.linkName || a.textContent.trim() || "file";
        const url = info.resourceUrl || a.getAttribute("href");
        if (url) {
          const absUrl = url.startsWith("http") ? url : `${courseDomain}${url.startsWith("/") ? "" : "/"}${url}`;
          files.push({
            filename: sanitizeFilename(displayName),
            url: absUrl,
            path: currentPath,
            source: "embedded-bbfile"
          });
          continue;
        }
      } catch {
        // Fallback to standard href below
      }
    }

    // 2. Standard WebDAV or content handler links
    const href = a.getAttribute("href");
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;

    const isWebDav = href.includes("/bbcswebdav/");
    const isBbContent = href.includes("/webapps/blackboard/execute/content/file");
    
    // Check extension
    const urlClean = href.split("?")[0].split("#")[0];
    const rawName = decodeURIComponent(urlClean.split("/").pop() || "");
    const ext = rawName.includes(".") ? `.${rawName.split(".").pop().toLowerCase()}` : "";

    if (isWebDav || isBbContent || COMMON_DOC_EXTS.has(ext)) {
      let displayName = a.textContent.trim() || rawName || "download";
      if (!displayName.includes(".") && ext) {
        displayName += ext;
      }
      const absUrl = href.startsWith("http") ? href : `${courseDomain}${href.startsWith("/") ? "" : "/"}${href}`;
      files.push({
        filename: sanitizeFilename(displayName),
        url: absUrl,
        path: currentPath,
        source: "embedded-link"
      });
    }
  }

  return files;
}

/**
 * Traverses course content hierarchy recursively.
 * Returns { files: [...], pages: [...] }
 */
async function fetchCourseContentTree(courseId, onStatus = () => {}) {
  const domain = window.location.origin;
  const files = [];
  const pages = [];
  const visitedNodes = new Set();
  const addedUrls = new Set();

  function addFile(fileObj) {
    if (!fileObj.url) return;
    if (addedUrls.has(fileObj.url)) return;
    addedUrls.add(fileObj.url);
    files.push(fileObj);
  }

  async function processNode(node, currentPath) {
    if (!node || !node.id || visitedNodes.has(node.id)) return;
    visitedNodes.add(node.id);

    const title = node.title || "Untitled";
    const safeTitle = sanitizeFilename(title);
    const handlerId = getHandlerId(node);
    const isFolder = isContainerNode(node);

    // If it's a folder or module, sub-items live in its subfolder
    const childPath = isFolder ? `${currentPath}${safeTitle}/` : currentPath;

    onStatus(`Scanning: ${title}`);

    // Fetch node detail
    let detail = null;
    try {
      const detailRes = await fetchWithRetry(`${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}`);
      if (detailRes.ok) {
        detail = await detailRes.json();
      }
    } catch (err) {
      console.warn(`[Blackboard Downloader] Could not fetch detail for ${node.id}:`, err);
    }

    // 1. Direct File Attachments endpoint (most common for slides, PDFs, problem sets)
    try {
      const attRes = await fetchWithRetry(`${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}/attachments`);
      if (attRes.ok) {
        const attData = await attRes.json();
        const results = Array.isArray(attData.results) ? attData.results : (Array.isArray(attData) ? attData : []);
        for (const att of results) {
          if (!att.id) continue;
          let filename = att.fileName || att.name || title;
          const dlUrl = `${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}/attachments/${att.id}/download`;
          
          addFile({
            filename: sanitizeFilename(filename),
            url: dlUrl,
            path: childPath,
            source: "attachment"
          });
        }
      }
    } catch (err) {
      console.warn(`[Blackboard Downloader] Could not fetch attachments for ${node.id}:`, err);
    }

    // 2. ContentHandler File Object (e.g. resource/x-bb-file)
    const fileObj = (typeof node.contentHandler === "object" ? node.contentHandler?.file : null) ||
                    (typeof detail?.contentHandler === "object" ? detail?.contentHandler?.file : null);
    if (fileObj && fileObj.id) {
      const fName = fileObj.name || title;
      const dlUrl = `${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}/attachments/${fileObj.id}/download`;
      addFile({
        filename: sanitizeFilename(fName),
        url: dlUrl,
        path: childPath,
        source: "contentHandler-file"
      });
    }

    // 3. Embedded files from body HTML (e.g. data-bbfile, WebDAV, direct file links)
    const body = detail?.body || node.body || "";
    if (body) {
      const embedded = extractLinksFromBody(body, childPath, domain);
      for (const ef of embedded) {
        addFile(ef);
      }

      // Record text note only if needed
      pages.push({
        title: title,
        html: body,
        path: isFolder ? `${childPath}` : currentPath,
        filename: `${safeTitle}.md`,
        created: detail?.created || node.created
      });
    }

    // 4. Recurse into children (folders, learning modules, lessons)
    // Check if it's a container or if it might have children
    if (isFolder || node.hasChildren !== false) {
      try {
        const children = await fetchAllPages(`${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}/children?limit=100`);
        if (Array.isArray(children) && children.length > 0) {
          for (const child of children) {
            await processNode(child, childPath);
          }
        }
      } catch (err) {
        console.warn(`[Blackboard Downloader] Could not fetch children for ${node.id}:`, err);
      }
    }
  }

  // Fetch top-level course contents
  try {
    const topLevel = await fetchAllPages(`${domain}/learn/api/public/v1/courses/${courseId}/contents?limit=100`);
    if (Array.isArray(topLevel)) {
      for (const item of topLevel) {
        await processNode(item, "");
      }
    }
  } catch (err) {
    console.error("[Blackboard Downloader] Failed to fetch top level contents:", err);
  }

  // 5. Check Course Resources (Content Collection Course Files) if top-level contents had few files
  try {
    const resources = await fetchAllPages(`${domain}/learn/api/public/v1/courses/${courseId}/resources?limit=100`);
    if (Array.isArray(resources) && resources.length > 0) {
      onStatus("Scanning course resource files...");
      for (const res of resources) {
        if (res.type === "File" || (!res.type && res.name && res.name.includes("."))) {
          const dlUrl = res.downloadUrl || `${domain}/learn/api/public/v1/courses/${courseId}/resources/${res.id}`;
          addFile({
            filename: sanitizeFilename(res.name || "resource"),
            url: dlUrl,
            path: "Course Files/",
            source: "course-resources"
          });
        }
      }
    }
  } catch {
    // Course resources endpoint is optional; ignore if disabled
  }

  return { files, pages };
}

// ---------------------------------------------------------------------------
// Course Announcements & Grades
// ---------------------------------------------------------------------------

async function fetchCourseAnnouncements(courseId) {
  const domain = window.location.origin;
  try {
    const announcements = await fetchAllPages(`${domain}/learn/api/public/v1/courses/${courseId}/announcements?limit=100`);
    return announcements.map(a => ({
      title: a.title || "Announcement",
      body: a.body || "",
      created: a.created || "",
      modified: a.modified || ""
    }));
  } catch (err) {
    console.warn(`[Blackboard Downloader] Could not fetch announcements for ${courseId}:`, err);
    return [];
  }
}

async function fetchCourseGrades(courseId, userId = null) {
  const domain = window.location.origin;
  const uid = userId || (await getCurrentUser())?.id || "me";

  let columns = [];
  let userGrades = [];

  try {
    columns = await fetchAllPages(`${domain}/learn/api/public/v1/courses/${courseId}/gradebook/columns?limit=100`);
  } catch (err) {
    console.warn("[Blackboard Downloader] Could not fetch gradebook columns:", err);
  }

  try {
    const res = await fetchWithRetry(`${domain}/learn/api/public/v2/courses/${courseId}/gradebook/users/${uid}`);
    if (res.ok) {
      const data = await res.json();
      userGrades = data.results || data || [];
    }
  } catch (err) {
    console.warn("[Blackboard Downloader] Could not fetch student user grades:", err);
  }

  return { columns, userGrades };
}

// ---------------------------------------------------------------------------
// DOM Scraper Fallback
// ---------------------------------------------------------------------------

/**
 * Fallback DOM scraper if REST API is disabled or blocked on this university instance.
 */
function scrapeDomCourseFiles() {
  const domain = window.location.origin;
  const files = [];
  const seenUrls = new Set();

  const links = document.querySelectorAll(
    'a[href*="/bbcswebdav/"], a[href*="content/file"], a[data-bbfile], a[href$=".pdf"], a[href$=".docx"], a[href$=".pptx"], a[href$=".zip"], a[href$=".xlsx"], a[href$=".doc"], a[href$=".ppt"]'
  );

  for (const a of links) {
    let url = a.getAttribute("href") || "";
    let name = a.textContent.trim();

    const bbfile = a.getAttribute("data-bbfile");
    if (bbfile) {
      try {
        const info = JSON.parse(bbfile);
        name = info.displayName || info.linkName || name;
        url = info.resourceUrl || url;
      } catch {}
    }

    if (!url || url.startsWith("javascript:")) continue;
    const absUrl = url.startsWith("http") ? url : `${domain}${url.startsWith("/") ? "" : "/"}${url}`;
    if (seenUrls.has(absUrl)) continue;
    seenUrls.add(absUrl);

    const sectionEl = a.closest(".liItem, .course-outline-item, .element-details, .item, li");
    const sectionTitle = sectionEl?.querySelector("h3, .item-title, .title, strong")?.textContent?.trim() || "";

    const path = sectionTitle ? `${sanitizeFilename(sectionTitle)}/` : "";
    const filename = sanitizeFilename(name || absUrl.split("/").pop().split("?")[0] || "file");

    files.push({
      filename,
      url: absUrl,
      path,
      source: "dom-scraper"
    });
  }

  return files;
}
