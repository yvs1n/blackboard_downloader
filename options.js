/**
 * Blackboard Course Downloader — Settings Controller
 */

document.addEventListener("DOMContentLoaded", () => {
  const zipModeTrue = document.getElementById("zipModeTrue");
  const zipModeFalse = document.getElementById("zipModeFalse");
  const typeFiles = document.getElementById("typeFiles");
  const typePages = document.getElementById("typePages");
  const typeAnnouncements = document.getElementById("typeAnnouncements");
  const typeGrades = document.getElementById("typeGrades");
  const exportFormat = document.getElementById("exportFormat");
  const excludeVideos = document.getElementById("excludeVideos");
  const folderPrefix = document.getElementById("folderPrefix");
  const saveBtn = document.getElementById("saveBtn");
  const saveToast = document.getElementById("saveToast");

  // Load existing settings
  chrome.storage.sync.get({
    zipMode: true,
    contentTypes: {
      files: true,
      pages: true,
      announcements: true,
      grades: true,
    },
    exportFormat: "md",
    excludeVideos: false,
    folderPrefix: "",
  }, (items) => {
    if (items.zipMode) {
      zipModeTrue.checked = true;
    } else {
      zipModeFalse.checked = true;
    }

    typeFiles.checked = !!items.contentTypes.files;
    typePages.checked = !!items.contentTypes.pages;
    typeAnnouncements.checked = !!items.contentTypes.announcements;
    typeGrades.checked = !!items.contentTypes.grades;

    exportFormat.value = items.exportFormat || "md";
    excludeVideos.checked = !!items.excludeVideos;
    folderPrefix.value = items.folderPrefix || "";
  });

  // Save handler
  function saveSettings() {
    const newSettings = {
      zipMode: zipModeTrue.checked,
      contentTypes: {
        files: typeFiles.checked,
        pages: typePages.checked,
        announcements: typeAnnouncements.checked,
        grades: typeGrades.checked,
      },
      exportFormat: exportFormat.value,
      excludeVideos: excludeVideos.checked,
      folderPrefix: folderPrefix.value.trim(),
    };

    chrome.storage.sync.set(newSettings, () => {
      saveToast.classList.add("visible");
      setTimeout(() => {
        saveToast.classList.remove("visible");
      }, 2500);
    });
  }

  saveBtn.addEventListener("click", saveSettings);
});
