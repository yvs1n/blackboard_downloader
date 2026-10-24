# Blackboard Course Downloader

A browser extension (Chrome, Edge, Brave, Opera) that downloads course files, notes, announcements and grades from **Blackboard Learn** (Ultra and Original) into an organized ZIP or a folder tree.

It runs inside your logged-in browser tab, so it needs no passwords or API keys, and nothing is sent anywhere except between your browser and your university's Blackboard server.

## Features

- **Download one course** from the button added next to the course title, or from the extension popup.
- **Download many courses** from the dashboard: a selector lists your courses grouped by term, with search and select all.
- **Keeps the folder structure** of folders and learning modules, and names files by their real uploaded filename.
- **Finds files in** content attachments, rich-text links (`data-bbfile`, `/bbcswebdav/`) and Course Files.
- **Optional extras:** page text as Markdown or HTML, announcements, and your grades as CSV and Markdown.
- **REST API first, DOM fallback:** if the university blocks the student REST API, visible file links on the current page are used instead (shallower).
- **Progress panel** with scanning status, per-file progress, cancel, and a list of failed files.

## Install

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Pin the extension to your toolbar.

## Use

- **One course:** open a course, then click **Download Course Content** next to the title, or open the popup and click **Download course files**.
- **Several courses:** open your Blackboard home or course list, click **Download Courses** (or use the popup), tick the courses and click **Download Selected Courses**.

## Settings

Open them from the gear icon in the popup, or right-click the extension icon and choose Options. Press **Save Changes** to apply; **Reset to defaults** restores everything.

| Setting | What it does |
| :--- | :--- |
| Download method | **Single ZIP** (`[Course].zip`) or **individual files** saved under `[Course]/...` in your Downloads folder. |
| If a file already exists | Keep both (rename), overwrite, or ask each time. Applies to the saved ZIP or files. |
| Original course files | Files uploaded by instructors (PDF, slides, documents, archives). |
| Text notes & descriptions | Page text saved in `Course Notes/`. |
| Course announcements | One file in `Announcements/`. |
| Grades & feedback | `Grades/Grades.csv` and `Grades/Grades.md`. |
| Notes format | Markdown or standalone HTML, used only for notes and announcements. |
| Skip video files | Drops .mp4, .mov, .avi, .mkv, .webm, .m4v, .wmv. |
| Maximum file size | Skips files larger than this many MB (0 = no limit). Needs the server to report the size. |
| Folder prefix | Puts everything inside one extra folder, e.g. `Downloads/Fall2026/[Course]/...`. |

At least one content type must stay selected.

## Limitations

- In ZIP mode the archive is assembled in memory before it is saved, so a very large course (several GB) can fail. Use **individual files** for those.
- Video links to external services (Panopto, Collaborate, YouTube) and quizzes are not downloaded.
- The DOM fallback only sees what is on the current page.

## Privacy

All requests go directly between your browser and your Blackboard server. There is no analytics and no external service.
