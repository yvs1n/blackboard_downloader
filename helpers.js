/**
 * Blackboard Course Downloader — Pure Utility Helpers
 *
 * Stateless utility functions for sanitization, formatting, MIME detection,
 * Content-Disposition header extraction, and file management.
 */

// ---------------------------------------------------------------------------
// MIME Type to File Extension Mapping
// ---------------------------------------------------------------------------

const MIME_MAP = {
  "application/pdf": ".pdf",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": ".ppsx",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/x-7z-compressed": ".7z",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/markdown": ".md",
  "text/x-python": ".py",
  "application/x-python-code": ".py",
  "text/x-java-source": ".java",
  "text/x-c": ".c",
  "text/x-c++": ".cpp",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav"
};

/**
 * Maps a MIME type string to a common file extension.
 */
function mimeToExt(mime = "") {
  if (!mime) return "";
  const clean = mime.split(";")[0].trim().toLowerCase();
  return MIME_MAP[clean] || "";
}

/**
 * Extracts the real uploaded filename from the HTTP response headers
 * (Content-Disposition), falling back to Content-Type extension if needed.
 */
function extractFilenameFromHeaders(headers, fallbackName = "file") {
  if (!headers) return fallbackName;

  // Retrieve Content-Disposition (case-insensitive in standard Headers object)
  const cd = (typeof headers.get === "function" ? headers.get("content-disposition") : headers["content-disposition"]) || "";
  let extracted = null;

  if (cd) {
    // 1. Try RFC 5987 filename*=UTF-8''filename.ext
    const rfcMatch = cd.match(/filename\*=UTF-8''([^;\n]+)/i);
    if (rfcMatch) {
      try {
        extracted = decodeURIComponent(rfcMatch[1]);
      } catch {
        extracted = rfcMatch[1];
      }
    }

    // 2. Try standard filename="filename.ext" or filename=filename.ext
    if (!extracted) {
      const stdMatch = cd.match(/filename[^;=\n]*=([\'"]?)([^\'";\n]+)\1/i);
      if (stdMatch && stdMatch[2]) {
        extracted = stdMatch[2].trim();
      }
    }
  }

  let finalName = extracted || fallbackName;

  // If the filename still lacks a real extension, attempt to infer it from Content-Type
  if (!/\.[A-Za-z0-9]{1,5}$/.test(finalName)) {
    const ct = (typeof headers.get === "function" ? headers.get("content-type") : headers["content-type"]) || "";
    const ext = mimeToExt(ct);
    if (ext) finalName += ext;
  }

  return sanitizeFilename(finalName);
}

// ---------------------------------------------------------------------------
// String & Path Sanitization
// ---------------------------------------------------------------------------

/** Replaces characters that are invalid or problematic in file and directory paths. */
function sanitizeFilename(name) {
  if (!name) return "untitled";
  const cleaned = String(name)
    .replace(/[\u0000-\u001F\u007F]/g, "")                          // control chars
    .replace(/[\u200B-\u200D\uFEFF]/g, "")                          // zero-width chars
    .replace(/\u00A0/g, " ")                                          // non-breaking space
    .replace(/[/\\?%*:|"<>]/g, "_")                                   // OS-reserved chars
    .replace(/^\.+/, "")                                              // leading dots
    .replace(/[. ]+$/, "")                                            // trailing dots/spaces
    .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, "_$1$2") // Windows reserved names
    .trim();
  return truncateName(cleaned) || "untitled";
}

/** Caps a name at maxLen characters while preserving a short file extension. */
function truncateName(name, maxLen = 120) {
  if (name.length <= maxLen) return name;
  const m = name.match(/\.[A-Za-z0-9]{1,5}$/);
  const ext = m ? m[0] : "";
  return name.slice(0, maxLen - ext.length).replace(/[. ]+$/, "") + ext;
}

/** True for video files the "skip videos" option should drop. */
function isVideoName(name) {
  return /\.(mp4|mov|avi|mkv|webm|m4v|wmv)$/i.test(String(name || ""));
}

/** Escapes text for safe interpolation into HTML. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Makes a name unique within a set by appending " (n)" before the extension. */
function uniqueName(fullPath, usedSet) {
  const key = (p) => p.toLowerCase();
  if (!usedSet.has(key(fullPath))) {
    usedSet.add(key(fullPath));
    return fullPath;
  }
  const dot = fullPath.lastIndexOf(".");
  const slash = fullPath.lastIndexOf("/");
  const hasExt = dot > slash + 1;
  const base = hasExt ? fullPath.slice(0, dot) : fullPath;
  const ext = hasExt ? fullPath.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!usedSet.has(key(candidate))) {
      usedSet.add(key(candidate));
      return candidate;
    }
  }
}

/** Formats bytes to human-readable size string. */
function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/** Formats points value. */
function formatPoints(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : String(n);
}

// ---------------------------------------------------------------------------
// HTML Cleaning & Sanitization
// ---------------------------------------------------------------------------

/**
 * Strips potentially-dangerous markup before saving HTML to disk.
 * Uses inert <template> element so no script execution occurs.
 */
function sanitizeHtml(html) {
  if (!html) return "";
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const el of [...tpl.content.querySelectorAll("script, noscript, style")]) {
    el.remove();
  }
  for (const el of [...tpl.content.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return tpl.innerHTML;
}

/**
 * Cleans Blackboard rich-text HTML editor artifacts while preserving content.
 */
function cleanBlackboardHtml(html) {
  if (!html) return "";
  const tpl = document.createElement("template");
  tpl.innerHTML = html;

  for (const p of [...tpl.content.querySelectorAll("p")]) {
    if (!p.textContent.trim() && !p.querySelector("img, br, hr, svg, video, iframe")) {
      p.remove();
    }
  }

  for (const span of [...tpl.content.querySelectorAll("span")]) {
    if (!span.querySelector("*") && !span.textContent.trim()) {
      span.replaceWith(document.createTextNode(span.textContent));
    }
  }

  return tpl.innerHTML;
}

/**
 * Converts HTML content to clean, readable Markdown using Turndown.
 */
function htmlToMarkdown(html, title = "") {
  if (!html) return title ? `# ${title}\n` : "";
  const cleaned = cleanBlackboardHtml(sanitizeHtml(html));
  
  if (typeof TurndownService !== "undefined") {
    try {
      const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        hr: "---"
      });
      if (typeof turndownPluginGfm !== "undefined" && turndownPluginGfm.gfm) {
        td.use(turndownPluginGfm.gfm);
      }
      let md = td.turndown(cleaned).trim();
      if (title && !md.startsWith("# ")) {
        md = `# ${title}\n\n${md}`;
      }
      return md + "\n";
    } catch (err) {
      console.warn("[Blackboard Downloader] Turndown conversion error:", err);
    }
  }

  const tpl = document.createElement("template");
  tpl.innerHTML = cleaned;
  const text = tpl.content.textContent.trim();
  return title ? `# ${title}\n\n${text}\n` : `${text}\n`;
}

// ---------------------------------------------------------------------------
// Term Inference
// ---------------------------------------------------------------------------

/**
 * Infers term name from courseCode (e.g. "26sprg-CS101", "2025_FALL_MATH", etc.).
 */
function inferTerm(courseCode = "", fallback = "Current Term") {
  if (!courseCode) return fallback;
  
  const m1 = courseCode.match(/(\d{2})(sprg|fall|sum[123]?|wtr|win)/i);
  if (m1) {
    const yy = m1[1];
    const sem = m1[2].toLowerCase();
    const semNames = {
      sprg: "Spring",
      fall: "Fall",
      sum: "Summer",
      sum1: "Summer 1",
      sum2: "Summer 2",
      sum3: "Summer 3",
      wtr: "Winter",
      win: "Winter"
    };
    return `${semNames[sem] || sem.toUpperCase()} 20${yy}`;
  }

  const m2 = courseCode.match(/(20\d{2})[-_](FA|SP|SU|WI|FALL|SPRING|SUMMER|WINTER)/i);
  if (m2) {
    const year = m2[1];
    const sem = m2[2].toUpperCase();
    const map = {
      FA: "Fall", FALL: "Fall",
      SP: "Spring", SPRING: "Spring",
      SU: "Summer", SUMMER: "Summer",
      WI: "Winter", WINTER: "Winter"
    };
    return `${map[sem] || sem} ${year}`;
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Grades Exporters
// ---------------------------------------------------------------------------

function buildGradeMap(userGrades) {
  const list = Array.isArray(userGrades) ? userGrades : (Array.isArray(userGrades?.results) ? userGrades.results : []);
  const gradeMap = new Map();
  for (const g of list) {
    if (g && g.columnId) gradeMap.set(g.columnId, g);
  }
  return gradeMap;
}

/** Quotes a CSV cell and neutralizes spreadsheet formula injection. */
function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function exportGradesCsv(columns = [], userGrades = []) {
  const gradeMap = buildGradeMap(userGrades);

  const rows = [["Item Name", "Score", "Points Possible", "Status", "Feedback"].map(csvCell)];
  for (const col of columns) {
    const g = gradeMap.get(col.id) || {};
    const title = col.name || col.displayName || "Untitled Column";
    const score = g.displayGrade ?? g.score ?? "";
    const possible = col.score?.possible ?? col.pointsPossible ?? "";
    const status = g.status || (score === "" ? "Not graded" : "Graded");
    const feedback = (g.feedback || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    rows.push([title, score, possible, status, feedback].map(csvCell));
  }

  // UTF-8 BOM so Excel decodes non-ASCII text correctly
  return "﻿" + rows.map(r => r.join(",")).join("\r\n");
}

function exportGradesMarkdown(columns = [], userGrades = [], courseName = "") {
  const gradeMap = buildGradeMap(userGrades);

  let md = `# Grades — ${courseName || "Course"}\n\n`;
  md += "| Item | Score | Points Possible | Status | Feedback |\n";
  md += "| :--- | :--- | :--- | :--- | :--- |\n";

  for (const col of columns) {
    const g = gradeMap.get(col.id) || {};
    const title = (col.name || col.displayName || "Untitled").replace(/\|/g, "\\|");
    const score = String(g.displayGrade ?? g.score ?? "—").replace(/\|/g, "\\|");
    const possible = String(col.score?.possible ?? col.pointsPossible ?? "—").replace(/\|/g, "\\|");
    const hasScore = (g.displayGrade ?? g.score) != null;
    const status = (g.status || (hasScore ? "Graded" : "Not graded")).replace(/\|/g, "\\|");
    const feedback = (g.feedback || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim() || "—";

    md += `| ${title} | ${score} | ${possible} | ${status} | ${feedback} |\n`;
  }

  return md + "\n";
}

function parsePaginationNext(data, linkHeader = null) {
  if (data?.paging?.nextPage) {
    return data.paging.nextPage;
  }
  if (linkHeader) {
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
    if (match) return match[1];
  }
  return null;
}
