const tree = document.getElementById("tree");
const preview = document.getElementById("preview");
const resizer = document.getElementById("resizer");
const searchBar = document.getElementById("search-bar");
const sidebar = document.getElementById("sidebar");

let rootEntries = [];
const expandedPaths = new Set();
let currentPreviewUrl = null;

// Media Type Definitions
const EXT_IMG = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;
const EXT_VID = /\.(mp4|webm|ogv|mov|m4v|mkv|avi)$/i;
const EXT_AUD = /\.(mp3|wav|flac|aac|ogg|m4a)$/i;

let isMuted = true; // Defaulting to true for better mobile autoplay compatibility
const muteBtn = document.getElementById("btn-mute");

muteBtn.onclick = () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle("is-muted", isMuted);
    muteBtn.textContent = isMuted ? "🔇" : "🔊";

    // If a video/audio is currently playing, update it live!
    const mediaEl = preview.querySelector("video, audio");
    if (mediaEl) {
        mediaEl.muted = isMuted;
    }
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
// PREVIEW & MEMORY MANAGEMENT
// ─────────────────────────────────────────────

function clearPreview() {
    const oldMedia = preview.querySelectorAll("video, img, audio, .status-msg, .error-div");
    oldMedia.forEach(el => el.remove());
    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "block";
}

function showPreview(blob, name) {
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);

    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "none";

    const oldMedia = preview.querySelectorAll("video, img, audio, .status-msg, .error-div");
    oldMedia.forEach(el => el.remove());

    const fileName = name.toLowerCase();
    let mimeType = "";
    if (fileName.endsWith('.ogv') || fileName.endsWith('.ogg')) mimeType = "video/ogg";
    else if (fileName.endsWith('.mp4')) mimeType = "video/mp4";
    else if (fileName.endsWith('.webm')) mimeType = "video/webm";
    else if (EXT_IMG.test(fileName)) mimeType = "image/" + fileName.split('.').pop();
    else if (EXT_AUD.test(fileName)) mimeType = "audio/mpeg";

    currentPreviewUrl = URL.createObjectURL(blob.slice(0, blob.size, mimeType));
    
    let el;
    if (EXT_IMG.test(fileName)) {
        el = document.createElement("img");
    } else if (EXT_VID.test(fileName)) {
        el = document.createElement("video");
        el.controls = true;
        el.autoplay = true; 
        el.muted = isMuted; // Use the global state instead of 'true'
        el.style.width = "100%";
    } else if (EXT_AUD.test(fileName)) {
        el = document.createElement("audio");
        el.controls = true;
        el.autoplay = true; 
        el.muted = isMuted; // Use the global state
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
// LARGE FILE ARCHIVE LOGIC (zip.js)
// ─────────────────────────────────────────────

async function loadZipArchive(file, name, type) {
    // BlobReader allows random access without loading the 2GB+ file into RAM
    const reader = new zip.ZipReader(new zip.BlobReader(file));
    
    try {
        const entries = await reader.getEntries();
        const allPaths = entries.filter(e => !e.directory).map(e => e.filename);

        rootEntries.push({ 
            _type: "archive", 
            archiveType: type, 
            name: name,
            fullPath: name, 
            zipReader: reader, 
            entries: entries,
            allPaths: allPaths
        });
        reloadTree();
    } catch (err) {
        console.error("Archive Error:", err);
        alert("Failed to read " + type + ". Ensure it is a valid zip/apk.");
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

    vFolder.files.filter(f => shouldDisplay(f.split('/').pop())).forEach(path => {
        const item = document.createElement("div");
        item.className = "file";
        item.style.paddingLeft = (level * 12 + 14) + "px";
        item.innerHTML = `<span>${getIcon(path)}</span><span>${path.split('/').pop()}</span>`;
        item.onclick = async () => {
            const entry = archive.entries.find(e => e.filename === path);
            if (entry) showPreview(await entry.getData(new zip.BlobWriter()), path);
        };
        containerEl.appendChild(item);
    });
}

// ─────────────────────────────────────────────
// NATIVE FILE SYSTEM & DROPS
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
        if (isExpanded) for (const item of filteredItems) await renderEntry(item, content, level + 1);
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

async function handleFileSelect(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
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

// ─────────────────────────────────────────────
// TOUCH RESIZER & INITIALIZATION
// ─────────────────────────────────────────────

function initResizer() {
    const doResize = (clientX) => {
        if (clientX > 50 && clientX < window.innerWidth * 0.9) {
            sidebar.style.width = clientX + "px";
        }
    };

    resizer.onmousedown = () => {
        document.onmousemove = e => doResize(e.clientX);
        document.onmouseup = () => document.onmousemove = null;
    };

    // Blocks refresh gesture ONLY when finger is on the resizer bar
    resizer.addEventListener('touchstart', (e) => {
        e.preventDefault(); 
        const touchMoveHandler = (te) => doResize(te.touches[0].clientX);
        const touchEndHandler = () => {
            document.removeEventListener('touchmove', touchMoveHandler);
            document.removeEventListener('touchend', touchEndHandler);
        };
        document.addEventListener('touchmove', touchMoveHandler, { passive: false });
        document.addEventListener('touchend', touchEndHandler);
    }, { passive: false });
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
