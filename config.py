"""
Configuration module.
Auto-detects local vs production (Render) environment.
"""

import os
import json

# Render sets RENDER=true automatically
IS_PRODUCTION = os.environ.get("RENDER") is not None

# --- Secret Key ---
if IS_PRODUCTION:
    SECRET_KEY = os.environ.get("SECRET_KEY", "fallback-change-me")
else:
    SECRET_KEY = os.urandom(24)

# --- OAuth Redirect URI ---
if IS_PRODUCTION:
    REDIRECT_URI = os.environ.get("REDIRECT_URI", "https://videoupload-t3vi.onrender.com/auth/callback")
else:
    REDIRECT_URI = "http://localhost:5000/auth/callback"

# --- Token Storage ---
TOKEN_FILE = "token.json"


def get_client_config():
    """
    Return OAuth client config.
    - Production: from GOOGLE_CLIENT_SECRET env var (JSON string)
    - Local: from client_secret*.json file
    """
    if IS_PRODUCTION:
        secret_json = os.environ.get("GOOGLE_CLIENT_SECRET")
        if not secret_json:
            raise ValueError("GOOGLE_CLIENT_SECRET env var is not set.")
        return json.loads(secret_json)
    else:
        # Find client_secret*.json file locally
        for f in os.listdir("."):
            if f.startswith("client_secret") and f.endswith(".json"):
                return f  # Return filename for file-based flow
        raise FileNotFoundError(
            "לא נמצא קובץ client_secret*.json בתיקיית הפרויקט. "
            "הורד אותו מ-Google Cloud Console."
        )


def save_token_data(token_data):
    """Save token data to file (works in both environments)."""
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)


def load_token_data():
    """Load token data from file, or return None."""
    if not os.path.exists(TOKEN_FILE):
        return None
    try:
        with open(TOKEN_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return None
