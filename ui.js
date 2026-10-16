/**
 * Blackboard Course Downloader — UI Components
 *
 * Floating download progress panel, multi-course selector modal,
 * inline button injection, floating action button, and toasts.
 */

// ---------------------------------------------------------------------------
// Toast Notifications
// ---------------------------------------------------------------------------

function showToast(message, type = "info") {
  const existing = document.getElementById("bb-toast");
  if (existing) existing.remove();

  const colors = {
    info:    { bg: "#0f172a", fg: "#f8fafc", accent: "#38bdf8" },
    success: { bg: "#064e3b", fg: "#ecfdf5", accent: "#34d399" },
    error:   { bg: "#7f1d1d", fg: "#fef2f2", accent: "#f87171" },
  };
  const c = colors[type] || colors.info;

  const toast = document.createElement("div");
  toast.id = "bb-toast";
  toast.style.cssText = `
    position: fixed; bottom: 28px; right: 28px; z-index: 2147483647;
    background: ${c.bg}; color: ${c.fg};
    padding: 12px 18px; border-radius: 12px; font-size: 13.5px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 16px 36px rgba(0,0,0,0.24), 0 2px 8px rgba(0,0,0,0.1);
    border: 1px solid rgba(255,255,255,0.12);
    display: flex; align-items: center; gap: 12px;
    max-width: 380px; opacity: 0; transform: translateY(8px);
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  toast.innerHTML = `
    <span style="display:inline-flex;color:${c.accent};">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/>
      </svg>
    </span>
    <span style="flex:1;line-height:1.4;">${message}</span>
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ---------------------------------------------------------------------------
// Download Progress Panel
// ---------------------------------------------------------------------------

let downloadPanel = null;
let downloadCancelled = false;

function createDownloadPanel() {
  if (downloadPanel) {
    downloadPanel.style.display = "block";
    return downloadPanel;
  }

  const panel = document.createElement("div");
  panel.id = "bb-download-panel";
  panel.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;
    width: 360px; background: #ffffff; border-radius: 14px;
    box-shadow: 0 20px 45px rgba(0,0,0,0.18), 0 2px 10px rgba(0,0,0,0.06);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b; overflow: hidden;
    border: 1px solid rgba(0,0,0,0.08);
  `;

  panel.innerHTML = `
    <div style="background:#0f172a;color:#f8fafc;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:24px;height:24px;background:#0284c7;border-radius:6px;display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4v12"/><path d="M6 12l6 6 6-6"/><path d="M5 20h14"/>
          </svg>
        </div>
        <span id="bb-panel-title" style="font-weight:600;font-size:13.5px;">Downloading Course...</span>
      </div>
      <div style="display:flex;gap:4px;">
        <button id="bb-panel-minimize" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;display:flex;border-radius:4px;" title="Minimize">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/></svg>
        </button>
        <button id="bb-panel-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;display:flex;border-radius:4px;" title="Close">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div id="bb-panel-body" style="padding:16px;">
      <div id="bb-panel-current" style="font-size:12px;color:#64748b;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Starting...</div>
      <div style="background:#e2e8f0;border-radius:999px;height:8px;overflow:hidden;margin-bottom:8px;">
        <div id="bb-panel-bar" style="background:linear-gradient(90deg, #0284c7, #38bdf8);height:100%;border-radius:999px;transition:width 0.25s;width:0%;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;">
        <span id="bb-panel-stats">0 / 0</span>
        <span id="bb-panel-pct" style="font-weight:600;color:#0f172a;">0%</span>
      </div>
      <div id="bb-panel-actions" style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button id="bb-panel-cancel" style="background:none;border:1px solid #cbd5e1;color:#475569;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:500;cursor:pointer;">Cancel</button>
      </div>
      <div id="bb-panel-failed-section" style="display:none;margin-top:12px;border-top:1px solid #f1f5f9;padding-top:10px;">
        <details>
          <summary style="font-size:12px;color:#dc2626;cursor:pointer;font-weight:500;">Failed items (<span id="bb-failed-count">0</span>)</summary>
          <div id="bb-panel-failed-list" style="max-height:100px;overflow-y:auto;margin-top:6px;font-size:11px;color:#64748b;"></div>
        </details>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  downloadPanel = panel;

  panel.querySelector("#bb-panel-minimize").addEventListener("click", () => {
    const body = panel.querySelector("#bb-panel-body");
    body.style.display = body.style.display === "none" ? "block" : "none";
  });

  panel.querySelector("#bb-panel-close").addEventListener("click", () => {
    panel.style.display = "none";
  });

  panel.querySelector("#bb-panel-cancel").addEventListener("click", () => {
    downloadCancelled = true;
    panel.querySelector("#bb-panel-current").textContent = "Cancelling...";
    panel.querySelector("#bb-panel-cancel").disabled = true;
  });

  return panel;
}

function updateDownloadPanel(status) {
  if (!downloadPanel) return;

  const { total, completed, failed, queued, currentFile, failedFiles, done, cancelled } = status;
  const processed = (completed || 0) + (failed || 0);
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const bar = downloadPanel.querySelector("#bb-panel-bar");
  const pctEl = downloadPanel.querySelector("#bb-panel-pct");
  const statsEl = downloadPanel.querySelector("#bb-panel-stats");
  const currentEl = downloadPanel.querySelector("#bb-panel-current");
  const titleEl = downloadPanel.querySelector("#bb-panel-title");

  if (bar) bar.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (statsEl) statsEl.textContent = `${processed} of ${total} files`;

  if (cancelled) {
    if (titleEl) titleEl.textContent = "Download Cancelled";
    if (currentEl) currentEl.textContent = "Operation was stopped.";
    return;
  }

  if (done) {
    if (titleEl) titleEl.textContent = "Download Complete!";
    if (currentEl) currentEl.textContent = `Finished: ${completed} saved${failed > 0 ? `, ${failed} failed` : ""}.`;
    const cancelBtn = downloadPanel.querySelector("#bb-panel-cancel");
    if (cancelBtn) cancelBtn.textContent = "Dismiss";
    if (cancelBtn) cancelBtn.onclick = () => (downloadPanel.style.display = "none");
  } else if (currentFile) {
    if (currentEl) currentEl.textContent = `Downloading: ${currentFile}`;
  }

  if (failedFiles && failedFiles.length > 0) {
    const failSec = downloadPanel.querySelector("#bb-panel-failed-section");
    const failCount = downloadPanel.querySelector("#bb-failed-count");
    const failList = downloadPanel.querySelector("#bb-panel-failed-list");

    if (failSec) failSec.style.display = "block";
    if (failCount) failCount.textContent = String(failedFiles.length);
    if (failList) {
      failList.innerHTML = failedFiles.map(f => `<div>• ${typeof f === "string" ? f : f.filename}</div>`).join("");
    }
  }
}

// ---------------------------------------------------------------------------
// Course Selector Modal (for Dashboard & Multi-Course download)
// ---------------------------------------------------------------------------

async function openCourseSelector() {
  const existing = document.getElementById("bb-course-selector-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "bb-course-selector-modal";
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
    z-index: 2147483647; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  overlay.innerHTML = `
    <div style="background:#ffffff;border-radius:18px;width:640px;max-width:92vw;max-height:86vh;box-shadow:0 24px 60px rgba(0,0,0,0.3);overflow:hidden;display:flex;flex-direction:column;">
      <div style="background:#0f172a;color:#f8fafc;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h2 style="margin:0;font-size:18px;font-weight:700;">Blackboard Course Downloader</h2>
          <p style="margin:4px 0 0;font-size:12.5px;color:#94a3b8;">Select courses to batch download materials, slides, and notes</p>
        </div>
        <button id="bb-modal-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:6px;border-radius:6px;display:flex;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div style="padding:16px 24px;border-bottom:1px solid #e2e8f0;display:flex;gap:12px;align-items:center;">
        <input id="bb-search-input" type="text" placeholder="Search courses by name or code..." style="flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:9px 14px;font-size:13.5px;outline:none;font-family:inherit;">
        <button id="bb-select-all" style="background:#f1f5f9;border:1px solid #cbd5e1;padding:8px 12px;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:500;color:#334155;">Select All</button>
        <button id="bb-deselect-all" style="background:#f1f5f9;border:1px solid #cbd5e1;padding:8px 12px;border-radius:8px;font-size:12.5px;cursor:pointer;font-weight:500;color:#334155;">Deselect</button>
      </div>

      <div id="bb-modal-list-wrap" style="flex:1;overflow-y:auto;padding:16px 24px;">
        <div id="bb-modal-loading" style="text-align:center;padding:40px 0;color:#64748b;font-size:14px;">
          <div style="margin-bottom:10px;">Loading your Blackboard courses...</div>
        </div>
        <div id="bb-modal-course-list" style="display:none;"></div>
      </div>

      <div style="background:#f8fafc;padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
        <span id="bb-modal-selected-count" style="font-size:13px;color:#64748b;font-weight:500;">0 courses selected</span>
        <button id="bb-modal-download-btn" disabled style="background:#0284c7;color:#ffffff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;transition:background 0.15s;opacity:0.5;">
          Download Selected Courses
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#bb-modal-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const listEl = overlay.querySelector("#bb-modal-course-list");
  const loadingEl = overlay.querySelector("#bb-modal-loading");
  const countEl = overlay.querySelector("#bb-modal-selected-count");
  const downloadBtn = overlay.querySelector("#bb-modal-download-btn");
  const searchInput = overlay.querySelector("#bb-search-input");

  function updateSelectedCount() {
    const checked = listEl.querySelectorAll("input[type='checkbox']:checked");
    countEl.textContent = `${checked.length} course${checked.length === 1 ? "" : "s"} selected`;
    downloadBtn.disabled = checked.length === 0;
    downloadBtn.style.opacity = checked.length === 0 ? "0.5" : "1";
    downloadBtn.style.cursor = checked.length === 0 ? "not-allowed" : "pointer";
  }

  try {
    const courses = await fetchAllCourses();
    loadingEl.style.display = "none";
    listEl.style.display = "block";

    if (courses.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;color:#64748b;padding:30px;">No courses found. Ensure you are signed in to Blackboard.</div>`;
      return;
    }

    // Group courses by Term
    const termMap = new Map();
    for (const c of courses) {
      const term = c.term || "Other Courses";
      if (!termMap.has(term)) termMap.set(term, []);
      termMap.get(term).push(c);
    }

    let html = "";
    for (const [term, group] of termMap.entries()) {
      html += `<div class="bb-term-group" style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">${term}</div>
        <div style="display:flex;flex-direction:column;gap:6px;">`;

      for (const course of group) {
        html += `
          <label class="bb-course-row" data-search="${(course.name + " " + course.courseCode).toLowerCase()}" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;transition:background 0.12s;">
            <input type="checkbox" data-id="${course.id}" data-name="${course.name}" style="width:16px;height:16px;accent-color:#0284c7;cursor:pointer;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${course.name}</div>
              <div style="font-size:11.5px;color:#64748b;">${course.courseCode || course.id}</div>
            </div>
          </label>`;
      }
      html += `</div></div>`;
    }

    listEl.innerHTML = html;

    listEl.addEventListener("change", updateSelectedCount);

    overlay.querySelector("#bb-select-all").addEventListener("click", () => {
      listEl.querySelectorAll("input[type='checkbox']").forEach(cb => {
        const row = cb.closest(".bb-course-row");
        if (row && row.style.display !== "none") cb.checked = true;
      });
      updateSelectedCount();
    });

    overlay.querySelector("#bb-deselect-all").addEventListener("click", () => {
      listEl.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = false);
      updateSelectedCount();
    });

    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      listEl.querySelectorAll(".bb-course-row").forEach(row => {
        const text = row.getAttribute("data-search") || "";
        row.style.display = !q || text.includes(q) ? "flex" : "none";
      });
      listEl.querySelectorAll(".bb-term-group").forEach(group => {
        const visible = group.querySelectorAll(".bb-course-row:not([style*='display: none'])");
        group.style.display = visible.length === 0 && q ? "none" : "block";
      });
    });

    downloadBtn.addEventListener("click", async () => {
      const selected = Array.from(listEl.querySelectorAll("input[type='checkbox']:checked")).map(cb => ({
        id: cb.getAttribute("data-id"),
        name: cb.getAttribute("data-name")
      }));

      if (selected.length === 0) return;
      overlay.remove();

      showToast(`Starting batch download for ${selected.length} courses...`, "info");
      const domain = window.location.origin;

      for (let i = 0; i < selected.length; i++) {
        if (downloadCancelled) break;
        const c = selected[i];
        showToast(`Processing course ${i + 1}/${selected.length}: ${c.name}`, "info");
        try {
          await downloadCourse(c.id, c.name, domain);
        } catch (err) {
          console.error(`[Blackboard Downloader] Batch error on ${c.name}:`, err);
        }
      }
      showToast("Batch downloads completed!", "success");
    });

  } catch (err) {
    loadingEl.innerHTML = `<div style="color:#dc2626;padding:20px;">Failed to load courses. Please check your login session.</div>`;
    console.error("[Blackboard Downloader] Load courses error:", err);
  }
}

// ---------------------------------------------------------------------------
// Button Injection (Header & Floating Action Button)
// ---------------------------------------------------------------------------

function injectButtons() {
  if (!isBlackboard()) return;

  const courseId = getCourseId();

  // 1. Injected Header / Outline Button
  if (courseId) {
    if (!document.getElementById("bb-injected-btn")) {
      const btn = document.createElement("button");
      btn.id = "bb-injected-btn";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <path d="M12 4v12"/><path d="M6 12l6 6 6-6"/><path d="M5 20h14"/>
        </svg>
        <span>Download Course Content</span>
      `;
      btn.style.cssText = `
        display: inline-flex; align-items: center; gap: 8px;
        background: #0284c7; color: #ffffff; border: none; border-radius: 8px;
        padding: 8px 14px; font-size: 13px; font-weight: 600;
        cursor: pointer; margin-left: 12px; vertical-align: middle;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 2px 6px rgba(2, 132, 199, 0.25);
        transition: background 0.15s, transform 0.08s;
        flex-shrink: 0;
      `;
      btn.addEventListener("mouseenter", () => (btn.style.background = "#0369a1"));
      btn.addEventListener("mouseleave", () => (btn.style.background = "#0284c7"));
      btn.addEventListener("mousedown", () => (btn.style.transform = "scale(0.97)"));
      btn.addEventListener("mouseup", () => (btn.style.transform = "scale(1)"));
      btn.addEventListener("click", downloadCurrentCourse);

      const mount = findMountPoint(ULTRA_MOUNT_SELECTORS) || findMountPoint(ORIGINAL_MOUNT_SELECTORS);
      if (mount) {
        mount.appendChild(btn);
      }
    }
  } else if (isBlackboardHomepage()) {
    if (!document.getElementById("bb-injected-home-btn")) {
      const btn = document.createElement("button");
      btn.id = "bb-injected-home-btn";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 4v12"/><path d="M6 12l6 6 6-6"/><path d="M5 20h14"/>
        </svg>
        <span>Download Courses</span>
      `;
      btn.style.cssText = `
        display: inline-flex; align-items: center; gap: 8px;
        background: #0284c7; color: #ffffff; border: none; border-radius: 8px;
        padding: 8px 14px; font-size: 13px; font-weight: 600;
        cursor: pointer; margin-left: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 2px 6px rgba(2, 132, 199, 0.25);
      `;
      btn.addEventListener("click", openCourseSelector);

      const mount = findMountPoint(DASHBOARD_MOUNT_SELECTORS);
      if (mount) mount.appendChild(btn);
    }
  }

  // 2. Floating Action Button (FAB)
  // Ensures the user can ALWAYS trigger the downloader even if university custom themes change header DOM
  if (!document.getElementById("bb-fab-button")) {
    const fab = document.createElement("button");
    fab.id = "bb-fab-button";
    fab.title = courseId ? "Download Course Materials" : "Download Blackboard Courses";
    fab.style.cssText = `
      position: fixed; bottom: 24px; left: 24px; z-index: 2147483645;
      width: 46px; height: 46px; border-radius: 50%;
      background: #0f172a; color: #38bdf8; border: 1px solid rgba(255,255,255,0.15);
      box-shadow: 0 8px 24px rgba(0,0,0,0.22);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.15s, background 0.15s;
    `;

    fab.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v12"/><path d="M6 12l6 6 6-6"/><path d="M5 20h14"/>
      </svg>
    `;

    fab.addEventListener("mouseenter", () => {
      fab.style.transform = "scale(1.08)";
      fab.style.background = "#1e293b";
    });
    fab.addEventListener("mouseleave", () => {
      fab.style.transform = "scale(1)";
      fab.style.background = "#0f172a";
    });
    fab.addEventListener("click", () => {
      if (getCourseId()) {
        downloadCurrentCourse();
      } else {
        openCourseSelector();
      }
    });

    document.body.appendChild(fab);
  }
}
