const tree = document.getElementById("tree");
const preview = document.getElementById("preview");
const resizer = document.getElementById("resizer");
const searchBar = document.getElementById("search-bar");
const sidebar = document.getElementById("sidebar");
const muteBtn = document.getElementById("btn-mute");

let rootEntries = [];
let currentFileList = []; 
let currentIndex = -1;    
const expandedPaths = new Set();
let currentPreviewUrl = null;
let isMuted = true; 
let currentRenderId = 0; 

// Media Type Definitions
const EXT_IMG = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;
const EXT_VID = /\.(mp4|webm|ogv|mov|m4v|mkv|avi)$/i;
const EXT_AUD = /\.(mp3|wav|flac|aac|ogg|m4a)$/i;

// ─────────────────────────────────────────────
// TOOLBAR LOGIC
// ─────────────────────────────────────────────

muteBtn.onclick = () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle("is-muted", isMuted);
    muteBtn.textContent = isMuted ? "🔇" : "🔊";
    const mediaEl = preview.querySelector("video, audio");
    if (mediaEl) mediaEl.muted = isMuted;
};

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
// PREVIEW & NAVIGATION
// ─────────────────────────────────────────────

function clearPreview() {
    const oldMedia = preview.querySelectorAll("video, img, audio, .status-msg, .error-div");
    oldMedia.forEach(el => el.remove());
    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "block";
    currentIndex = -1;
    updateNavButtons();
}

function showPreview(blob, name, fileElement = null) {
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "none";

    preview.innerHTML = "";

    document.querySelectorAll('.file.selected').forEach(el => el.classList.remove('selected'));
    if (fileElement) {
        fileElement.classList.add('selected');
        currentFileList = Array.from(document.querySelectorAll('.file'));
        currentIndex = currentFileList.indexOf(fileElement);
    }

    const fileName = name.toLowerCase();
    let mimeType = "";
    if (fileName.endsWith('.ogv') || fileName.endsWith('.ogg')) mimeType = "video/ogg";
    else if (fileName.endsWith('.mp4')) mimeType = "video/mp4";
    else if (fileName.endsWith('.webm')) mimeType = "video/webm";
    else if (EXT_IMG.test(fileName)) mimeType = "image/" + fileName.split('.').pop();
    else if (EXT_AUD.test(fileName)) mimeType = "audio/mpeg";

    currentPreviewUrl = URL.createObjectURL(blob.slice(0, blob.size, mimeType));
    
    const container = document.createElement("div");
    container.className = "media-container";

    let mediaEl;
    if (EXT_IMG.test(fileName)) {
        mediaEl = document.createElement("img");
    } else if (EXT_VID.test(fileName)) {
        mediaEl = document.createElement("video");
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.loop = true; 
        mediaEl.muted = isMuted; 
        mediaEl.style.width = "100%";
    } else if (EXT_AUD.test(fileName)) {
        mediaEl = document.createElement("audio");
        mediaEl.controls = true;
        mediaEl.autoplay = true; 
        mediaEl.muted = isMuted; 
    }

    if (mediaEl) {
        mediaEl.src = currentPreviewUrl;
        
        const createNavBtn = (isNext) => {
            const btn = document.createElement("button");
            btn.className = `hover-nav ${isNext ? 'hover-next' : 'hover-prev'}`;
            btn.innerHTML = isNext ? "›" : "‹";
            
            const targetIdx = isNext ? currentIndex + 1 : currentIndex - 1;
            if (targetIdx < 0 || targetIdx >= currentFileList.length) {
                btn.style.display = "none";
                return btn;
            }

            btn.onpointerdown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetEl = currentFileList[targetIdx];
                if (targetEl) {
                    targetEl.click();
                    targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            };
            return btn;
        };

        container.append(createNavBtn(false), mediaEl, createNavBtn(true));
        preview.appendChild(container);

        const cap = document.createElement("div");
        cap.className = "status-msg";
        cap.textContent = name.split("/").pop();
        preview.appendChild(cap);
    }
}

function updateNavButtons() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    if (prevBtn) prevBtn.disabled = currentIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentIndex === -1 || currentIndex >= currentFileList.length - 1;
}

// ─────────────────────────────────────────────
// BATCHING HELPER
// ─────────────────────────────────────────────

function applyBatching(files, parentVFolder) {
    const BATCH_SIZE = 100;
    if (files.length <= BATCH_SIZE) {
        parentVFolder.files.push(...files);
        return;
    }
    
    let batchCounter = 1; 

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batchFiles = files.slice(i, i + BATCH_SIZE);
        const folderName = batchCounter.toString(); 
        batchCounter++; 

        parentVFolder.folders.set(folderName, { folders: new Map(), files: batchFiles, isBatch: true });
    }
}

// ─────────────────────────────────────────────
// ARCHIVE & FILE SYSTEM
// ─────────────────────────────────────────────

async function loadZipArchive(file, name, type) {
    const reader = new zip.ZipReader(new zip.BlobReader(file));
    try {
        const entries = await reader.getEntries();
        const allPaths = entries.filter(e => !e.directory).map(e => e.filename);
        rootEntries.push({ _type: "archive", archiveType: type, name, fullPath: name, zipReader: reader, entries, allPaths });
        reloadTree();
    } catch (err) {
        alert("Failed to read " + type);
    }
}

function renderArchiveNodeHierarchical(archive, parentEl) {
    const virtualTree = { folders: new Map(), files: [] };
    
    const dirMap = new Map();
    for (const path of archive.allPaths) {
        const parts = path.split('/');
        const fileName = parts.pop();
        const dirPath = parts.join('/') || 'root';
        if (!dirMap.has(dirPath)) dirMap.set(dirPath, []);
        dirMap.get(dirPath).push(path);
    }

    dirMap.forEach((files, dirPath) => {
        let cur = virtualTree;
        if (dirPath !== 'root') {
            const parts = dirPath.split('/');
            for (const part of parts) {
                if (!cur.folders.has(part)) cur.folders.set(part, { folders: new Map(), files: [] });
                cur = cur.folders.get(part);
            }
        }
        applyBatching(files, cur);
    });

    // FIX: Hide archive root entirely if nothing inside matches search
    if (!hasVisibleVirtualContent(virtualTree)) return;

    const container = document.createElement("div");
    const header = document.createElement("div");
    header.className = "folder";
    header.innerHTML = `<span class="arrow">▶</span><span class="badge badge-zip">${archive.archiveType}</span><span> ${archive.name}</span><span class="remove-btn">✕</span>`;
    
    const content = document.createElement("div");
    const isExpanded = expandedPaths.has(archive.fullPath);
    content.style.display = isExpanded ? "block" : "none";

    header.onclick = (e) => {
        if (e.target.classList.contains("remove-btn")) {
            e.stopPropagation();
            rootEntries = rootEntries.filter(a => a !== archive);
            clearPreview(); reloadTree(); return;
        }
        const isOpen = content.style.display === "block";
        content.style.display = isOpen ? "none" : "block";
        header.querySelector(".arrow").style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
        isOpen ? expandedPaths.delete(archive.fullPath) : expandedPaths.add(archive.fullPath);
        if (!isOpen) {
            content.innerHTML = "";
            renderVirtualFolder(virtualTree, content, 1, archive);
        }
    };
    if (isExpanded) {
        header.querySelector(".arrow").style.transform = "rotate(90deg)";
        renderVirtualFolder(virtualTree, content, 1, archive);
    }
    container.append(header, content);
    parentEl.appendChild(container);
}

function renderVirtualFolder(vFolder, containerEl, level, archive) {
    vFolder.folders.forEach((subV, name) => {
        // FIX: Skip subfolders with no visible content
        if (!hasVisibleVirtualContent(subV)) return;

        const fHeader = document.createElement("div");
        fHeader.className = "folder";
        fHeader.style.paddingLeft = (level * 12) + "px";
        
        const isBatch = subV.isBatch ? `<span class="badge badge-batch">BATCH</span>` : "";
        const icon = subV.isBatch ? "" : "📁 "; 
        
        fHeader.innerHTML = `<span class="arrow">▶</span>${isBatch}<span>${icon}${name}</span>`;
        const fContent = document.createElement("div");
        fContent.style.display = "none";
        
        fHeader.onclick = () => {
            const isOpen = fContent.style.display === "block";
            fContent.style.display = isOpen ? "none" : "block";
            fHeader.querySelector(".arrow").style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
            if (!isOpen) {
                fContent.innerHTML = "";
                renderVirtualFolder(subV, fContent, level + 1, archive);
            }
        };
        containerEl.append(fHeader, fContent);
    });

    vFolder.files.filter(f => {
        const name = (typeof f === 'string') ? f.split('/').pop() : f.name;
        return shouldDisplay(name);
    }).forEach(fileData => {
        const path = (typeof fileData === 'string') ? fileData : fileData.name;
        const item = document.createElement("div");
        item.className = "file";
        item.style.paddingLeft = (level * 12 + 14) + "px";
        item.innerHTML = `<span>${getIcon(path)}</span><span>${path.split('/').pop()}</span>`;
        
        item.onclick = async () => {
            if (archive && archive._type === "archive") {
                const entry = archive.entries.find(e => e.filename === path);
                if (entry) {
                    const blob = await entry.getData(new zip.BlobWriter());
                    showPreview(blob, path, item);
                }
            } else {
                const entry = fileData; 
                const f = entry._file || await new Promise(r => entry.file(r));
                showPreview(f, f.name, item);
            }
        };
        containerEl.appendChild(item);
    });
}

function hasVisibleVirtualContent(vFolder) {
    const hasMatchingFile = vFolder.files.some(f => {
        const name = (typeof f === 'string') ? f.split('/').pop() : f.name;
        return shouldDisplay(name);
    });
    if (hasMatchingFile) return true;
    for (const subV of vFolder.folders.values()) {
        if (hasVisibleVirtualContent(subV)) return true;
    }
    return false;
}

// Read all children of a directory entry into a flat array (one-shot cursor)
async function readAllEntries(dirEntry) {
    const results = [];
    const reader = dirEntry.createReader();
    const readBatch = async () => {
        const batch = await new Promise(res => reader.readEntries(res));
        if (batch.length > 0) {
            results.push(...batch);
            await readBatch();
        }
    };
    await readBatch();
    return results;
}

// Check if a list of children has any file matching current search+filter
async function hasVisibleLocalContent(entry, cachedChildren = null) {
    if (!entry.isDirectory) {
        return shouldDisplay(entry.name);
    }
    const children = cachedChildren !== null ? cachedChildren : await readAllEntries(entry);
    for (const child of children) {
        if (!child.isDirectory) {
            if (shouldDisplay(child.name)) return true;
        } else {
            if (await hasVisibleLocalContent(child)) return true;
        }
    }
    return false;
}

async function renderEntry(entry, parentEl, level, renderId, cachedChildren = null) {
    const pathKey = entry.fullPath || entry.name;

    if (entry.isDirectory) {
        // Read entries ONCE — reuse for both visibility check and rendering
        // (FileSystemDirectoryReader is a one-shot cursor; reading it twice gives empty results)
        const allRaw = cachedChildren !== null ? cachedChildren : await readAllEntries(entry);
        if (renderId !== currentRenderId) return;

        const isVisible = await hasVisibleLocalContent(entry, allRaw);
        if (renderId !== currentRenderId) return;
        if (!isVisible) return; 

        const container = document.createElement("div");
        const header = document.createElement("div");
        header.className = "folder";
        header.style.paddingLeft = (level * 12) + "px";
        header.innerHTML = `<span class="arrow">▶</span><span>📁 ${entry.name}</span><span class="remove-btn">✕</span>`;
        
        const content = document.createElement("div");
        const isExpanded = expandedPaths.has(pathKey);
        content.style.display = isExpanded ? "block" : "none";

        const renderLocalChildren = async (targetContentEl, items) => {
            targetContentEl.innerHTML = "";
            const folders = items.filter(e => e.isDirectory);
            const files = items.filter(e => !e.isDirectory);
            for (const f of folders) {
                if (renderId !== currentRenderId) return;
                await renderEntry(f, targetContentEl, level + 1, renderId);
            }
            if (files.length > 100) {
                const virtualSub = { folders: new Map(), files: [] };
                applyBatching(files, virtualSub);
                renderVirtualFolder(virtualSub, targetContentEl, level + 1, { _type: "local" });
            } else {
                for (const f of files) {
                    if (renderId !== currentRenderId) return;
                    await renderEntry(f, targetContentEl, level + 1, renderId);
                }
            }
        };

        header.onclick = async (ev) => {
            if (ev.target.classList.contains("remove-btn")) {
                ev.stopPropagation();
                rootEntries = rootEntries.filter(en => en !== entry);
                clearPreview(); reloadTree(); return;
            }
            const isOpen = content.style.display === "block";
            content.style.display = isOpen ? "none" : "block";
            header.querySelector(".arrow").style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
            isOpen ? expandedPaths.delete(pathKey) : expandedPaths.add(pathKey);
            if (!isOpen) await renderLocalChildren(content, allRaw);
        };

        if (isExpanded) {
            header.querySelector(".arrow").style.transform = "rotate(90deg)";
            await renderLocalChildren(content, allRaw);
        }
        container.append(header, content);
        parentEl.appendChild(container);

    } else if (shouldDisplay(entry.name)) {
        if (renderId !== currentRenderId) return;
        const el = document.createElement("div");
        el.className = "file" + (currentIndex === currentFileList.indexOf(el) ? " selected" : "");
        el.style.paddingLeft = (level * 12 + 14) + "px";
        el.innerHTML = `<span>${getIcon(entry.name)}</span><span>${entry.name}</span><span class="remove-btn">✕</span>`;
        
        el.onclick = async (ev) => {
            if (ev.target.classList.contains("remove-btn")) {
                ev.stopPropagation();
                rootEntries = rootEntries.filter(en => en !== entry);
                clearPreview(); reloadTree(); return;
            }
            const f = entry._file || await new Promise(r => entry.file(r));
            showPreview(f, f.name, el);
        };
        parentEl.appendChild(el);
    }
}

// ─────────────────────────────────────────────
// EVENTS & INIT
// ─────────────────────────────────────────────

searchBar.addEventListener('input', reloadTree);

async function reloadTree() {
    const renderId = ++currentRenderId;
    tree.innerHTML = "";
    if (rootEntries.length === 0) {
        tree.innerHTML = '<div class="empty-msg">Drop files or use Open File</div>';
        currentFileList = [];
        return;
    }
    for (const entry of rootEntries) {
        if (renderId !== currentRenderId) return;
        if (entry._type === "archive") renderArchiveNodeHierarchical(entry, tree);
        else await renderEntry(entry, tree, 0, renderId);
    }
    requestAnimationFrame(() => {
        currentFileList = Array.from(document.querySelectorAll('.file'));
    });
}

function initResizer() {
    let isResizing = false;

    resizer.addEventListener("mousedown", (e) => {
        isResizing = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        let x = e.clientX; 
        if (x > 150 && x < window.innerWidth * 0.8) {
            sidebar.style.width = x + "px";
        }
    });

    document.addEventListener("mouseup", () => {
        isResizing = false;
        document.body.style.cursor = "default";
        document.body.style.userSelect = "auto";
    });
}

async function handleFileSelect(e) {
    const files = e.target.files;
    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === "zip" || ext === "apk") await loadZipArchive(file, file.name, ext.toUpperCase());
        else if (isMedia(file.name)) rootEntries.push({ isFile: true, name: file.name, _file: file, fullPath: file.name, file: (cb) => cb(file) });
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
            if (ext === "zip" || ext === "apk") await loadZipArchive(file, file.name, ext.toUpperCase());
            else if (isMedia(file.name)) rootEntries.push({ isFile: true, name: file.name, _file: file, fullPath: file.name, file: (cb) => cb(file) });
        }
    }
    reloadTree();
}

document.getElementById('file-input').addEventListener('change', handleFileSelect);
document.querySelectorAll('input[name="filter"]').forEach(r => r.onchange = reloadTree);

[sidebar, preview].forEach(el => {
    el.addEventListener("dragover", e => e.preventDefault());
    el.addEventListener("drop", handleDrop);
});

initResizer();
reloadTree();
