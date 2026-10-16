/**
 * Blackboard Course Downloader — Content Script Entry Point
 *
 * Injects buttons, monitors SPA page navigations, and communicates
 * with the popup and background service worker. Only activates on Blackboard.
 */

(() => {
  // If not Blackboard, register lightweight response for popup inspection, then exit
  if (!isBlackboard()) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "get_status") {
        sendResponse({ isBlackboard: false });
        return true;
      }
    });
    return;
  }

  // Blackboard page logic
  function init() {
    injectButtons();
  }

  // Initial execution
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

  window.addEventListener("popstate", () => setTimeout(init, 800));
  window.addEventListener("hashchange", () => setTimeout(init, 800));

  // Message Handling
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "DOWNLOAD_STATUS") {
      updateDownloadPanel(request.payload);
      sendResponse({ received: true });
      return true;
    }

    if (request.action === "trigger_download") {
      downloadCurrentCourse();
      sendResponse({ status: "started" });
      return true;
    } else if (request.action === "open_course_selector") {
      openCourseSelector();
      sendResponse({ status: "opened" });
      return true;
    } else if (request.action === "get_status") {
      sendResponse({
        isBlackboard: true,
        courseId: getCourseId(),
        isHomepage: isBlackboardHomepage(),
        courseName: getCourseId() ? getCourseName() : null
      });
      return true;
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
})();
