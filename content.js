/**
 * Blackboard Course Downloader — Content Script Entry Point
 *
 * Injects buttons, monitors SPA page navigations, and communicates
 * with the popup and background service worker. Only activates on Blackboard.
 */

(() => {
  let isInitialized = false;

  function startExtension() {
    if (isInitialized) return;
    isInitialized = true;

    // Run initial button injection
    injectButtons();
    setTimeout(injectButtons, 400);
    setTimeout(injectButtons, 1200);
    setTimeout(injectButtons, 2500);

    // Watch for Blackboard SPA navigations and dynamic component rendering
    let lastUrl = location.href;
    let debounceTimer = null;

    function scheduleInject(delay = 250) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        injectButtons();
      }, delay);
    }

    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scheduleInject(300);
        setTimeout(() => scheduleInject(0), 1000);
        setTimeout(() => scheduleInject(0), 2000);
      } else {
        const courseId = getCourseId();
        const hasCourseBtn = !!document.getElementById("bb-injected-btn");
        const hasHomeBtn = !!document.getElementById("bb-injected-home-btn");

        if ((courseId && !hasCourseBtn) || (!courseId && !hasHomeBtn)) {
          scheduleInject(200);
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      subtree: true,
      childList: true
    });

    // Hook history API to react immediately to client-side routing
    const origPush = history.pushState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      scheduleInject(300);
      setTimeout(() => scheduleInject(0), 1200);
    };

    const origReplace = history.replaceState;
    history.replaceState = function (...args) {
      origReplace.apply(this, args);
      scheduleInject(300);
      setTimeout(() => scheduleInject(0), 1200);
    };

    window.addEventListener("popstate", () => scheduleInject(300));
    window.addEventListener("hashchange", () => scheduleInject(300));

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
  }

  // Initial check
  if (isBlackboard()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startExtension);
    } else {
      startExtension();
    }
  } else {
    // If not detected immediately on unknown custom school domains, retry during page load
    let checks = 0;
    const interval = setInterval(() => {
      checks++;
      if (isBlackboard()) {
        clearInterval(interval);
        startExtension();
      } else if (checks > 10) {
        clearInterval(interval);
      }
    }, 500);

    // Keep lightweight message response active for popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "get_status") {
        sendResponse({ isBlackboard: isBlackboard() });
        return true;
      }
    });
  }
})();
