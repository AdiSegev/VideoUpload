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



if __name__ == "__main__":
    # Allow HTTP for local OAuth (development only)
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    print("\n🎬 YouTube Video Uploader")
    print("=" * 40)
    print("📍 http://localhost:5000")
    print("=" * 40 + "\n")
    app.run(debug=True, port=5000)

