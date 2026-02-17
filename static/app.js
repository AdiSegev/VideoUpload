/**
 * YouTube Uploader - Client-side logic
 * Handles drag & drop, file preview, form submission, and progress tracking.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const form = document.getElementById('uploadForm');
    if (!form) return;

    const videoInput = document.getElementById('videoInput');
    const thumbInput = document.getElementById('thumbInput');
    const videoDropZone = document.getElementById('videoDropZone');
    const thumbDropZone = document.getElementById('thumbDropZone');
    const videoDropContent = document.getElementById('videoDropContent');
    const videoPreview = document.getElementById('videoPreview');
    const videoFileName = document.getElementById('videoFileName');
    const videoFileSize = document.getElementById('videoFileSize');
    const thumbDropContent = document.getElementById('thumbDropContent');
    const thumbPreview = document.getElementById('thumbPreview');
    const thumbImage = document.getElementById('thumbImage');
    const titleInput = document.getElementById('title');
    const descInput = document.getElementById('description');
    const titleCount = document.getElementById('titleCount');
    const descCount = document.getElementById('descCount');
    const uploadBtn = document.getElementById('uploadBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressPercent = document.getElementById('progressPercent');
    const progressLabel = document.getElementById('progressLabel');
    const resultContainer = document.getElementById('resultContainer');

    // === Character Counters ===
    if (titleInput && titleCount) {
        titleInput.addEventListener('input', () => {
            titleCount.textContent = titleInput.value.length;
        });
    }

    if (descInput && descCount) {
        descInput.addEventListener('input', () => {
            descCount.textContent = descInput.value.length;
        });
    }

    // === Drag & Drop - Video ===
    setupDropZone(videoDropZone, videoInput, (file) => {
        videoFileName.textContent = file.name;
        videoFileSize.textContent = formatFileSize(file.size);
        videoDropContent.style.display = 'none';
        videoPreview.style.display = 'flex';
    });

    document.getElementById('removeVideo')?.addEventListener('click', () => {
        videoInput.value = '';
        videoDropContent.style.display = 'block';
        videoPreview.style.display = 'none';
    });

    // === Drag & Drop - Thumbnail ===
    setupDropZone(thumbDropZone, thumbInput, (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            thumbImage.src = e.target.result;
            thumbDropContent.style.display = 'none';
            thumbPreview.style.display = 'block';
            // Clear frame selection if user uploads a custom thumbnail
            clearFrameSelection();
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('removeThumb')?.addEventListener('click', () => {
        thumbInput.value = '';
        thumbDropContent.style.display = 'block';
        thumbPreview.style.display = 'none';
        clearFrameSelection();
    });

    // === Auto-generate Thumbnail from Video ===
    const generateFramesBtn = document.getElementById('generateFramesBtn');
    const framesLoading = document.getElementById('framesLoading');
    const framesGrid = document.getElementById('framesGrid');
    const framesList = document.getElementById('framesList');
    const selectedFramePath = document.getElementById('selectedFramePath');

    if (generateFramesBtn) {
        generateFramesBtn.addEventListener('click', async () => {
            if (!videoInput.files.length) {
                alert('יש לבחור קובץ וידאו קודם.');
                return;
            }

            // Show loading
            generateFramesBtn.disabled = true;
            framesLoading.style.display = 'flex';
            framesGrid.style.display = 'none';

            try {
                const formData = new FormData();
                formData.append('video', videoInput.files[0]);

                const response = await fetch('/extract-frames', {
                    method: 'POST',
                    body: formData,
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'שגיאה בחילוץ פריימים');
                }

                // Display frames
                framesList.innerHTML = '';
                data.frames.forEach((frame) => {
                    const div = document.createElement('div');
                    div.className = 'frame-item';
                    div.dataset.path = frame.path;
                    div.dataset.url = frame.url;

                    const minutes = Math.floor(frame.timestamp / 60);
                    const seconds = Math.floor(frame.timestamp % 60);
                    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                    div.innerHTML = `
                        <img src="${frame.url}" alt="Frame ${frame.index + 1}">
                        <span class="frame-timestamp">${timeStr}</span>
                    `;

                    div.addEventListener('click', () => selectFrame(div));
                    framesList.appendChild(div);
                });

                framesGrid.style.display = 'block';

            } catch (err) {
                alert('שגיאה: ' + err.message);
            } finally {
                generateFramesBtn.disabled = false;
                framesLoading.style.display = 'none';
            }
        });
    }

    function selectFrame(frameElement) {
        // Remove previous selection
        document.querySelectorAll('.frame-item.selected').forEach(el => el.classList.remove('selected'));
        // Select this frame
        frameElement.classList.add('selected');
        // Store the path for upload
        selectedFramePath.value = frameElement.dataset.path;
        // Show as thumbnail preview
        thumbImage.src = frameElement.dataset.url;
        thumbDropContent.style.display = 'none';
        thumbPreview.style.display = 'block';
        // Clear file input since we're using a generated frame
        thumbInput.value = '';
    }

    function clearFrameSelection() {
        document.querySelectorAll('.frame-item.selected').forEach(el => el.classList.remove('selected'));
        if (selectedFramePath) selectedFramePath.value = '';
    }

    // === Form Submission ===
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!videoInput.files.length) {
            showResult('error', 'יש לבחור קובץ וידאו.');
            return;
        }

        // Prepare form data
        const formData = new FormData(form);

        // Handle publish_at - convert to ISO format
        const publishAt = formData.get('publish_at');
        if (publishAt) {
            const isoDate = new Date(publishAt).toISOString();
            formData.set('publish_at', isoDate);
        }

        // Handle made_for_kids checkbox
        const madeForKids = document.getElementById('made_for_kids');
        formData.set('made_for_kids', madeForKids.checked ? 'true' : 'false');

        // UI: Show progress
        uploadBtn.disabled = true;
        progressContainer.style.display = 'block';
        resultContainer.style.display = 'none';
        setProgress(0, 'מתחיל העלאה...');

        try {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 90); // 90% for upload, 10% for processing
                    setProgress(percent, 'מעלה קובץ...');
                }
            });

            // Handle response
            const response = await new Promise((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(JSON.parse(xhr.responseText));
                    } else {
                        try {
                            const err = JSON.parse(xhr.responseText);
                            reject(new Error(err.error || 'שגיאה בהעלאה'));
                        } catch {
                            reject(new Error(`שגיאה ${xhr.status}`));
                        }
                    }
                };
                xhr.onerror = () => reject(new Error('שגיאת רשת'));

                xhr.open('POST', '/upload');
                xhr.send(formData);

                setProgress(5, 'שולח קבצים לשרת...');
            });

            setProgress(100, 'הושלם!');

            if (response.success) {
                let msg = `<h3>✅ הסרטון הועלה בהצלחה!</h3>
                    <p><a href="${response.video_url}" target="_blank">🔗 לצפייה בסרטון</a></p>
                    <p style="font-size:0.85rem; color: var(--text-muted);">Video ID: ${response.video_id}</p>`;

                if (response.thumbnail_error) {
                    msg += `<p style="color: var(--yellow); font-size: 0.85rem; margin-top: 0.5rem;">
                        ⚠️ תמונת תצוגה: ${response.thumbnail_error}</p>`;
                }

                showResult('success', msg);
            }

        } catch (err) {
            setProgress(0);
            showResult('error', `<h3>❌ שגיאה</h3><p>${err.message}</p>`);
        } finally {
            uploadBtn.disabled = false;
        }
    });

    // === Helper Functions ===

    function setupDropZone(zone, input, onFileSelected) {
        if (!zone || !input) return;

        // Click to select file
        zone.addEventListener('click', () => input.click());

        // File selected via input
        input.addEventListener('change', () => {
            if (input.files.length > 0) {
                onFileSelected(input.files[0]);
            }
        });

        // Drag events
        ['dragenter', 'dragover'].forEach(event => {
            zone.addEventListener(event, (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(event => {
            zone.addEventListener(event, (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
            });
        });

        zone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                // Assign the dropped file to the input
                const dt = new DataTransfer();
                dt.items.add(files[0]);
                input.files = dt.files;
                onFileSelected(files[0]);
            }
        });
    }

    function setProgress(percent, label) {
        if (progressFill) progressFill.style.width = percent + '%';
        if (progressPercent) progressPercent.textContent = percent + '%';
        if (progressLabel && label) progressLabel.textContent = label;
    }

    function showResult(type, html) {
        if (!resultContainer) return;
        resultContainer.style.display = 'block';
        resultContainer.innerHTML = `<div class="result-${type}">${html}</div>`;
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
});
