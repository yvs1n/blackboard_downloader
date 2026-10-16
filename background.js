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
  FAILED: "failed"
};

let jobs = [];
let nextJobId = 0;
let isProcessing = false;
let cancelled = false;
let sourceTabId = null;
let downloadSettings = { conflictAction: "uniquify", throttleMs: 200, folderPrefix: "" };

const chromeIdToJob = new Map();

// ---------------------------------------------------------------------------
// Path Sanitization Helper
// ---------------------------------------------------------------------------

function sanitizeDownloadPath(rawPath) {
  if (!rawPath) return "file";
  let p = rawPath.replace(/\\/g, "/");
  p = p.replace(/^\/+/, "");
  p = p.replace(/\/+/g, "/");
  return p;
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
      downloadSettings: { conflictAction: "uniquify", throttleMs: 200, folderPrefix: "" }
    }).then((s) => {
      jobs = s.jobs;
      nextJobId = s.nextJobId;
      isProcessing = s.isProcessing;
      cancelled = s.cancelled;
      sourceTabId = s.sourceTabId;
      downloadSettings = s.downloadSettings;
      chromeIdToJob.clear();
      for (const j of jobs) {
        if (j.chromeDownloadId != null) chromeIdToJob.set(j.chromeDownloadId, j);
      }
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
  const completed = jobs.filter((j) => j.state === STATE.COMPLETE).length;
  const failed = jobs.filter((j) => j.state === STATE.FAILED).length;
  const downloading = jobs.filter((j) => j.state === STATE.DOWNLOADING).length;
  const queued = jobs.filter((j) => j.state === STATE.QUEUED).length;

  return {
    total: jobs.length,
    queued,
    downloading,
    completed,
    failed,
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

async function processNextJob() {
  await ensureStateLoaded();
  if (cancelled) {
    isProcessing = false;
    await persistState();
    return;
  }

  const job = jobs.find((j) => j.state === STATE.QUEUED);
  if (!job) {
    isProcessing = false;
    await persistState();
    broadcastStatus();
    notifyCompletion();
    return;
  }

  job.state = STATE.DOWNLOADING;
  await persistState();
  broadcastStatus();

  const options = {
    url: job.url,
    filename: sanitizeDownloadPath(job.fullPath),
    conflictAction: downloadSettings.conflictAction || "uniquify"
  };

  try {
    const downloadId = await chrome.downloads.download(options);
    job.chromeDownloadId = downloadId;
    chromeIdToJob.set(downloadId, job);
    await persistState();
  } catch (err) {
    job.state = STATE.FAILED;
    job.error = err.message || "Download initiation error";
    await persistState();
    broadcastStatus();
    setTimeout(processNextJob, downloadSettings.throttleMs || 200);
  }
}

function scheduleNext() {
  setTimeout(() => {
    processNextJob();
  }, downloadSettings.throttleMs || 200);
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
    await persistState();
    broadcastStatus();
    scheduleNext();
  } else if (delta.state?.current === "interrupted") {
    job.state = STATE.FAILED;
    job.error = delta.error?.current || "Download interrupted";
    chromeIdToJob.delete(delta.id);
    await persistState();
    broadcastStatus();
    scheduleNext();
  }
});

// ---------------------------------------------------------------------------
// Message Router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "START_DOWNLOAD") {
    const { files, courseName, conflictAction, throttleMs, folderPrefix } = request.payload;
    sourceTabId = sender?.tab?.id || null;
    cancelled = false;

    downloadSettings = {
      conflictAction: conflictAction || "uniquify",
      throttleMs: throttleMs ?? 200,
      folderPrefix: folderPrefix || ""
    };

    jobs = files.map((f) => ({
      id: nextJobId++,
      url: f.url,
      path: f.path || "",
      filename: f.filename,
      fullPath: `${f.path || ""}${f.filename}`,
      state: STATE.QUEUED,
      chromeDownloadId: null,
      error: null
    }));

    chromeIdToJob.clear();
    isProcessing = true;
    persistState();
    broadcastStatus();
    processNextJob();
    sendResponse({ status: "started", count: jobs.length });
    return true;
  }

  if (request.type === "GET_DOWNLOAD_STATUS") {
    ensureStateLoaded().then(() => {
      sendResponse(getStatus());
    });
    return true;
  }

  if (request.type === "CANCEL_DOWNLOADS") {
    cancelled = true;
    for (const j of jobs) {
      if (j.state === STATE.QUEUED) j.state = STATE.FAILED;
    }
    persistState();
    broadcastStatus();
    sendResponse({ status: "cancelled" });
    return true;
  }
});

