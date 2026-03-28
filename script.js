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

// FIXED: Added 'fileElement' to parameters
function showPreview(blob, name, fileElement = null) {
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "none";

    preview.innerHTML = "";

    // Fix 1: Selection & Index Sync
    document.querySelectorAll('.file.selected').forEach(el => el.classList.remove('selected'));
    if (fileElement) {
        fileElement.classList.add('selected');
        // RE-FETCH the list every time to handle filtered views correctly
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
        
        // Fix 2: Android Optimized Buttons
        const createNavBtn = (isNext) => {
            const btn = document.createElement("button");
            btn.className = `hover-nav ${isNext ? 'hover-next' : 'hover-prev'}`;
            btn.innerHTML = isNext ? "›" : "‹";
            
            // Boundary Check
            const targetIdx = isNext ? currentIndex + 1 : currentIndex - 1;
            if (targetIdx < 0 || targetIdx >= currentFileList.length) {
                btn.style.display = "none";
                return btn;
            }

            // 'onpointerdown' is instant on Android
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
    
    // Only try to disable them if they actually exist in the HTML
    if (prevBtn) prevBtn.disabled = currentIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentIndex === -1 || currentIndex >= currentFileList.length - 1;
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
    for (const path of archive.allPaths) {
        const parts = path.split('/');
        let cur = virtualTree;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cur.folders.has(parts[i])) cur.folders.set(parts[i], { folders: new Map(), files: [] });
            cur = cur.folders.get(parts[i]);
        }
        cur.files.push(path);
    }

    const container = document.createElement("div");
    const header = document.createElement("div");
    header.className = "folder";
    header.innerHTML = `<span class="arrow">▶</span><span class="badge badge-zip">${archive.archiveType}</span><span> ${archive.name}</span><span class="remove-btn">✕</span>`;
    
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
            renderVirtualFolder(virtualTree, content, 1, archive);
        }
    };
    if (isExpanded) renderVirtualFolder(virtualTree, content, 1, archive);
    container.append(header, content);
    parentEl.appendChild(container);
}

function renderVirtualFolder(vFolder, containerEl, level, archive) {
    vFolder.folders.forEach((subV, name) => {
        // Fix 3: Don't render if folder is empty after filter
        if (!hasVisibleVirtualContent(subV)) return;

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
                renderVirtualFolder(subV, fContent, level + 1, archive);
            }
        };
        containerEl.append(fHeader, fContent);
    });

    // Files section stays the same...
    vFolder.files.filter(f => shouldDisplay(f.split('/').pop())).forEach(path => {
        const item = document.createElement("div");
        item.className = "file";
        item.style.paddingLeft = (level * 12 + 14) + "px";
        item.innerHTML = `<span>${getIcon(path)}</span><span>${path.split('/').pop()}</span>`;
        
        item.onclick = async () => {
            const entry = archive.entries.find(e => e.filename === path);
            if (entry) {
                const blob = await entry.getData(new zip.BlobWriter());
                showPreview(blob, path, item);
            }
        };
        containerEl.appendChild(item);
    });
}

function hasVisibleVirtualContent(vFolder) {
    // Check if any files in this specific folder match the filter
    const hasMatchingFile = vFolder.files.some(f => shouldDisplay(f.split('/').pop()));
    if (hasMatchingFile) return true;

    // Check if any sub-folders inside this folder have matching content
    for (const subV of vFolder.folders.values()) {
        if (hasVisibleVirtualContent(subV)) return true;
    }

    return false;
}

async function renderEntry(entry, parentEl, level) {
    const pathKey = entry.fullPath || entry.name;
    
    if (entry.isDirectory) {
        const reader = entry.createReader();
        const allRaw = await new Promise(res => reader.readEntries(res));
        
        // --- NEW LOGIC START ---
        // We need to recursively check if this folder or any subfolder contains a matching file
        const hasVisibleFiles = await checkVisibility(entry);
        if (!hasVisibleFiles) return; // If nothing inside matches, don't even create the folder
        // --- NEW LOGIC END ---

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
            header.querySelector(".arrow").style.transform = isOpen ? "rotate(90deg)" : "rotate(0deg)";
            isOpen ? expandedPaths.delete(pathKey) : expandedPaths.add(pathKey);
            if (!isOpen) {
                content.innerHTML = "";
                // Re-render children when opening
                for (const item of allRaw) await renderEntry(item, content, level + 1);
            }
        };

        if (isExpanded) {
            header.querySelector(".arrow").style.transform = "rotate(90deg)";
            for (const item of allRaw) await renderEntry(item, content, level + 1);
        }

        container.append(header, content);
        parentEl.appendChild(container);

    } else if (shouldDisplay(entry.name)) {
        // Standard file rendering...
        const f = entry._file || await new Promise(r => entry.file(r));
        const el = document.createElement("div");
        el.className = "file" + (currentIndex === currentFileList.indexOf(el) ? " selected" : "");
        el.style.paddingLeft = (level * 12 + 14) + "px";
        el.innerHTML = `<span>${getIcon(f.name)}</span><span>${f.name}</span><span class="remove-btn">✕</span>`;
        el.onclick = (ev) => {
            if (ev.target.classList.contains("remove-btn")) {
                rootEntries = rootEntries.filter(en => en !== entry);
                clearPreview(); reloadTree(); return;
            }
            showPreview(f, f.name, el);
        };
        parentEl.appendChild(el);
    }
}

// Add this helper function below renderEntry
async function checkVisibility(entry) {
    if (!entry.isDirectory) {
        return shouldDisplay(entry.name);
    }
    const reader = entry.createReader();
    const entries = await new Promise(res => reader.readEntries(res));
    for (const subEntry of entries) {
        if (await checkVisibility(subEntry)) return true;
    }
    return false;
}

// ─────────────────────────────────────────────
// EVENTS & INIT
// ─────────────────────────────────────────────

searchBar.addEventListener('input', () => {
    reloadTree();
})

async function reloadTree() {
    tree.innerHTML = "";
    if (rootEntries.length === 0) {
        tree.innerHTML = '<div class="empty-msg">Drop files or use Open File</div>';
        currentFileList = [];
        return;
    }
    for (const entry of rootEntries) {
        if (entry._type === "archive") renderArchiveNodeHierarchical(entry, tree);
        else await renderEntry(entry, tree, 0);
    }

    // Refresh the navigation list after DOM updates
    requestAnimationFrame(() => {
        currentFileList = Array.from(document.querySelectorAll('.file'));
    });
}

function initResizer() {
    const doResize = (clientX) => {
        if (clientX > 50 && clientX < window.innerWidth * 0.9) sidebar.style.width = clientX + "px";
    };
    resizer.onmousedown = () => {
        document.onmousemove = e => doResize(e.clientX);
        document.onmouseup = () => document.onmousemove = null;
    };
    resizer.addEventListener('touchstart', (e) => {
        e.preventDefault(); 
        const move = (te) => doResize(te.touches[0].clientX);
        const end = () => {
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', end);
        };
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', end);
    }, { passive: false });
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
searchBar.oninput = reloadTree;
document.querySelectorAll('input[name="filter"]').forEach(r => r.onchange = reloadTree);

[sidebar, preview].forEach(el => {
    el.addEventListener("dragover", e => e.preventDefault());
    el.addEventListener("drop", handleDrop);
});

initResizer();
reloadTree();
