/**
 * Blackboard Course Downloader — Blackboard Detection
 *
 * Identifies whether the current page is a Blackboard Learn instance
 * (Ultra or Original), extracts course IDs and names, and determines page type.
 */

// ---------------------------------------------------------------------------
// Detection Signals
// ---------------------------------------------------------------------------

/**
 * Blackboard-specific DOM signals.
 * At least 2 signals are required on unknown domains to avoid false positives.
 */
const BLACKBOARD_SIGNALS = [
  // Ultra & Modern Blackboard Elements
  () => document.querySelector(".bb-avatar, bb-svg-icon, #global-nav-link, .pane-content, .base-layout") !== null,
  () => document.querySelector(".course-outline, #course-outline-title, #course-outline-root") !== null,
  // Classic Original Elements
  () => document.querySelector("#courseMenuPalette_contents, #content_listContainer, #pageTitleBar") !== null,
  () => document.querySelector('link[href*="blackboard"], link[href*="webapps/portal"]') !== null,
  // Meta tags
  () => document.querySelector('meta[name="author"][content*="Blackboard"]') !== null,
  () => document.querySelector('meta[name="application-name"][content*="Blackboard"]') !== null,
  // Inline scripts
  () => {
    const scripts = document.querySelectorAll("script:not([src])");
    for (const s of scripts) {
      const text = s.textContent;
      if (text.includes("Blackboard") || text.includes("bbUI") || text.includes("/webapps/blackboard")) {
        return true;
      }
    }
    return false;
  },
  // Window global flags
  () => typeof window.Blackboard !== "undefined" || typeof window.BB_ !== "undefined"
];

const SIGNAL_THRESHOLD = 2;

/**
 * Checks if the current page belongs to Blackboard Learn.
 */
function isBlackboard() {
  const host = window.location.hostname;
  const path = window.location.pathname;

  // Obvious domain / path signals
  if (host.includes("blackboard.com")) return true;
  if (path.includes("/ultra/") || path.includes("/webapps/blackboard/") || path.includes("/webapps/portal/")) {
    return true;
  }

  // Count DOM signals
  let hits = 0;
  for (const signal of BLACKBOARD_SIGNALS) {
    try {
      if (signal()) hits++;
      if (hits >= SIGNAL_THRESHOLD) return true;
    } catch {
      // Ignore query errors
    }
  }
  return false;
}

/**
 * Extracts the primary course ID from the current URL or DOM.
 * Works across both Blackboard Learn Ultra and Original.
 */
function getCourseId() {
  const path = window.location.pathname;
  const search = window.location.search;
  const hash = window.location.hash;

  // Ultra: /ultra/courses/(_\d+_\d+|[^/?#]+)
  const ultraMatch = path.match(/\/ultra\/courses\/(_\d+_\d+|[^/?#]+)/i);
  if (ultraMatch) return ultraMatch[1];

  // Ultra hash routing fallback
  const hashMatch = hash.match(/\/ultra\/courses\/(_\d+_\d+|[^/?#]+)/i) || hash.match(/courses\/(_\d+_\d+|[^/?#]+)/i);
  if (hashMatch) return hashMatch[1];

  // Original: ?course_id=_12345_1 or &course_id=_12345_1
  const params = new URLSearchParams(search);
  const courseIdParam = params.get("course_id") || params.get("id");
  if (courseIdParam) return courseIdParam;

  // DOM fallback: hidden input or link containing course_id
  const inputEl = document.querySelector('input[name="course_id"], input[id="course_id"]');
  if (inputEl && inputEl.value) return inputEl.value;

  const bodyIdMatch = document.body?.id?.match(/course_(_\d+_\d+)/);
  if (bodyIdMatch) return bodyIdMatch[1];

  return null;
}

/**
 * Extracts human-readable course name from the page.
 */
function getCourseName() {
  // Ultra header title
  const ultraTitle = document.querySelector("#course-outline-title, .course-title, [data-analytics-id*='course.title']");
  if (ultraTitle && ultraTitle.textContent.trim()) {
    return ultraTitle.textContent.trim();
  }

  // Original title elements
  const originalTitle = document.querySelector("#pageTitleText, #courseMenu_link, .courseName, #crumb_1");
  if (originalTitle && originalTitle.textContent.trim()) {
    return originalTitle.textContent.trim().replace(/^Course:\s*/i, "");
  }

  // Page title tag fallback (e.g. "Intro to CS - Blackboard Learn")
  const docTitle = document.title;
  if (docTitle) {
    const clean = docTitle.split(/[-–—|:]/)[0].trim();
    if (clean && !clean.toLowerCase().includes("blackboard")) {
      return clean;
    }
  }

  const id = getCourseId();
  return id ? `Course_${id}` : "Blackboard Course";
}

/**
 * Returns true if user is on the Blackboard homepage / course catalog / dashboard.
 */
function isBlackboardHomepage() {
  if (!isBlackboard()) return false;
  if (getCourseId()) return false;

  const path = window.location.pathname;
  return (
    path.includes("/ultra/course") ||
    path.includes("/ultra/stream") ||
    path.includes("/ultra/institution-page") ||
    path.includes("/webapps/portal")
  );
}

/**
 * Target mount selectors for button injection.
 */
const ULTRA_MOUNT_SELECTORS = [
  "#course-outline-title",
  ".course-title",
  ".course-outline-header",
  "#main-content-header",
  ".breadcrumbs",
  "header .element-details",
  ".ultra-course-header",
  "#base-header"
];

const ORIGINAL_MOUNT_SELECTORS = [
  "#pageTitleBar",
  "#pageTitleText",
  "#courseMenuPalette_contents",
  "#breadcrumbs",
  ".breadcrumbs",
  "#actionbar",
  "#content"
];

const DASHBOARD_MOUNT_SELECTORS = [
  ".stream-header",
  ".course-list-header",
  "#main-content",
  ".base-courses-filter",
  "#portal-page",
  "#content"
];

function findMountPoint(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}
