/**
 * Blackboard Course Downloader — Content Script Entry Point
 *
 * Injects buttons, monitors SPA page navigations, and communicates
 * with the popup and background service worker.
 */

// ---------------------------------------------------------------------------
// Initialization & SPA Monitoring
// ---------------------------------------------------------------------------

function init() {
  if (!isBlackboard()) return;
  injectButtons();
}

// Initial run
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Watch for Blackboard SPA navigations (history pushes and hash changes)
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(init, 800);
  }
});
observer.observe(document, { subtree: true, childList: true });

// Listen for popstate / hashchange events directly
window.addEventListener("popstate", () => setTimeout(init, 800));
window.addEventListener("hashchange", () => setTimeout(init, 800));

// ---------------------------------------------------------------------------
// Message Handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "DOWNLOAD_STATUS") {
    updateDownloadPanel(request.payload);
    return;
  }

  if (request.action === "trigger_download") {
    downloadCurrentCourse();
    sendResponse({ status: "started" });
  } else if (request.action === "open_course_selector") {
    openCourseSelector();
    sendResponse({ status: "opened" });
  } else if (request.action === "get_status") {
    sendResponse({
      isBlackboard: isBlackboard(),
      courseId: getCourseId(),
      isHomepage: isBlackboardHomepage(),
      courseName: getCourseId() ? getCourseName() : null
    });
  }
});

// Check if any downloads are already in progress
chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_STATUS" }, (status) => {
  if (chrome.runtime.lastError || !status) return;
  if (status.total > 0 && !status.done) {
    createDownloadPanel();
    updateDownloadPanel(status);
  }
});
