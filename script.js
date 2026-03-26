const tree = document.getElementById("tree");
const preview = document.getElementById("preview");
const resizer = document.getElementById("resizer");
const searchBar = document.getElementById("search-bar");
const sidebar = document.getElementById("sidebar");

let rootEntries = [];
const expandedPaths = new Set();
let currentPreviewUrl = null;

// Regex for media types
const EXT_IMG = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;
const EXT_VID = /\.(mp4|webm|ogv|mov|m4v|mkv|avi)$/i;
const EXT_AUD = /\.(mp3|wav|flac|aac|ogg|m4a)$/i;

function isMedia(name) { 
    return EXT_IMG.test(name) || EXT_VID.test(name) || EXT_AUD.test(name); 
}

function getIcon(name) {
    if (EXT_IMG.test(name)) return "🖼️";
    if (EXT_VID.test(name)) return "🎬";
    if (EXT_AUD.test(name)) return "🎵";
    return "📄"; 
}

function shouldDisplay(name) {
    const searchTerm = searchBar.value.toLowerCase();
    const filter = document.querySelector('input[name="filter"]:checked').value;
    const matchesSearch = name.toLowerCase().includes(searchTerm);
    let matchesFilter = true;
    if (filter === "images") matchesFilter = EXT_IMG.test(name);
    if (filter === "videos") matchesFilter = EXT_VID.test(name);
    return matchesSearch && matchesFilter;
}

// ─────────────────────────────────────────────
// PREVIEW LOGIC (Watermark & Toggle)
// ─────────────────────────────────────────────

function clearPreview() {
    // Remove all media and captions
    const oldMedia = preview.querySelectorAll("video, img, audio, .status-msg, .error-div");
    oldMedia.forEach(el => el.remove());

    // Show the "Preview Here" text again
    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "block";
}

function showPreview(blob, name) {
    if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
    }

    // Toggle Visibility
    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "none";

    // Clean up previous media only (leaves watermark safe)
    const oldMedia = preview.querySelectorAll("video, img, audio, .status-msg, .error-div");
    oldMedia.forEach(el => el.remove());

    const fileName = name.toLowerCase();
    let mimeType = "";
    if (fileName.endsWith('.ogv') || fileName.endsWith('.ogg')) mimeType = "video/ogg";
    else if (fileName.endsWith('.mp4')) mimeType = "video/mp4";
    else if (fileName.endsWith('.webm')) mimeType = "video/webm";
    else if (EXT_IMG.test(fileName)) mimeType = "image/" + fileName.split('.').pop();
    else if (EXT_AUD.test(fileName)) mimeType = "audio/mpeg";

    const finalBlob = blob.slice(0, blob.size, mimeType);
    currentPreviewUrl = URL.createObjectURL(finalBlob);
    
    let el;
    if (EXT_IMG.test(fileName)) {
        el = document.createElement("img");
    } else if (EXT_VID.test(fileName)) {
        el = document.createElement("video");
        el.controls = true;
        el.autoplay = true; 
        el.muted = true; // Essential for Android autoplay
        el.style.width = "100%";
    } else if (EXT_AUD.test(fileName)) {
        el = document.createElement("audio");
        el.controls = true;
        el.autoplay = true; 
    }

    if (el) {
        el.src = currentPreviewUrl;
        preview.appendChild(el);

        const cap = document.createElement("div");
        cap.className = "status-msg";
        cap.textContent = name.split("/").pop();
        preview.appendChild(cap);
    }
}

// ─────────────────────────────────────────────
// ARCHIVE LOGIC (ZIP/APK)
// ─────────────────────────────────────────────

async function loadZipArchive(buf, name, type) {
    const zip = await JSZip.loadAsync(buf);
    rootEntries.push({ 
        _type: "archive", 
        archiveType: type, 
        name: name,
        fullPath: name, 
        zipObject: zip,
        allPaths: Object.keys(zip.files).filter(p => !zip.files[p].dir)
    });
    reloadTree();
}

function renderArchiveNodeHierarchical(archive, parentEl) {
    const searchTerm = searchBar.value.toLowerCase();
    const virtualTree = { folders: new Map(), files: [] };

    for (const path of archive.allPaths) {
        const parts = path.split('/');
        let currentFolder = virtualTree;
        for (let i = 0; i < parts.length - 1; i++) {
            const folderName = parts[i];
            if (!currentFolder.folders.has(folderName)) {
                currentFolder.folders.set(folderName, { folders: new Map(), files: [] });
            }
            currentFolder = currentFolder.folders.get(folderName);
        }
        currentFolder.files.push(path);
    }

    const getVisibleSubPaths = (vFolder) => {
        let visible = vFolder.files.filter(f => shouldDisplay(f.split('/').pop()));
        for (const sub of vFolder.folders.values()) visible = visible.concat(getVisibleSubPaths(sub));
        return visible;
    };

    if (getVisibleSubPaths(virtualTree).length === 0 && !archive.name.toLowerCase().includes(searchTerm)) return;

    const container = document.createElement("div");
    const header = document.createElement("div");
    header.className = "folder";
    header.innerHTML = `
        <span class="arrow">▶</span>
        <span class="badge badge-zip">${archive.archiveType}</span>
        <span> ${archive.name}</span>
        <span class="remove-btn">✕</span>
    `;
    
    const content = document.createElement("div");
    const isExpanded = expandedPaths.has(archive.fullPath);
    content.style.display = isExpanded ? "block" : "none";

    header.onclick = (e) => {
        if (e.target.classList.contains("remove-btn")) {
            rootEntries = rootEntries.filter(a => a !== archive);
            clearPreview(); reloadTree(); return;
        }
        const isOpen = content.style.display === "block";
        content.style.display = isOpen ? "none" : "block";
        header.querySelector(".arrow").style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
        isOpen ? expandedPaths.delete(archive.fullPath) : expandedPaths.add(archive.fullPath);
        if (!isOpen) {
            content.innerHTML = "";
            renderVirtualFolder(virtualTree, content, 1, archive.fullPath, archive.zipObject);
        }
    };

    if (isExpanded) renderVirtualFolder(virtualTree, content, 1, archive.fullPath, archive.zipObject);
    container.append(header, content);
    parentEl.appendChild(container);
}

// Helper for virtual archive folders
function renderVirtualFolder(vFolder, containerEl, level, pathPrefix, zip) {
    vFolder.folders.forEach((subV, name) => {
        const fHeader = document.createElement("div");
        fHeader.className = "folder";
        fHeader.style.paddingLeft = (level * 12) + "px";
        fHeader.innerHTML = `<span class="arrow">▶</span><span>📁 ${name}</span>`;
        const fContent = document.createElement("div");
        fContent.style.display = "none";
        fHeader.onclick = () => {
            const isOpen = fContent.style.display === "block";
            fContent.style.display = isOpen ? "none" : "block";
            fHeader.querySelector(".arrow").style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
            if (!isOpen) {
                fContent.innerHTML = "";
                renderVirtualFolder(subV, fContent, level + 1, pathPrefix + "/" + name, zip);
            }
        };
        containerEl.append(fHeader, fContent);
    });

    vFolder.files.filter(f => shouldDisplay(f.split('/').pop())).forEach(path => {
        const item = document.createElement("div");
        item.className = "file";
        item.style.paddingLeft = (level * 12 + 14) + "px";
        item.innerHTML = `<span>${getIcon(path)}</span><span>${path.split('/').pop()}</span>`;
        item.onclick = async () => showPreview(await zip.file(path).async("blob"), path);
        containerEl.appendChild(item);
    });
}

// ─────────────────────────────────────────────
// NATIVE FOLDER / FILE LOGIC
// ─────────────────────────────────────────────

async function renderEntry(entry, parentEl, level) {
    const pathKey = entry.fullPath || entry.name;
    if (entry.isDirectory) {
        const reader = entry.createReader();
        const allRaw = await new Promise(res => reader.readEntries(res));
        const filteredItems = allRaw.filter(item => item.isDirectory || shouldDisplay(item.name));
        if (filteredItems.length === 0) return;

        const container = document.createElement("div");
        const header = document.createElement("div");
        header.className = "folder";
        header.style.paddingLeft = (level * 12) + "px";
        header.innerHTML = `<span class="arrow">▶</span><span>📁 ${entry.name}</span><span class="remove-btn">✕</span>`;
        
        const content = document.createElement("div");
        const isExpanded = expandedPaths.has(pathKey);
        content.style.display = isExpanded ? "block" : "none";

        header.onclick = async (ev) => {
            if (ev.target.classList.contains("remove-btn")) {
                rootEntries = rootEntries.filter(en => en !== entry);
                clearPreview(); reloadTree(); return;
            }
            const isOpen = content.style.display === "block";
            content.style.display = isOpen ? "none" : "block";
            header.querySelector(".arrow").style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
            isOpen ? expandedPaths.delete(pathKey) : expandedPaths.add(pathKey);
            if (!isOpen) {
                content.innerHTML = "";
                for (const item of filteredItems) await renderEntry(item, content, level + 1);
            }
        };
        if (isExpanded) {
            for (const item of filteredItems) await renderEntry(item, content, level + 1);
        }
        container.append(header, content);
        parentEl.appendChild(container);
    } else if (shouldDisplay(entry.name)) {
        const f = entry._file || await new Promise(r => entry.file(r));
        const el = document.createElement("div");
        el.className = "file";
        el.style.paddingLeft = (level * 12 + 14) + "px";
        el.innerHTML = `<span>${getIcon(f.name)}</span><span>${f.name}</span><span class="remove-btn">✕</span>`;
        el.onclick = (ev) => {
            if (ev.target.classList.contains("remove-btn")) {
                rootEntries = rootEntries.filter(en => en !== entry);
                clearPreview(); reloadTree(); return;
            }
            showPreview(f, f.name);
        };
        parentEl.appendChild(el);
    }
}

// ─────────────────────────────────────────────
// INPUT & SYSTEM HANDLERS
// ─────────────────────────────────────────────

async function handleFileSelect(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === "zip" || ext === "apk") {
            await loadZipArchive(await file.arrayBuffer(), file.name, ext.toUpperCase());
        } else if (isMedia(file.name)) {
            rootEntries.push({ isFile: true, name: file.name, _file: file, fullPath: file.name, file: (cb) => cb(file) });
        }
    }
    reloadTree();
    e.target.value = "";
}

async function handleDrop(e) {
    e.preventDefault();
    for (const item of e.dataTransfer.items) {
        const entry = item.webkitGetAsEntry();
        if (!entry) continue;
        if (entry.isDirectory) rootEntries.push(entry);
        else {
            const file = item.getAsFile();
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext === "zip" || ext === "apk") await loadZipArchive(await file.arrayBuffer(), file.name, ext.toUpperCase());
            else if (isMedia(file.name)) rootEntries.push({ isFile: true, name: file.name, _file: file, fullPath: file.name, file: (cb) => cb(file) });
        }
    }
    reloadTree();
}

async function reloadTree() {
    tree.innerHTML = "";
    if (rootEntries.length === 0) {
        tree.innerHTML = '<div class="empty-msg">Drop files or use Open File</div>';
        return;
    }
    for (const entry of rootEntries) {
        if (entry._type === "archive") renderArchiveNodeHierarchical(entry, tree);
        else await renderEntry(entry, tree, 0);
    }
}

function initResizer() {
    const doResize = (clientX) => {
        if (clientX > 50 && clientX < window.innerWidth * 0.9) {
            sidebar.style.width = clientX + "px";
        }
    };

    // Mouse Events
    resizer.onmousedown = () => {
        document.onmousemove = e => doResize(e.clientX);
        document.onmouseup = () => document.onmousemove = null;
    };

    // Touch Events for Android
    resizer.addEventListener('touchstart', (e) => {
        // We only preventDefault here to stop the "bounce" 
        // while the finger is actually on the resizer bar.
        e.preventDefault(); 

        const touchMoveHandler = (te) => {
            doResize(te.touches[0].clientX);
        };

        const touchEndHandler = () => {
            document.removeEventListener('touchmove', touchMoveHandler);
            document.removeEventListener('touchend', touchEndHandler);
        };

        document.addEventListener('touchmove', touchMoveHandler, { passive: false });
        document.addEventListener('touchend', touchEndHandler);
    }, { passive: false });
}

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────

document.getElementById('file-input').addEventListener('change', handleFileSelect);
searchBar.oninput = reloadTree;
document.querySelectorAll('input[name="filter"]').forEach(r => r.onchange = reloadTree);

[sidebar, preview].forEach(el => {
    el.addEventListener("dragover", e => e.preventDefault());
    el.addEventListener("drop", handleDrop);
});

initResizer();
reloadTree();
