/**
 * YouTube Uploader - Client-side logic
 * Direct browser-to-YouTube upload using YouTube Data API v3 resumable upload.
 * The video file never passes through our server.
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
    const newUploadBtn = document.getElementById('newUploadBtn');

    if (newUploadBtn) {
        newUploadBtn.addEventListener('click', () => resetForm());
    }

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

    // === Auto-generate Thumbnail from Video (client-side) ===
    const generateFramesBtn = document.getElementById('generateFramesBtn');
    const framesLoading = document.getElementById('framesLoading');
    const framesGrid = document.getElementById('framesGrid');
    const framesList = document.getElementById('framesList');
    let selectedFrameBlob = null; // Holds the selected frame as a Blob

    if (generateFramesBtn) {
        generateFramesBtn.addEventListener('click', async () => {
            if (!videoInput.files.length) {
                alert('יש לבחור קובץ וידאו קודם.');
                return;
            }

            generateFramesBtn.disabled = true;
            framesLoading.style.display = 'flex';
            framesGrid.style.display = 'none';

            try {
                const frames = await extractFramesClientSide(videoInput.files[0]);

                framesList.innerHTML = '';
                frames.forEach((frame, idx) => {
                    const div = document.createElement('div');
                    div.className = 'frame-item';
                    div.dataset.index = idx;

                    const minutes = Math.floor(frame.timestamp / 60);
                    const seconds = Math.floor(frame.timestamp % 60);
                    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                    const img = document.createElement('img');
                    img.src = frame.dataUrl;
                    img.alt = `Frame ${idx + 1}`;

                    const span = document.createElement('span');
                    span.className = 'frame-timestamp';
                    span.textContent = timeStr;

                    div.appendChild(img);
                    div.appendChild(span);

                    div.addEventListener('click', () => selectFrame(div, frame));
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

    /**
     * Extract 5 evenly-spaced frames from a video file using HTML5 video + canvas.
     * Returns array of { dataUrl, blob, timestamp }.
     */
    function extractFramesClientSide(file) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'auto';
            video.muted = true;

            const objectUrl = URL.createObjectURL(file);
            video.src = objectUrl;

            video.addEventListener('error', () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('לא ניתן לפתוח את קובץ הווידאו.'));
            });

            video.addEventListener('loadedmetadata', async () => {
                const duration = video.duration;
                if (!duration || duration <= 0) {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('לא ניתן לקרוא את משך הווידאו.'));
                    return;
                }

                // 5 frames at evenly spaced intervals, skipping first/last 10%
                const start = duration * 0.1;
                const end = duration * 0.9;
                const step = (end - start) / 4; // 5 frames = 4 intervals
                const timestamps = [];
                for (let i = 0; i < 5; i++) {
                    timestamps.push(start + i * step);
                }

                const frames = [];
                for (const ts of timestamps) {
                    try {
                        const frame = await captureFrame(video, ts);
                        frames.push(frame);
                    } catch (e) {
                        // Skip frames that fail
                    }
                }

                URL.revokeObjectURL(objectUrl);
                if (frames.length === 0) {
                    reject(new Error('לא הצלחנו לחלץ פריימים מהווידאו.'));
                } else {
                    resolve(frames);
                }
            });
        });
    }

    /**
     * Seek video to a specific time and capture a frame as JPEG.
     */
    function captureFrame(video, time) {
        return new Promise((resolve, reject) => {
            video.currentTime = time;

            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);

                const canvas = document.createElement('canvas');
                // Limit to 1920px width
                let w = video.videoWidth;
                let h = video.videoHeight;
                if (w > 1920) {
                    const scale = 1920 / w;
                    w = 1920;
                    h = Math.round(h * scale);
                }
                canvas.width = w;
                canvas.height = h;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, w, h);

                const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve({ dataUrl, blob, timestamp: Math.round(time * 10) / 10 });
                    } else {
                        reject(new Error('Failed to create blob'));
                    }
                }, 'image/jpeg', 0.92);
            };

            video.addEventListener('seeked', onSeeked);

            // Timeout if seek takes too long
            setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                reject(new Error('Seek timeout'));
            }, 5000);
        });
    }

    function selectFrame(frameElement, frameData) {
        document.querySelectorAll('.frame-item.selected').forEach(el => el.classList.remove('selected'));
        frameElement.classList.add('selected');
        selectedFrameBlob = frameData.blob;
        thumbImage.src = frameData.dataUrl;
        thumbDropContent.style.display = 'none';
        thumbPreview.style.display = 'block';
        thumbInput.value = '';
    }

    function clearFrameSelection() {
        document.querySelectorAll('.frame-item.selected').forEach(el => el.classList.remove('selected'));
        selectedFrameBlob = null;
    }

    // =========================================================
    // === Form Submission - Direct Upload to YouTube API ===
    // =========================================================
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!videoInput.files.length) {
            showResult('error', 'יש לבחור קובץ וידאו.');
            return;
        }

        const videoFile = videoInput.files[0];

        // UI: Show progress
        uploadBtn.disabled = true;
        progressContainer.style.display = 'block';
        resultContainer.style.display = 'none';
        setProgress(0, 'מקבל הרשאות...');

        try {
            // 1. Get access token from our server
            const tokenRes = await fetch('/auth/token');
            const tokenData = await tokenRes.json();
            if (!tokenRes.ok) {
                throw new Error(tokenData.error || 'שגיאה בקבלת הרשאות');
            }
            const accessToken = tokenData.access_token;

            setProgress(2, 'יוצר סשן העלאה...');

            // 2. Build video metadata
            const metadata = buildVideoMetadata();

            // 3. Create resumable upload session
            const uploadUrl = await createResumableUpload(accessToken, metadata);

            setProgress(5, 'מעלה סרטון ל-YouTube...');

            // 4. Upload the file in chunks with progress
            const videoId = await uploadFileResumable(accessToken, uploadUrl, videoFile);

            setProgress(95, 'מגדיר תמונת תצוגה...');

            // 5. Set thumbnail if provided (file input or extracted frame)
            let thumbnailError = null;
            const thumbFile = thumbInput.files[0] || (selectedFrameBlob ? new File([selectedFrameBlob], 'thumbnail.jpg', { type: 'image/jpeg' }) : null);
            if (thumbFile) {
                try {
                    await uploadThumbnail(accessToken, videoId, thumbFile);
                } catch (err) {
                    thumbnailError = err.message;
                }
            }

            setProgress(100, 'הושלם!');

            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            let msg = `<h3>✅ הסרטון הועלה בהצלחה!</h3>
                <p><a href="${videoUrl}" target="_blank">🔗 לצפייה בסרטון</a></p>
                <p style="font-size:0.85rem; color: var(--text-muted);">Video ID: ${videoId}</p>`;

            if (thumbnailError) {
                msg += `<p style="color: var(--yellow); font-size: 0.85rem; margin-top: 0.5rem;">
                    ⚠️ תמונת תצוגה: ${thumbnailError}</p>`;
            }

            showResult('success', msg);

        } catch (err) {
            setProgress(0);
            showResult('error', `<h3>❌ שגיאה</h3><p>${err.message}</p>`);
        } finally {
            uploadBtn.disabled = false;
            if (newUploadBtn) newUploadBtn.style.display = 'inline-flex';
        }
    });

    // =========================================================
    // === YouTube API - Direct Upload Functions ===
    // =========================================================

    /**
     * Build video metadata object from form fields.
     */
    function buildVideoMetadata() {
        const title = document.getElementById('title').value || 'Untitled';
        const description = document.getElementById('description').value || '';
        const tagsRaw = document.getElementById('tags').value || '';
        const categoryId = document.getElementById('category_id').value || '22';
        const privacyStatus = document.getElementById('privacy_status').value || 'private';
        const madeForKids = document.getElementById('made_for_kids').checked;
        const defaultLanguage = document.getElementById('default_language').value || '';
        const license = document.getElementById('license').value || 'youtube';
        const publishAt = document.getElementById('publish_at').value || '';

        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

        const body = {
            snippet: {
                title,
                description,
                categoryId,
            },
            status: {
                privacyStatus,
                selfDeclaredMadeForKids: madeForKids,
            },
        };

        if (tags.length > 0) body.snippet.tags = tags;
        if (defaultLanguage) body.snippet.defaultLanguage = defaultLanguage;
        if (license) body.status.license = license;

        if (publishAt) {
            body.status.privacyStatus = 'private';
            body.status.publishAt = new Date(publishAt).toISOString();
        }

        return body;
    }

    /**
     * Create a resumable upload session on YouTube.
     * Returns the upload URL for sending file data.
     */
    async function createResumableUpload(accessToken, metadata) {
        const response = await fetch(
            'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                },
                body: JSON.stringify(metadata),
            }
        );

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData?.error?.message || `שגיאה ביצירת סשן העלאה (${response.status})`;
            throw new Error(errMsg);
        }

        const uploadUrl = response.headers.get('Location');
        if (!uploadUrl) {
            throw new Error('לא התקבל URL להעלאה מ-YouTube');
        }

        return uploadUrl;
    }

    /**
     * Upload a file to YouTube using resumable upload with progress tracking.
     * Uploads in chunks of 10MB for large files.
     * Returns the video ID.
     */
    async function uploadFileResumable(accessToken, uploadUrl, file) {
        const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

        // For files smaller than 10MB, upload in a single request
        if (file.size <= CHUNK_SIZE) {
            const response = await uploadWithProgress(uploadUrl, accessToken, file, 0, file.size, file.size);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error?.message || 'שגיאה בהעלאת הסרטון');
            }
            return data.id;
        }

        // Chunked upload for large files
        let start = 0;
        let response;

        while (start < file.size) {
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Range': `bytes ${start}-${end - 1}/${file.size}`,
                },
                body: chunk,
            });

            if (response.status === 308) {
                // Chunk accepted, continue
                start = end;
                const percent = 5 + Math.round((start / file.size) * 88); // 5%-93% range
                setProgress(percent, `מעלה סרטון... ${formatFileSize(start)} / ${formatFileSize(file.size)}`);
            } else if (response.ok) {
                // Upload complete
                const data = await response.json();
                return data.id;
            } else {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData?.error?.message || `שגיאה בהעלאת צ'אנק (${response.status})`);
            }
        }

        // After last chunk, response should be 200
        if (response && response.ok) {
            const data = await response.json();
            return data.id;
        }

        throw new Error('העלאה הסתיימה אבל לא התקבל אישור מ-YouTube');
    }

    /**
     * Upload a single file/chunk with XHR for progress tracking (used for small files).
     */
    function uploadWithProgress(uploadUrl, accessToken, blob, start, end, totalSize) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const percent = 5 + Math.round((event.loaded / event.total) * 88);
                    setProgress(percent, `מעלה סרטון... ${formatFileSize(event.loaded)} / ${formatFileSize(totalSize)}`);
                }
            });

            xhr.onload = () => {
                resolve({
                    ok: xhr.status >= 200 && xhr.status < 300,
                    status: xhr.status,
                    json: () => Promise.resolve(JSON.parse(xhr.responseText)),
                    headers: { get: (h) => xhr.getResponseHeader(h) },
                });
            };
            xhr.onerror = () => reject(new Error('שגיאת רשת'));

            xhr.open('PUT', uploadUrl);
            xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
            if (totalSize > 0) {
                xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${totalSize}`);
            }
            xhr.send(blob);
        });
    }

    /**
     * Upload a thumbnail image directly to YouTube API.
     */
    async function uploadThumbnail(accessToken, videoId, thumbFile) {
        const response = await fetch(
            `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': thumbFile.type,
                },
                body: thumbFile,
            }
        );

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error?.message || 'שגיאה בהעלאת תמונת תצוגה');
        }
    }

    // =========================================================
    // === Helper Functions ===
    // =========================================================

    function setupDropZone(zone, input, onFileSelected) {
        if (!zone || !input) return;

        zone.addEventListener('click', () => input.click());

        input.addEventListener('change', () => {
            if (input.files.length > 0) {
                onFileSelected(input.files[0]);
            }
        });

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

    /**
     * Reset the entire form to its initial state for a new upload.
     */
    function resetForm() {
        form.reset();

        // Reset video file
        videoInput.value = '';
        videoDropContent.style.display = 'block';
        videoPreview.style.display = 'none';

        // Reset thumbnail
        thumbInput.value = '';
        thumbDropContent.style.display = 'block';
        thumbPreview.style.display = 'none';
        clearFrameSelection();

        // Hide frames grid
        if (framesGrid) framesGrid.style.display = 'none';
        if (framesList) framesList.innerHTML = '';

        // Reset counters
        if (titleCount) titleCount.textContent = '0';
        if (descCount) descCount.textContent = '0';

        // Restore defaults
        const categorySelect = document.getElementById('category_id');
        if (categorySelect) categorySelect.value = '27';
        const langSelect = document.getElementById('default_language');
        if (langSelect) langSelect.value = 'he';

        // Hide progress and result
        progressContainer.style.display = 'none';
        resultContainer.style.display = 'none';
        if (newUploadBtn) newUploadBtn.style.display = 'none';
        setProgress(0);
        uploadBtn.disabled = false;
    }
});
