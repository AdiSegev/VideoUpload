"""
YouTube Video Uploader module.
Handles video upload, thumbnail setting, and all metadata.
"""

import os
import httplib2
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

# YouTube video categories (common ones)
CATEGORIES = {
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


def get_youtube_service(credentials):
    """Build and return a YouTube API service object."""
    return build("youtube", "v3", credentials=credentials)


def upload_video(credentials, video_path, metadata, progress_callback=None):
    """
    Upload a video to YouTube with the given metadata.

    Args:
        credentials: OAuth2 credentials
        video_path: Path to the video file
        metadata: Dict with video metadata:
            - title (str): Video title
            - description (str): Video description
            - tags (list): List of tags
            - category_id (str): Category ID
            - privacy_status (str): public/private/unlisted
            - publish_at (str): ISO 8601 datetime for scheduled publishing
            - made_for_kids (bool): Whether the video is made for kids
            - default_language (str): Default language code
            - license (str): youtube or creativeCommon
        progress_callback: Optional callback function(progress_percent)

    Returns:
        dict with video_id and video_url on success
    """
    youtube = get_youtube_service(credentials)

    # Build the request body
    body = {
        "snippet": {
            "title": metadata.get("title", "Untitled"),
            "description": metadata.get("description", ""),
            "categoryId": metadata.get("category_id", "22"),
        },
        "status": {
            "privacyStatus": metadata.get("privacy_status", "private"),
            "selfDeclaredMadeForKids": metadata.get("made_for_kids", False),
        },
    }

    # Optional snippet fields
    tags = metadata.get("tags")
    if tags:
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        body["snippet"]["tags"] = tags

    language = metadata.get("default_language")
    if language:
        body["snippet"]["defaultLanguage"] = language

    # Optional status fields
    publish_at = metadata.get("publish_at")
    if publish_at:
        body["status"]["privacyStatus"] = "private"
        body["status"]["publishAt"] = publish_at

    license_type = metadata.get("license")
    if license_type:
        body["status"]["license"] = license_type

    # Create the media upload object
    media = MediaFileUpload(
        video_path,
        mimetype="video/*",
        resumable=True,
        chunksize=10 * 1024 * 1024,  # 10MB chunks
    )

    # Execute the upload
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media,
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status and progress_callback:
            progress_callback(int(status.progress() * 100))

    video_id = response["id"]
    return {
        "video_id": video_id,
        "video_url": f"https://www.youtube.com/watch?v={video_id}",
        "response": response,
    }


def set_thumbnail(credentials, video_id, thumbnail_path):
    """
    Set a custom thumbnail for a video.

    Args:
        credentials: OAuth2 credentials
        video_id: YouTube video ID
        thumbnail_path: Path to the thumbnail image (JPEG/PNG, max 2MB)

    Returns:
        API response
    """
    youtube = get_youtube_service(credentials)

    media = MediaFileUpload(
        thumbnail_path,
        mimetype="image/jpeg" if thumbnail_path.lower().endswith(".jpg") or thumbnail_path.lower().endswith(".jpeg") else "image/png",
        resumable=False,
    )

    response = youtube.thumbnails().set(
        videoId=video_id,
        media_body=media,
    ).execute()

    return response


def get_categories():
    """Return available YouTube video categories."""
    return CATEGORIES
