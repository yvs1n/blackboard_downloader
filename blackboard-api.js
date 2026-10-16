/**
 * Blackboard Course Downloader — Blackboard API Client
 *
 * Handles communication with Blackboard Learn REST API under the active
 * authenticated browser session. Supports retry with backoff, pagination,
 * recursive folder tree traversal, and DOM fallback.
 */

const FETCH_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

/**
 * Fetches a resource with timeout.
 */
function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

/**
 * Fetches with retry and exponential backoff for rate limits and transient errors.
 */
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
      console.warn(`[Blackboard Downloader] Network error on ${url}, retrying in ${delay}ms...`, err);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Fetches all pages for a paginated Blackboard endpoint using paging.nextPage.
 */
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
// User & Course APIs
// ---------------------------------------------------------------------------

/**
 * Retrieves the currently logged-in user profile.
 */
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

/**
 * Retrieves course details (name, course code, term, description).
 */
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

/**
 * Fetches all courses the current user is enrolled in.
 */
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
// Course Content & File Extraction
// ---------------------------------------------------------------------------

const COMMON_DOC_EXTS = new Set([
  ".pdf", ".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx",
  ".txt", ".csv", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".py", ".java", ".cpp", ".c", ".h", ".cs", ".js", ".ts",
  ".html", ".css", ".json", ".xml", ".sql", ".r", ".ipynb",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".mp3", ".wav", ".mp4", ".mov"
]);

/**
 * Extracts downloadable links embedded within rich-text Blackboard HTML.
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
        const filename = sanitizeFilename(info.displayName || info.linkName || "attachment");
        const url = info.resourceUrl || a.getAttribute("href");
        if (url) {
          const absUrl = url.startsWith("http") ? url : `${courseDomain}${url.startsWith("/") ? "" : "/"}${url}`;
          files.push({
            filename,
            url: absUrl,
            path: currentPath,
            source: "embedded-bbfile"
          });
          continue;
        }
      } catch {
        // Fallback to standard href
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

  async function processNode(node, currentPath) {
    if (!node || !node.id || visitedNodes.has(node.id)) return;
    visitedNodes.add(node.id);

    const title = node.title || "Untitled Section";
    const safeTitle = sanitizeFilename(title);
    const nodePath = `${currentPath}${safeTitle}/`;

    onStatus(`Scanning: ${title}`);

    // 1. Fetch item details (includes body text)
    try {
      const detailRes = await fetchWithRetry(`${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}`);
      if (detailRes.ok) {
        const detail = await detailRes.json();
        const body = detail.body || "";

        // Extract embedded files from body
        if (body) {
          const embedded = extractLinksFromBody(body, nodePath, domain);
          files.push(...embedded);

          // Save page text as documentation/notes
          pages.push({
            title: title,
            html: body,
            path: nodePath,
            filename: `${safeTitle}.md`,
            created: detail.created
          });
        }
      }
    } catch (err) {
      console.warn(`[Blackboard Downloader] Could not fetch detail for ${node.id}:`, err);
    }

    // 2. Fetch direct file attachments
    try {
      const attRes = await fetchWithRetry(`${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}/attachments`);
      if (attRes.ok) {
        const attData = await attRes.json();
        const results = attData.results || [];
        for (const att of results) {
          const filename = sanitizeFilename(att.fileName || "attachment");
          const dlUrl = `${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}/attachments/${att.id}/download`;
          files.push({
            filename,
            url: dlUrl,
            path: nodePath,
            source: "attachment"
          });
        }
      }
    } catch (err) {
      console.warn(`[Blackboard Downloader] Could not fetch attachments for ${node.id}:`, err);
    }

    // 3. Recurse into children (folders, learning modules)
    if (node.hasChildren || node.contentHandler?.includes("folder") || node.contentHandler?.includes("lesson")) {
      try {
        const children = await fetchAllPages(`${domain}/learn/api/public/v1/courses/${courseId}/contents/${node.id}/children?limit=100`);
        for (const child of children) {
          await processNode(child, nodePath);
        }
      } catch (err) {
        console.warn(`[Blackboard Downloader] Could not fetch children for ${node.id}:`, err);
      }
    }
  }

  // Fetch top-level course contents
  try {
    const topLevel = await fetchAllPages(`${domain}/learn/api/public/v1/courses/${courseId}/contents?limit=100`);
    for (const item of topLevel) {
      await processNode(item, "");
    }
  } catch (err) {
    console.error("[Blackboard Downloader] Failed to fetch top level contents:", err);
  }

  return { files, pages };
}

/**
 * Fetches course announcements.
 */
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

/**
 * Fetches course grades for the current user.
 */
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
    'a[href*="/bbcswebdav/"], a[href*="content/file"], a[data-bbfile], a[href$=".pdf"], a[href$=".docx"], a[href$=".pptx"], a[href$=".zip"]'
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

    // Try finding section name
    const sectionEl = a.closest(".liItem, .course-outline-item, .item, li");
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
