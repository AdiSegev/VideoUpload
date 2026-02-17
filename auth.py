"""
OAuth 2.0 Authentication module for YouTube API.
Handles the full OAuth flow and token management.
"""

import os
import json
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

import config

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]


def _create_flow(state=None):
    """Create an OAuth2 flow using the appropriate config source."""
    client_config = config.get_client_config()

    if isinstance(client_config, str):
        # Local: it's a filename
        return Flow.from_client_secrets_file(
            client_config,
            scopes=SCOPES,
            redirect_uri=config.REDIRECT_URI,
            state=state,
        )
    else:
        # Production: it's a dict
        return Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            redirect_uri=config.REDIRECT_URI,
            state=state,
        )


def get_auth_url():
    """Generate the OAuth2 authorization URL."""
    flow = _create_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return auth_url, state


def handle_callback(authorization_response, state=None):
    """Exchange the authorization code for credentials and save them."""
    flow = _create_flow(state=state)
    flow.fetch_token(authorization_response=authorization_response)
    credentials = flow.credentials
    _save_credentials(credentials)
    return credentials


def get_credentials():
    """Load saved credentials or return None if not available."""
    token_data = config.load_token_data()
    if not token_data:
        return None

    try:
        credentials = Credentials.from_authorized_user_info(token_data, SCOPES)
    except Exception:
        return None

    if credentials and credentials.expired and credentials.refresh_token:
        try:
            credentials.refresh(Request())
            _save_credentials(credentials)
        except Exception:
            return None

    if credentials and credentials.valid:
        return credentials

    return None


def _save_credentials(credentials):
    """Save credentials for reuse."""
    token_data = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": credentials.scopes and list(credentials.scopes),
    }
    config.save_token_data(token_data)


def is_authenticated():
    """Check if we have valid credentials."""
    creds = get_credentials()
    return creds is not None and creds.valid


def logout():
    """Remove saved credentials."""
    if os.path.exists(config.TOKEN_FILE):
        os.remove(config.TOKEN_FILE)
