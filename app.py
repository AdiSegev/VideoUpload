"""
Flask application - YouTube Video Upload System.
Main server with routes for auth, upload, and serving the frontend.
"""

import os
import json
import threading
from flask import Flask, render_template, request, redirect, jsonify, session
from werkzeug.utils import secure_filename

import auth
import uploader
import config

app = Flask(__name__)
app.secret_key = config.SECRET_KEY

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Store upload progress per session
upload_progress = {}


@app.route("/")
def index():
    """Serve the main upload page."""
    is_auth = auth.is_authenticated()
    categories = uploader.get_categories()
    return render_template("index.html", authenticated=is_auth, categories=categories)


@app.route("/auth")
def start_auth():
    """Start the OAuth2 flow."""
    auth_url, state = auth.get_auth_url()
    session["oauth_state"] = state
    return redirect(auth_url)


@app.route("/auth/callback")
def auth_callback():
    """Handle the OAuth2 callback."""
    try:
        state = session.get("oauth_state")
        auth.handle_callback(request.url, state=state)
        return redirect("/")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/auth/status")
def auth_status():
    """Check if user is authenticated."""
    return jsonify({"authenticated": auth.is_authenticated()})


@app.route("/auth/logout")
def logout():
    """Logout and remove saved credentials."""
    auth.logout()
    return redirect("/")


@app.route("/upload", methods=["POST"])
def upload_video():
    """Handle video upload to YouTube."""
    credentials = auth.get_credentials()
    if not credentials:
        return jsonify({"error": "לא מחובר. יש להתחבר קודם ל-Google."}), 401

    # Get the video file
    if "video" not in request.files:
        return jsonify({"error": "לא נבחר קובץ וידאו."}), 400

    video_file = request.files["video"]
    if video_file.filename == "":
        return jsonify({"error": "לא נבחר קובץ וידאו."}), 400

    # Save video temporarily
    video_filename = secure_filename(video_file.filename)
    video_path = os.path.join(UPLOAD_FOLDER, video_filename)
    video_file.save(video_path)

    # Save thumbnail temporarily (if provided)
    thumbnail_path = None
    if "thumbnail" in request.files:
        thumb_file = request.files["thumbnail"]
        if thumb_file.filename != "":
            thumb_filename = secure_filename(thumb_file.filename)
            thumbnail_path = os.path.join(UPLOAD_FOLDER, thumb_filename)
            thumb_file.save(thumbnail_path)

    # Use selected frame as thumbnail if no file was uploaded
    selected_frame = request.form.get("selected_frame_path", "")
    if not thumbnail_path and selected_frame and os.path.exists(selected_frame):
        thumbnail_path = selected_frame

    # Build metadata
    metadata = {
        "title": request.form.get("title", "Untitled"),
        "description": request.form.get("description", ""),
        "tags": request.form.get("tags", ""),
        "category_id": request.form.get("category_id", "22"),
        "privacy_status": request.form.get("privacy_status", "private"),
        "made_for_kids": request.form.get("made_for_kids") == "true",
        "default_language": request.form.get("default_language", ""),
        "license": request.form.get("license", "youtube"),
    }

    publish_at = request.form.get("publish_at", "")
    if publish_at:
        metadata["publish_at"] = publish_at

    # Upload with progress tracking
    upload_id = video_filename
    upload_progress[upload_id] = 0

    def progress_callback(percent):
        upload_progress[upload_id] = percent

    try:
        result = uploader.upload_video(
            credentials, video_path, metadata, progress_callback
        )
        upload_progress[upload_id] = 100

        # Set thumbnail if provided
        if thumbnail_path:
            try:
                uploader.set_thumbnail(credentials, result["video_id"], thumbnail_path)
            except Exception as e:
                result["thumbnail_error"] = str(e)

        # Cleanup temp files
        _cleanup_file(video_path)
        if thumbnail_path:
            _cleanup_file(thumbnail_path)

        return jsonify({
            "success": True,
            "video_id": result["video_id"],
            "video_url": result["video_url"],
            "thumbnail_error": result.get("thumbnail_error"),
        })

    except Exception as e:
        _cleanup_file(video_path)
        if thumbnail_path:
            _cleanup_file(thumbnail_path)
        return jsonify({"error": str(e)}), 500

    finally:
        upload_progress.pop(upload_id, None)


@app.route("/upload/progress/<upload_id>")
def get_progress(upload_id):
    """Get the current upload progress."""
    progress = upload_progress.get(upload_id, -1)
    return jsonify({"progress": progress})


@app.route("/extract-frames", methods=["POST"])
def extract_frames():
    """Extract 5 evenly-spaced frames from an uploaded video."""
    import cv2
    import uuid
    import glob

    if "video" not in request.files:
        return jsonify({"error": "לא נבחר קובץ וידאו."}), 400

    video_file = request.files["video"]
    if video_file.filename == "":
        return jsonify({"error": "לא נבחר קובץ וידאו."}), 400

    # Save video temporarily
    video_filename = secure_filename(video_file.filename)
    video_path = os.path.join(UPLOAD_FOLDER, f"temp_{video_filename}")
    video_file.save(video_path)

    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return jsonify({"error": "לא ניתן לפתוח את קובץ הוידאו."}), 400

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)

        if total_frames <= 0:
            cap.release()
            return jsonify({"error": "לא ניתן לקרוא פריימים מהוידאו."}), 400

        # Clean old extracted frames
        frames_dir = os.path.join(UPLOAD_FOLDER, "frames")
        if os.path.exists(frames_dir):
            for old_file in glob.glob(os.path.join(frames_dir, "*.jpg")):
                _cleanup_file(old_file)
        os.makedirs(frames_dir, exist_ok=True)

        # Extract 5 frames at evenly spaced intervals (skip first/last 10%)
        start = int(total_frames * 0.1)
        end = int(total_frames * 0.9)
        step = (end - start) // 4  # 5 frames = 4 intervals
        frame_positions = [start + i * step for i in range(5)]

        batch_id = uuid.uuid4().hex[:8]
        frame_urls = []

        for idx, pos in enumerate(frame_positions):
            cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
            ret, frame = cap.read()
            if ret:
                timestamp = pos / fps if fps > 0 else 0
                frame_filename = f"{batch_id}_frame_{idx}.jpg"
                frame_path = os.path.join(frames_dir, frame_filename)
                cv2.imwrite(frame_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
                frame_urls.append({
                    "url": f"/frames/{frame_filename}",
                    "path": frame_path,
                    "timestamp": round(timestamp, 1),
                    "index": idx,
                })

        cap.release()
        _cleanup_file(video_path)

        return jsonify({"success": True, "frames": frame_urls})

    except Exception as e:
        _cleanup_file(video_path)
        return jsonify({"error": str(e)}), 500


@app.route("/frames/<filename>")
def serve_frame(filename):
    """Serve an extracted frame image."""
    from flask import send_from_directory
    frames_dir = os.path.join(UPLOAD_FOLDER, "frames")
    return send_from_directory(frames_dir, filename)


def _cleanup_file(path):
    """Safely remove a temporary file."""
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


if __name__ == "__main__":
    # Allow HTTP for local OAuth (development only)
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    print("\n🎬 YouTube Video Uploader")
    print("=" * 40)
    print("📍 http://localhost:5000")
    print("=" * 40 + "\n")
    app.run(debug=True, port=5000)
