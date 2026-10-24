/**
 * Blackboard Course Downloader — Background Service Worker
 *
 * Manages download queue using chrome.downloads API, tracks state,
 * persists session data, updates extension badge, and sends notifications.
 */

const STATE = {
  QUEUED: "queued",
  DOWNLOADING: "downloading",
  COMPLETE: "complete",
  FAILED: "failed",
  CANCELLED: "cancelled"
};

const MAX_CONCURRENT = 3;
const MAX_RETRIES = 1;
const DEFAULT_SETTINGS = { conflictAction: "uniquify", throttleMs: 200, folderPrefix: "" };

let jobs = [];
let nextJobId = 0;
let isProcessing = false;
let cancelled = false;
let sourceTabId = null;
let downloadSettings = { ...DEFAULT_SETTINGS };
let lastLaunch = 0;

const chromeIdToJob = new Map();

// ---------------------------------------------------------------------------
// Path Sanitization Helper
// ---------------------------------------------------------------------------

function sanitizeDownloadPath(rawPath) {
  if (!rawPath) return "file";
  let p = String(rawPath).replace(/\\/g, "/");
  p = p.replace(/^\/+/, "");
  p = p.replace(/\/+/g, "/");
  p = p.split("/").filter((seg) => seg !== "." && seg !== "..").join("/");
  return p || "file";
}

// ---------------------------------------------------------------------------
// State Persistence (chrome.storage.session)
// ---------------------------------------------------------------------------

let stateLoadPromise = null;

function ensureStateLoaded() {
  if (!stateLoadPromise) {
    stateLoadPromise = chrome.storage.session.get({
      jobs: [],
      nextJobId: 0,
      isProcessing: false,
      cancelled: false,
      sourceTabId: null,
      downloadSettings: { ...DEFAULT_SETTINGS }
    }).then(async (s) => {
      jobs = s.jobs;
      nextJobId = s.nextJobId;
      isProcessing = s.isProcessing;
      cancelled = s.cancelled;
      sourceTabId = s.sourceTabId;
      downloadSettings = s.downloadSettings;
      chromeIdToJob.clear();

      // Recover from a service worker restart: re-sync in-flight jobs.
      for (const j of jobs) {
        if (j.state !== STATE.DOWNLOADING) continue;
        if (j.chromeDownloadId == null) {
          j.state = STATE.QUEUED;
          continue;
        }
        try {
          const [item] = await chrome.downloads.search({ id: j.chromeDownloadId });
          if (!item || item.state === "interrupted") {
            j.state = STATE.FAILED;
            j.error = item?.error || "Download lost";
          } else if (item.state === "complete") {
            j.state = STATE.COMPLETE;
          } else {
            chromeIdToJob.set(j.chromeDownloadId, j);
          }
        } catch {
          j.state = STATE.FAILED;
          j.error = "Download lost";
        }
      }
      if (isProcessing && !cancelled) pump();
    });
  }
  return stateLoadPromise;
}

function persistState() {
  return chrome.storage.session.set({
    jobs, nextJobId, isProcessing, cancelled, sourceTabId, downloadSettings
  });
}

ensureStateLoaded();

// ---------------------------------------------------------------------------
// Status & Badge Helpers
// ---------------------------------------------------------------------------

function getStatus() {
  const count = (s) => jobs.filter((j) => j.state === s).length;
  const completed = count(STATE.COMPLETE);
  const failed = count(STATE.FAILED);
  const cancelledCount = count(STATE.CANCELLED);
  const downloading = count(STATE.DOWNLOADING);
  const queued = count(STATE.QUEUED);

  return {
    total: jobs.length,
    queued,
    downloading,
    completed,
    failed,
    cancelledCount,
    currentFile: jobs.find((j) => j.state === STATE.DOWNLOADING)?.filename || null,
    failedFiles: jobs
      .filter((j) => j.state === STATE.FAILED)
      .map((j) => ({ id: j.id, filename: j.filename, path: j.path, error: j.error })),
    done: jobs.length > 0 && queued === 0 && downloading === 0,
    cancelled
  };
}

function broadcastStatus() {
  updateBadge();
  const status = getStatus();
  if (sourceTabId) {
    chrome.tabs.sendMessage(sourceTabId, { type: "DOWNLOAD_STATUS", payload: status }, () => {
      const _ = chrome.runtime.lastError;
    });
  }
  chrome.runtime.sendMessage({ type: "DOWNLOAD_STATUS", payload: status }, () => {
    const _ = chrome.runtime.lastError;
  });
}

function updateBadge() {
  const remaining = jobs.filter((j) => j.state === STATE.QUEUED || j.state === STATE.DOWNLOADING).length;
  if (remaining > 0) {
    chrome.action.setBadgeText({ text: String(remaining) });
    chrome.action.setBadgeBackgroundColor({ color: "#0284c7" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

function notifyCompletion() {
  const { completed, failed } = getStatus();
  try {
    chrome.notifications.create("bb-download-complete", {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "Blackboard Course Downloader",
      message: `Download finished: ${completed} items saved${failed > 0 ? `, ${failed} failed` : ""}.`
    }, () => {
      const _ = chrome.runtime.lastError;
    });
  } catch (err) {
    console.warn("[Blackboard Downloader] Notification error:", err);
  }
}

// ---------------------------------------------------------------------------
// Download Engine
// ---------------------------------------------------------------------------

let pumping = false;

/**
 * Starts queued jobs until MAX_CONCURRENT are in flight. Re-entrant safe.
 */
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    await ensureStateLoaded();
    while (!cancelled) {
      const active = jobs.filter((j) => j.state === STATE.DOWNLOADING).length;
      const job = jobs.find((j) => j.state === STATE.QUEUED);
      if (!job) break;
      if (active >= MAX_CONCURRENT) return;

      const wait = (downloadSettings.throttleMs || 0) - (Date.now() - lastLaunch);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastLaunch = Date.now();
      await startJob(job);
    }

    const stillActive = jobs.some((j) => j.state === STATE.DOWNLOADING || j.state === STATE.QUEUED);
    if (isProcessing && !stillActive) {
      isProcessing = false;
      await persistState();
      broadcastStatus();
      if (!cancelled) notifyCompletion();
    }
  } finally {
    pumping = false;
  }
}

async function startJob(job) {
  job.state = STATE.DOWNLOADING;
  await persistState();
  broadcastStatus();

  try {
    const downloadId = await chrome.downloads.download({
      url: job.url,
      filename: sanitizeDownloadPath(job.fullPath),
      conflictAction: downloadSettings.conflictAction || "uniquify"
    });
    job.chromeDownloadId = downloadId;
    chromeIdToJob.set(downloadId, job);
    await persistState();
  } catch (err) {
    failOrRetry(job, err.message || "Download initiation error");
    await persistState();
    broadcastStatus();
  }
}

function failOrRetry(job, error) {
  job.retries = (job.retries || 0) + 1;
  job.chromeDownloadId = null;
  if (job.retries <= MAX_RETRIES && !cancelled) {
    job.state = STATE.QUEUED;
  } else {
    job.state = STATE.FAILED;
    job.error = error;
  }
}

// ---------------------------------------------------------------------------
// Chrome Downloads Event Listener
// ---------------------------------------------------------------------------

chrome.downloads.onChanged.addListener(async (delta) => {
  await ensureStateLoaded();
  const job = chromeIdToJob.get(delta.id);
  if (!job) return;

  if (delta.state?.current === "complete") {
    job.state = STATE.COMPLETE;
    chromeIdToJob.delete(delta.id);
  } else if (delta.state?.current === "interrupted") {
    chromeIdToJob.delete(delta.id);
    if (cancelled) {
      job.state = STATE.CANCELLED;
    } else {
      failOrRetry(job, delta.error?.current || "Download interrupted");
    }
  } else {
    return;
  }

  await persistState();
  broadcastStatus();
  pump();
});

// ---------------------------------------------------------------------------
// Message Router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "START_DOWNLOAD") {
    (async () => {
      await ensureStateLoaded();
      const { files, conflictAction, throttleMs, folderPrefix } = request.payload;
      sourceTabId = sender?.tab?.id || sourceTabId;
      cancelled = false;

      downloadSettings = {
        conflictAction: conflictAction || "uniquify",
        throttleMs: throttleMs ?? 200,
        folderPrefix: folderPrefix || ""
      };

      // Start a fresh list only when nothing is in flight; otherwise append.
      const busy = jobs.some((j) => j.state === STATE.QUEUED || j.state === STATE.DOWNLOADING);
      if (!busy) {
        jobs = [];
        chromeIdToJob.clear();
      }

      for (const f of files) {
        jobs.push({
          id: nextJobId++,
          url: f.url,
          path: f.path || "",
          filename: f.filename,
          fullPath: `${f.path || ""}${f.filename}`,
          state: STATE.QUEUED,
          chromeDownloadId: null,
          error: null,
          retries: 0
        });
      }

      isProcessing = true;
      await persistState();
      broadcastStatus();
      pump();
      sendResponse({ status: "started", count: files.length });
    })();
    return true;
  }

  if (request.type === "GET_DOWNLOAD_STATUS") {
    ensureStateLoaded().then(() => {
      sendResponse(getStatus());
    });
    return true;
  }

  if (request.type === "CANCEL_DOWNLOADS") {
    (async () => {
      await ensureStateLoaded();
      cancelled = true;
      for (const j of jobs) {
        if (j.state === STATE.QUEUED) {
          j.state = STATE.CANCELLED;
        } else if (j.state === STATE.DOWNLOADING && j.chromeDownloadId != null) {
          chrome.downloads.cancel(j.chromeDownloadId, () => {
            const _ = chrome.runtime.lastError;
          });
        }
      }
      isProcessing = false;
      await persistState();
      broadcastStatus();
      sendResponse({ status: "cancelled" });
    })();
    return true;
  }
});
