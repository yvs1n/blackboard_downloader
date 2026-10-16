# Blackboard Course Downloader & Exporter 🎓📦

A lightweight, high-performance browser extension (Chrome, Edge, Brave, Opera) designed to batch download and archive entire courses, lecture slides, documents, notes, announcements, and grades from **Blackboard Learn (Ultra & Original)**.

---

## ⚡ Key Features

- **No API Keys or Passwords Required:** Operates client-side under your active university browser session.
- **Universal Blackboard Support:** Built for both **Blackboard Learn Ultra** (modern SPA) and **Blackboard Learn Original** (classic webapp).
- **Streaming ZIP Generator:** Packages all course materials into an organized `.zip` file on-the-fly using `client-zip` (low memory, instant download).
- **Course Selector Modal:** Open from the Blackboard homepage or courses list to select and batch-download multiple courses across active and past semesters.
- **Organized Folder Structure:** Preserves course folders, subfolders, learning modules, and content areas.
- **Embedded Document Extraction:** Traverses content areas, direct attachments, `<a data-bbfile>` JSON links, and Content Collection (`/bbcswebdav/`) files.
- **Export to Markdown & CSV:**
  - Rich-text pages, lecture notes, and syllabus saved as clean Markdown (`.md`) or HTML.
  - Course announcements saved to `Announcements/Announcements.md`.
  - Student grades exported to both `Grades/Grades.csv` and formatted Markdown.
- **Dual-Engine Architecture:**
  - **Primary:** High-speed recursive traversal via Blackboard Learn REST API (`/learn/api/public/v1/...`).
  - **Fallback:** Automatic DOM scraping engine if a university admin has restricted student REST API access.
- **Live Progress & Control:** Floating panel with live progress bar, file counters, cancel button, and error reporting.

---

## 🛠️ How It Works (Reverse Engineering Canvas Course Downloader)

We reverse-engineered [`canvas-course-downloader`](https://github.com/jasp-nerd/canvas-course-downloader) to understand its architectural strengths:

1. **Manifest V3 Content Script & Background Worker:**
   Instead of brittle external scraping scripts, the extension runs within your logged-in browser tab. It leverages your authenticated session cookies (`JSESSIONID`, `s_session_id`) automatically.
2. **Streaming Client-Side ZIP (`client-zip`):**
   Rather than buffering gigabytes of slides into RAM with JSZip, it streams chunks directly through an asynchronous generator to generate the final ZIP archive without tab crashes.
3. **HTML-to-Markdown Pipeline (`turndown`):**
   Converts LMS rich text into clean Markdown files ideal for Obsidian, Notion, NotebookLM, Claude, or ChatGPT.
4. **Stateful Download Tracking:**
   Tracks jobs through queued, downloading, and completed states using `chrome.downloads` and persists session data in `chrome.storage.session`.

### Adapting to Blackboard Learn
While Canvas LMS uses `/api/v1/courses/...`, Blackboard uses a distinct structure:
- **Course Enrollment & Discovery:** `GET /learn/api/public/v1/users/me` & `GET /learn/api/public/v1/users/{userId}/courses`
- **Content Tree Hierarchy:** `GET /learn/api/public/v1/courses/{courseId}/contents` and recursive calls to `.../contents/{contentId}/children`
- **Attachments & WebDAV:** Attachments live under `.../contents/{contentId}/attachments/{attId}/download` or Content Collection WebDAV paths (`/bbcswebdav/...`)
- **Announcements:** `GET /learn/api/public/v1/courses/{courseId}/announcements`
- **Gradebook:** `GET /learn/api/public/v1/courses/{courseId}/gradebook/columns` & `GET /learn/api/public/v2/courses/{courseId}/gradebook/users/{userId}`

---

## 🚀 Installation Guide

1. Open your Chromium-based browser (Google Chrome, Microsoft Edge, Brave).
2. Navigate to `chrome://extensions` (or `edge://extensions` in Edge).
3. Toggle on **Developer mode** in the top right corner.
4. Click **Load unpacked** in the top left.
5. Select this folder:
   ```
   c:\Users\yassi\Desktop\blackboard_course_downloader
   ```
6. The extension is now installed! Pin it to your toolbar for quick access.

---

## 📖 How to Use

### 1. Download Current Course
1. Open your university Blackboard portal and navigate inside any course outline or content page.
2. Click the injected **"Download Course Content"** button next to the course title, or click the extension icon in your toolbar and press **"Download course content"** (or use the shortcut `Ctrl+Alt+B`).
3. The floating progress panel will display live status as files and materials are saved into a clean ZIP archive.

### 2. Batch Download Multiple Courses
1. Navigate to your Blackboard dashboard or course catalog (`/ultra/course` or portal home).
2. Click **"Download Courses"** or open the extension popup.
3. The **Course Selector Modal** will appear, grouping your courses by semester/term.
4. Select the courses you wish to download and click **"Download Selected Courses"**.

---

## ⚙️ Customization & Settings

Right-click the extension icon and select **Options** (or click the gear icon in the popup) to configure:
- **Package Mode:** Single ZIP archive vs Individual downloaded files & folders.
- **Included Content:** Toggle Files, Pages/Notes, Announcements, and Grades.
- **Format:** Choose between Markdown (`.md`) and HTML (`.html`).
- **Video Filter:** Option to skip video files to save bandwidth and storage.
- **Folder Prefix:** Set a custom folder name (e.g., `Fall2026/`) for organized file management.

---

## 🔒 Privacy & Security

- **100% Client-Side:** No credentials, tokens, or files are ever transmitted to any external server or third party.
- **Local Network Only:** All network requests are made directly between your browser and your university's Blackboard server.
