const tree = document.getElementById("tree");
const preview = document.getElementById("preview");
const resizer = document.getElementById("resizer");
const searchBar = document.getElementById("search-bar");
const sidebar = document.getElementById("sidebar");

let rootEntries = [];
const expandedPaths = new Set(); 

// Updated regex to include .ogv
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

function clearPreview() {
    preview.innerHTML = "Preview Here";
}

// Add this at the very top of your script.js to manage memory

let currentPreviewUrl = null;

function showPreview(blob, name) {
    // 1. Memory Cleanup
    if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
    }

    // 2. THE TOGGLE LOGIC
    const introText = document.getElementById("previewText");
    const watermark = document.getElementById("watermark");

    // Hide the "Preview Here" text (but don't delete it!)
    if (introText) introText.style.display = "none";

    // 3. CLEANUP PREVIOUS MEDIA
    // We only remove elements we CREATED (videos, images, status-msgs)
    // This leaves both #previewText and #watermark safe in the HTML
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

// 4. THE "RESET" LOGIC
// Use this function when you close a file or clear the list
function clearPreview() {
    // Remove all media
    const oldMedia = preview.querySelectorAll("video, img, audio, .status-msg");
    oldMedia.forEach(el => el.remove());

    // Show the "Preview Here" text again
    const introText = document.getElementById("previewText");
    if (introText) introText.style.display = "block";

    // The watermark is never hidden, so it's already there!
}

// ─────────────────────────────────────────────
// ZIP and APK Hierarchical Logic
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
}

function renderArchiveNodeHierarchical(archive, parentEl) {
    const searchTerm = searchBar.value.toLowerCase();

    // Build Virtual Tree
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

    // Helper to see if folder has visible content
    const getVisibleSubPaths = (vFolder) => {
        let visible = vFolder.files.filter(f => shouldDisplay(f.split('/').pop()) && f.toLowerCase().includes(searchTerm));
        for (const sub of vFolder.folders.values()) visible = visible.concat(getVisibleSubPaths(sub));
        return visible;
    };

    const allVisible = getVisibleSubPaths(virtualTree);
    if (allVisible.length === 0 && !archive.name.toLowerCase().includes(searchTerm)) return;

    const archivePathKey = archive.fullPath;
    const container = document.createElement("div");
    const header = document.createElement("div");
    header.className = "folder";
    header.innerHTML = `<span class="arrow">▶</span><span class="badge badge-zip">${archive.archiveType}</span><span> ${archive.name}</span><span class="remove-btn">✕</span>`;
    
    const content = document.createElement("div");
    const isExpanded = expandedPaths.has(archivePathKey);
    content.style.display = isExpanded ? "block" : "none";
    if (isExpanded) header.querySelector(".arrow").style.transform = "rotate(90deg)";

    const renderVirtualFolder = async (vFolder, containerEl, level, pathPrefix) => {
        // Render Folders
        for (const [name, subV] of vFolder.folders.entries()) {
            if (getVisibleSubPaths(subV).length === 0) continue;
            const subKey = `${pathPrefix}/${name}`;
            const fContainer = document.createElement("div");
            const fHeader = document.createElement("div");
            fHeader.className = "folder";
            fHeader.style.paddingLeft = (level * 12) + "px";
            fHeader.innerHTML = `<span class="arrow">▶</span><span>📁 ${name}</span>`;
            const fContent = document.createElement("div");
            const isSubOpen = expandedPaths.has(subKey);
            fContent.style.display = isSubOpen ? "block" : "none";
            if (isSubOpen) fHeader.querySelector(".arrow").style.transform = "rotate(90deg)";

            fHeader.onclick = () => {
                if (fContent.style.display === "none") {
                    fContent.innerHTML = "";
                    renderVirtualFolder(subV, fContent, level + 1, subKey);
                    fContent.style.display = "block";
                    fHeader.querySelector(".arrow").style.transform = "rotate(90deg)";
                    expandedPaths.add(subKey);
                } else {
                    fContent.style.display = "none";
                    fHeader.querySelector(".arrow").style.transform = "rotate(0deg)";
                    expandedPaths.delete(subKey);
                }
            };
            if (isSubOpen) renderVirtualFolder(subV, fContent, level + 1, subKey);
            fContainer.append(fHeader, fContent);
            containerEl.appendChild(fContainer);
        }

        // Render Files with Batching
        const visibleFiles = vFolder.files.filter(f => shouldDisplay(f.split('/').pop()) && f.toLowerCase().includes(searchTerm));
        let i = 0;
        while (i < visibleFiles.length) {
            const chunk = visibleFiles.slice(i, i + 100);
            if (visibleFiles.length > 100 && chunk.length === 100) {
                renderVirtualBatch(chunk, containerEl, level, (i/100)+1, pathPrefix, archive.zipObject);
            } else {
                chunk.forEach(p => renderArchiveFile(p, containerEl, level, archive.zipObject));
            }
            i += 100;
        }
    };

    const renderArchiveFile = (path, el, level, zip) => {
        const item = document.createElement("div");
        item.className = "file";
        item.style.paddingLeft = (level * 12 + 14) + "px";
        item.innerHTML = `<span>${getIcon(path)}</span><span>${path.split('/').pop()}</span>`;
        item.onclick = async () => showPreview(await zip.file(path).async("blob"), path);
        el.appendChild(item);
    };

    const renderVirtualBatch = (items, el, level, num, prefix, zip) => {
        const key = `${prefix}_batch_${num}`;
        const bCont = document.createElement("div");
        const bHead = document.createElement("div");
        bHead.className = "folder"; bHead.style.paddingLeft = (level * 12) + "px";
        bHead.innerHTML = `<span class="arrow">▶</span><span class="badge badge-batch">${num}</span><span> Block</span>`;
        const bBody = document.createElement("div");
        const isOpen = expandedPaths.has(key);
        bBody.style.display = isOpen ? "block" : "none";
        bHead.onclick = () => {
            if (bBody.style.display === "none") {
                bBody.innerHTML = "";
                items.forEach(p => renderArchiveFile(p, bBody, level + 1, zip));
                bBody.style.display = "block";
                expandedPaths.add(key);
            } else { bBody.style.display = "none"; expandedPaths.delete(key); }
        };
        if (isOpen) items.forEach(p => renderArchiveFile(p, bBody, level + 1, zip));
        bCont.append(bHead, bBody); el.appendChild(bCont);
    };

    header.onclick = (e) => {
        if (e.target.classList.contains("remove-btn")) {
            rootEntries = rootEntries.filter(a => a !== archive);
            expandedPaths.delete(archivePathKey);
            clearPreview(); reloadTree(); return;
        }
        if (content.style.display === "none") {
            content.innerHTML = "";
            renderVirtualFolder(virtualTree, content, 0, archivePathKey);
            content.style.display = "block";
            header.querySelector(".arrow").style.transform = "rotate(90deg)";
            expandedPaths.add(archivePathKey);
        } else {
            content.style.display = "none";
            header.querySelector(".arrow").style.transform = "rotate(0deg)";
            expandedPaths.delete(archivePathKey);
        }
    };

    if (isExpanded) renderVirtualFolder(virtualTree, content, 0, archivePathKey);
    container.append(header, content);
    parentEl.appendChild(container);
}

// ─────────────────────────────────────────────
// Native Folder and App Logic
// ─────────────────────────────────────────────

async function handleDrop(e) {
    e.preventDefault();
    sidebar.classList.remove("drag-over");
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
        tree.innerHTML = '<div class="empty-msg">Drop files or folders here</div>';
        return;
    }
    for (const entry of rootEntries) {
        if (entry._type === "archive") renderArchiveNodeHierarchical(entry, tree);
        else await renderEntry(entry, tree, 0);
    }
}

// (Existing Native renderEntry and Batch Logic remains the same as previous version)
async function getAllEntries(reader) {
    let results = [];
    let batch = await new Promise(res => reader.readEntries(res));
    while (batch.length > 0) {
        results = results.concat(batch);
        batch = await new Promise(res => reader.readEntries(res));
    }
    return results;
}

async function renderEntry(entry, parentEl, level) {
    const pathKey = entry.fullPath || entry.name;
    if (entry.isDirectory) {
        const allRaw = await getAllEntries(entry.createReader());
        const filteredItems = allRaw.filter(item => item.isDirectory || shouldDisplay(item.name));
        if (filteredItems.length === 0) return;
        const container = document.createElement("div");
        const header = document.createElement("div");
        header.className = "folder";
        header.style.paddingLeft = (level * 12) + "px";
        header.innerHTML = `<span class="arrow">▶</span><span>📁 ${entry.name}</span>${level===0?'<span class="remove-btn">✕</span>':''}`;
        const content = document.createElement("div");
        const isExpanded = expandedPaths.has(pathKey);
        content.style.display = isExpanded ? "block" : "none";
        if (isExpanded) header.querySelector(".arrow").style.transform = "rotate(90deg)";
        header.onclick = async (ev) => {
            if (ev.target.classList.contains("remove-btn")) {
                rootEntries = rootEntries.filter(en => en !== entry);
                expandedPaths.delete(pathKey);
                clearPreview(); reloadTree(); return;
            }
            if (content.style.display === "none") {
                content.innerHTML = "";
                expandedPaths.add(pathKey);
                await fillFolderContent(filteredItems, content, level, pathKey);
                content.style.display = "block";
                header.querySelector(".arrow").style.transform = "rotate(90deg)";
            } else {
                content.style.display = "none";
                expandedPaths.delete(pathKey);
                header.querySelector(".arrow").style.transform = "rotate(0deg)";
            }
        };
        if (isExpanded) await fillFolderContent(filteredItems, content, level, pathKey);
        container.append(header, content);
        parentEl.appendChild(container);
    } else if (shouldDisplay(entry.name)) {
        const f = entry._file || await new Promise(r => entry.file(r));
        const el = document.createElement("div");
        el.className = "file"; el.style.paddingLeft = (level * 12 + 14) + "px";
        el.innerHTML = `<span>${getIcon(f.name)}</span><span>${f.name}</span>${level===0?'<span class="remove-btn">✕</span>':''}`;
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

async function fillFolderContent(items, contentEl, level, pathKey) {
    contentEl.innerHTML = "";
    let i = 0;
    while (i < items.length) {
        const chunk = items.slice(i, i + 100);
        if (items.length > 100 && chunk.length === 100) {
            const bKey = `${pathKey}_batch_${(i/100)+1}`;
            const bCont = document.createElement("div");
            const bHead = document.createElement("div");
            bHead.className = "folder"; bHead.style.paddingLeft = ((level+1) * 12) + "px";
            bHead.innerHTML = `<span class="arrow">▶</span><span class="badge badge-batch">${(i/100)+1}</span><span> Block</span>`;
            const bBody = document.createElement("div");
            const isOpen = expandedPaths.has(bKey);
            bBody.style.display = isOpen ? "block" : "none";
            bHead.onclick = async () => {
                if (bBody.style.display === "none") {
                    bBody.innerHTML = "";
                    for (const item of chunk) await renderEntry(item, bBody, level + 2);
                    bBody.style.display = "block"; expandedPaths.add(bKey);
                } else { bBody.style.display = "none"; expandedPaths.delete(bKey); }
            };
            if (isOpen) { for (const item of chunk) await renderEntry(item, bBody, level + 2); }
            bCont.append(bHead, bBody); contentEl.appendChild(bCont);
        } else {
            for (const item of chunk) await renderEntry(item, contentEl, level + 1);
        }
        i += 100;
    }
}

// Function to handle the "Open File" button selection
async function handleFileSelect(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        
        // 1. Check if it's an Archive (ZIP or APK)
        if (ext === "zip" || ext === "apk") {
            try {
                await loadZipArchive(await file.arrayBuffer(), file.name, ext.toUpperCase());
            } catch (err) {
                console.error("Error loading archive:", err);
            }
        } 
        // 2. Otherwise, check if it's a standalone Media File
        else if (isMedia(file.name)) {
            rootEntries.push({ 
                isFile: true, 
                name: file.name, 
                _file: file, 
                fullPath: file.name, 
                file: (cb) => cb(file) 
            });
        }
    }
    
    reloadTree();
    // Reset input so the user can re-select the same file if they want
    e.target.value = "";
}

// Attach the listener to the combined input
document.getElementById('file-input').addEventListener('change', handleFileSelect);

[sidebar, preview].forEach(el => {
    el.addEventListener("dragover", e => e.preventDefault());
    el.addEventListener("drop", handleDrop);
});
searchBar.oninput = reloadTree;
document.querySelectorAll('input[name="filter"]').forEach(r => r.onchange = reloadTree);
resizer.onmousedown = () => {
    document.onmousemove = e => sidebar.style.width = e.clientX + "px";
    document.onmouseup = () => document.onmousemove = null;
};
reloadTree();