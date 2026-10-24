/**
 * Blackboard Course Downloader — Popup Script
 */

const CONTENT_TYPE_LABELS = {
  files: "Course Materials & Slides",
  pages: "Pages & Notes",
  announcements: "Announcements",
  grades: "Grades"
};

document.addEventListener("DOMContentLoaded", () => {
  const banner = document.getElementById("statusBanner");
  const statusText = document.getElementById("statusText");
  const courseInfo = document.getElementById("courseInfo");
  const courseNameEl = document.getElementById("courseName");
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadBtnLabel = document.getElementById("downloadBtnLabel");
  const contentTagsEl = document.getElementById("contentTags");
  const queuePanel = document.getElementById("queuePanel");

  // Open settings page
  document.getElementById("settingsLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Load configured content types (Files = true by default, others false)
  function renderTags() {
    chrome.storage.sync.get({
      contentTypes: { files: true, pages: false, announcements: false, grades: false },
      zipMode: true
    }, (settings) => {
      contentTagsEl.textContent = "";
      for (const [key, label] of Object.entries(CONTENT_TYPE_LABELS)) {
        const tag = document.createElement("span");
        tag.className = `content-tag${settings.contentTypes[key] ? " active" : ""}`;
        tag.textContent = label;
        contentTagsEl.appendChild(tag);
      }
      const mode = document.createElement("span");
      mode.className = "content-tag active";
      mode.textContent = settings.zipMode ? "Saved as one ZIP" : "Saved as separate files";
      contentTagsEl.appendChild(mode);
    });
  }
  renderTags();
  chrome.storage.onChanged.addListener(renderTags);

  // Track background download queue
  function checkQueue() {
    chrome.runtime.sendMessage({ type: "GET_DOWNLOAD_STATUS" }, (status) => {
      const err = chrome.runtime.lastError;
      if (err || !status || status.total === 0 || status.done) {
        queuePanel.style.display = "none";
        return;
      }
      queuePanel.style.display = "block";
      const processed = (status.completed || 0) + (status.failed || 0);
      const pct = Math.round((processed / status.total) * 100);
      document.getElementById("queueProgressBar").style.width = `${pct}%`;
      document.getElementById("queuePct").textContent = `${pct}%`;
      document.getElementById("queueStats").textContent = `${processed} of ${status.total} items`;
    });
  }

  checkQueue();
  const queueInterval = setInterval(checkQueue, 1000);
  window.addEventListener("pagehide", () => clearInterval(queueInterval));

  document.getElementById("queueCancelBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "CANCEL_DOWNLOADS" }, () => {
      const _ = chrome.runtime.lastError;
    });
  });

  // Detect Blackboard in active tab
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) {
      statusText.textContent = "Unable to inspect active tab.";
      banner.classList.add("state-error");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "get_status" }, (response) => {
      const err = chrome.runtime.lastError;
      if (err || !response || !response.isBlackboard) {
        statusText.textContent = "Navigate to a Blackboard page first.";
        banner.classList.add("state-error");
        return;
      }

      banner.classList.remove("state-error");
      banner.classList.add("state-success");

      if (response.courseId) {
        statusText.textContent = "Course detected";
        const name = response.courseName || `Course ${response.courseId}`;
        courseInfo.style.display = "block";
        courseNameEl.textContent = name;

        downloadBtnLabel.textContent = "Download course files";
        downloadBtn.disabled = false;

        downloadBtn.addEventListener("click", () => {
          downloadBtn.disabled = true;
          downloadBtnLabel.textContent = "Starting download...";
          chrome.tabs.sendMessage(tab.id, { action: "trigger_download" }, () => {
            const _ = chrome.runtime.lastError;
            downloadBtnLabel.textContent = "Queued!";
            setTimeout(() => window.close(), 1200);
          });
        });
      } else if (response.isHomepage) {
        statusText.textContent = "Blackboard Dashboard detected";
        downloadBtnLabel.textContent = "Select courses to download";
        downloadBtn.disabled = false;

        downloadBtn.addEventListener("click", () => {
          chrome.tabs.sendMessage(tab.id, { action: "open_course_selector" }, () => {
            const _ = chrome.runtime.lastError;
            window.close();
          });
        });
      } else {
        statusText.textContent = "Connected to Blackboard";
        downloadBtnLabel.textContent = "Browse courses to download";
        downloadBtn.disabled = false;
        downloadBtn.addEventListener("click", () => {
          chrome.tabs.sendMessage(tab.id, { action: "open_course_selector" }, () => {
            const _ = chrome.runtime.lastError;
            window.close();
          });
        });
      }
    });
  });
});
