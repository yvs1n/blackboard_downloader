/**
 * Blackboard Course Downloader — Settings Controller
 */

const OPTION_DEFAULTS = {
  zipMode: true,
  contentTypes: { files: true, pages: false, announcements: false, grades: false },
  conflictAction: "uniquify",
  exportFormat: "md",
  excludeVideos: false,
  maxFileSizeMB: 0,
  folderPrefix: "",
};

document.addEventListener("DOMContentLoaded", () => {
  const el = (id) => document.getElementById(id);
  const zipModeTrue = el("zipModeTrue");
  const zipModeFalse = el("zipModeFalse");
  const typeFiles = el("typeFiles");
  const typePages = el("typePages");
  const typeAnnouncements = el("typeAnnouncements");
  const typeGrades = el("typeGrades");
  const exportFormat = el("exportFormat");
  const conflictAction = el("conflictAction");
  const excludeVideos = el("excludeVideos");
  const maxFileSizeMB = el("maxFileSizeMB");
  const folderPrefix = el("folderPrefix");
  const saveBtn = el("saveBtn");
  const resetBtn = el("resetBtn");
  const saveToast = el("saveToast");
  const contentError = el("contentError");
  const formatRow = el("formatRow");

  function applyToForm(items) {
    const types = { ...OPTION_DEFAULTS.contentTypes, ...(items.contentTypes || {}) };
    (items.zipMode === false ? zipModeFalse : zipModeTrue).checked = true;
    typeFiles.checked = !!types.files;
    typePages.checked = !!types.pages;
    typeAnnouncements.checked = !!types.announcements;
    typeGrades.checked = !!types.grades;
    exportFormat.value = items.exportFormat || "md";
    conflictAction.value = items.conflictAction || "uniquify";
    excludeVideos.checked = !!items.excludeVideos;
    maxFileSizeMB.value = items.maxFileSizeMB || 0;
    folderPrefix.value = items.folderPrefix || "";
    refreshDependentState();
  }

  function selectedTypes() {
    return {
      files: typeFiles.checked,
      pages: typePages.checked,
      announcements: typeAnnouncements.checked,
      grades: typeGrades.checked,
    };
  }

  // The notes format only matters when notes or announcements are exported.
  function refreshDependentState() {
    const usesFormat = typePages.checked || typeAnnouncements.checked;
    exportFormat.disabled = !usesFormat;
    formatRow.classList.toggle("disabled", !usesFormat);
    contentError.style.display = Object.values(selectedTypes()).some(Boolean) ? "none" : "block";
  }

  [typeFiles, typePages, typeAnnouncements, typeGrades].forEach((cb) =>
    cb.addEventListener("change", refreshDependentState)
  );

  chrome.storage.sync.get(OPTION_DEFAULTS, applyToForm);

  function flash(message) {
    saveToast.textContent = message;
    saveToast.classList.add("visible");
    setTimeout(() => saveToast.classList.remove("visible"), 2500);
  }

  function saveSettings() {
    const types = selectedTypes();
    if (!Object.values(types).some(Boolean)) {
      refreshDependentState();
      contentError.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    const maxMB = Math.max(0, Math.floor(Number(maxFileSizeMB.value) || 0));
    maxFileSizeMB.value = maxMB;

    const newSettings = {
      zipMode: zipModeTrue.checked,
      contentTypes: types,
      conflictAction: conflictAction.value,
      exportFormat: exportFormat.value,
      excludeVideos: excludeVideos.checked,
      maxFileSizeMB: maxMB,
      folderPrefix: folderPrefix.value.trim(),
    };

    chrome.storage.sync.set(newSettings, () => {
      flash(chrome.runtime.lastError ? "Could not save settings." : "Settings saved successfully!");
    });
  }

  saveBtn.addEventListener("click", saveSettings);

  resetBtn.addEventListener("click", () => {
    applyToForm(OPTION_DEFAULTS);
    chrome.storage.sync.set(OPTION_DEFAULTS, () => flash("Settings reset to defaults."));
  });
});
