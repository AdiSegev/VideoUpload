"""
Flask application - YouTube Video Upload System.
Main server with routes for auth and serving the frontend.
Video upload and frame extraction happen client-side.
"""

import os
from flask import Flask, render_template, request, redirect, jsonify, session

import auth
import config

app = Flask(__name__)
app.secret_key = config.SECRET_KEY


@app.route("/")
def index():
    """Serve the main upload page."""
    is_auth = auth.is_authenticated()
    categories = {
        "1": "Film & Animation",
        "2": "Autos & Vehicles",
        "10": "Music",
        "15": "Pets & Animals",
        "17": "Sports",
        "19": "Travel & Events",
        "20": "Gaming",
        "22": "People & Blogs",
        "23": "Comedy",
        "24": "Entertainment",
        "25": "News & Politics",
        "26": "Howto & Style",
        "27": "Education",
        "28": "Science & Technology",
        "29": "Nonprofits & Activism",
    }
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


@app.route("/auth/token")
def get_token():
    """Return access token for client-side YouTube upload."""
    token = auth.get_access_token()
    if not token:
        return jsonify({"error": "לא מחובר. יש להתחבר קודם ל-Google."}), 401
    return jsonify({"access_token": token})


@app.route("/auth/logout")
def logout():
    """Logout and remove saved credentials."""
    auth.logout()
    return redirect("/")


@app.route("/api/create-upload", methods=["POST"])
def create_upload_session():
    """
    Proxy: Create a resumable upload session on YouTube.
    Receives video metadata JSON, returns the upload URL.
    This avoids CORS issues with the YouTube API.
    """
    import requests as http_requests

    token = auth.get_access_token()
    if not token:
        return jsonify({"error": "לא מחובר. יש להתחבר קודם ל-Google."}), 401

    metadata = request.get_json()
    if not metadata:
        return jsonify({"error": "חסר metadata."}), 400

    try:
        # Forward the browser's Origin so YouTube enables CORS on the upload URL
        browser_origin = request.headers.get("Origin", "")

        resp = http_requests.post(
            "https://www.googleapis.com/upload/youtube/v3/videos",
            params={"uploadType": "resumable", "part": "snippet,status"},
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "video/*",
                "Origin": browser_origin,
            },
            json=metadata,
        )

        if resp.status_code != 200:
            error_msg = resp.json().get("error", {}).get("message", f"שגיאה ({resp.status_code})")
            return jsonify({"error": error_msg}), resp.status_code

        upload_url = resp.headers.get("Location")
        if not upload_url:
            return jsonify({"error": "לא התקבל URL להעלאה מ-YouTube."}), 500

        return jsonify({"upload_url": upload_url, "access_token": token})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/set-thumbnail", methods=["POST"])
def set_thumbnail():
    """
    Proxy: Upload a thumbnail image to YouTube.
    Small file (max 2MB), no timeout risk.
    """
    import requests as http_requests

    token = auth.get_access_token()
    if not token:
        return jsonify({"error": "לא מחובר. יש להתחבר קודם ל-Google."}), 401

    video_id = request.args.get("videoId")
    if not video_id:
        return jsonify({"error": "חסר videoId."}), 400

    if "thumbnail" not in request.files:
        return jsonify({"error": "חסר קובץ thumbnail."}), 400

    thumb_file = request.files["thumbnail"]

    import time
    from google.auth.transport.requests import Request

    try:
        content = thumb_file.read()
        content_type = thumb_file.content_type or "image/jpeg"

        # A freshly uploaded video is not immediately available, and YouTube
        # answers thumbnails.set on it with 401/404/5xx. Retry with backoff.
        delays = [0, 3, 5, 8, 12, 15]
        resp = None
        for i, delay in enumerate(delays):
            if delay:
                time.sleep(delay)

            # Force a fresh token on retries after an auth error
            if i > 0 and resp is not None and resp.status_code == 401:
                creds = auth.get_credentials()
                if creds and creds.refresh_token:
                    try:
                        creds.refresh(Request())
                        auth._save_credentials(creds)
                        token = creds.token
                    except Exception as refresh_err:
                        app.logger.warning("Token refresh failed: %s", refresh_err)

            resp = http_requests.post(
                "https://www.googleapis.com/upload/youtube/v3/thumbnails/set",
                params={"videoId": video_id, "uploadType": "media"},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": content_type,
                },
                data=content,
                timeout=30,
            )
            if resp.ok:
                return jsonify({"success": True})

            app.logger.warning(
                "thumbnails.set attempt %d failed (%d): %s",
                i + 1, resp.status_code, resp.text[:500],
            )
            if resp.status_code not in (401, 404, 409, 500, 502, 503):
                break

        try:
            error_msg = resp.json().get("error", {}).get("message")
        except Exception:
            error_msg = None
        error_msg = error_msg or f"שגיאה ({resp.status_code})"
        # Don't return 401 to the browser - the user IS logged in
        return jsonify({"error": error_msg}), 502

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Allow HTTP for local OAuth (development only)
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    print("\n🎬 YouTube Video Uploader")
    print("=" * 40)
    print("📍 http://localhost:5000")
    print("=" * 40 + "\n")
    app.run(debug=True, port=5000)

