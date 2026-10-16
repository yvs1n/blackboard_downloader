/**
 * Blackboard Course Downloader — Pure Utility Helpers
 *
 * Stateless utility functions for sanitization, formatting, HTML cleaning,
 * and Markdown/CSV export.
 */

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
  return cleaned || "untitled";
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

  // Remove empty paragraphs that only add unnecessary whitespace
  for (const p of [...tpl.content.querySelectorAll("p")]) {
    if (!p.textContent.trim() && !p.querySelector("img, br, hr, svg, video, iframe")) {
      p.remove();
    }
  }

  // Unwrap redundant empty styling spans
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
      console.warn("[Blackboard Downloader] Turndown conversion failed, falling back to text:", err);
    }
  }

  // Fallback if Turndown is not loaded
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
  
  // Format: 26sprg, 25fall, 24sum1
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

  // Format: 2026_FA, 2025_SP, 2024_SU
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

/**
 * Generates a clean CSV file from gradebook columns and user scores.
 */
function exportGradesCsv(columns = [], userGrades = []) {
  const gradeMap = new Map();
  for (const g of userGrades) {
    if (g.columnId) gradeMap.set(g.columnId, g);
  }

  const rows = [["Item Name", "Score", "Points Possible", "Status", "Feedback"]];
  for (const col of columns) {
    const g = gradeMap.get(col.id) || {};
    const title = col.name || col.displayName || "Untitled Column";
    const score = g.displayGrade ?? g.score ?? "";
    const possible = col.score?.possible ?? col.pointsPossible ?? "";
    const status = g.status || "Graded";
    const feedback = (g.feedback || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    rows.push([
      `"${title.replace(/"/g, '""')}"`,
      `"${String(score).replace(/"/g, '""')}"`,
      `"${String(possible).replace(/"/g, '""')}"`,
      `"${String(status).replace(/"/g, '""')}"`,
      `"${feedback.replace(/"/g, '""')}"`
    ]);
  }

  return rows.map(r => r.join(",")).join("\n");
}

/**
 * Generates a Markdown document from gradebook columns and user scores.
 */
function exportGradesMarkdown(columns = [], userGrades = [], courseName = "") {
  const gradeMap = new Map();
  for (const g of userGrades) {
    if (g.columnId) gradeMap.set(g.columnId, g);
  }

  let md = `# Grades — ${courseName || "Course"}\n\n`;
  md += "| Item | Score | Points Possible | Status | Feedback |\n";
  md += "| :--- | :--- | :--- | :--- | :--- |\n";

  for (const col of columns) {
    const g = gradeMap.get(col.id) || {};
    const title = (col.name || col.displayName || "Untitled").replace(/\|/g, "\\|");
    const score = String(g.displayGrade ?? g.score ?? "—").replace(/\|/g, "\\|");
    const possible = String(col.score?.possible ?? col.pointsPossible ?? "—").replace(/\|/g, "\\|");
    const status = (g.status || "Graded").replace(/\|/g, "\\|");
    const feedback = (g.feedback || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim() || "—";

    md += `| ${title} | ${score} | ${possible} | ${status} | ${feedback} |\n`;
  }

  return md + "\n";
}

// ---------------------------------------------------------------------------
// Pagination Helper
// ---------------------------------------------------------------------------

/**
 * Extracts the next page URL from Blackboard JSON response (paging.nextPage)
 * or RFC 5988 Link header.
 */
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
