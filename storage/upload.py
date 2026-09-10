from __future__ import annotations

import os

import boto3

from common.config import settings
from common.logging import get_logger

logger = get_logger(__name__)


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.storage_endpoint_url or None,
        aws_access_key_id=settings.storage_access_key_id,
        aws_secret_access_key=settings.storage_secret_access_key,
        region_name=settings.storage_region,
    )


def check_connection() -> None:
    """Lightweight connectivity check - confirms the bucket is reachable with
    the configured credentials, without uploading anything."""
    if not settings.storage_bucket:
        raise RuntimeError("STORAGE_BUCKET is not set")
    _client().head_bucket(Bucket=settings.storage_bucket)


def upload_video(local_path: str, key: str | None = None) -> str:
    """Upload a video file and return its public URL. Instagram's Graph API
    needs a public URL to fetch the video from when creating a media container."""
    key = key or os.path.basename(local_path)
    s3 = _client()
    logger.info("Uploading %s to bucket %s as %s", local_path, settings.storage_bucket, key)
    s3.upload_file(
        local_path,
        settings.storage_bucket,
        key,
        ExtraArgs={"ContentType": "video/mp4", "ACL": "public-read"},
    )
    base = settings.storage_public_base_url.rstrip("/")
    if not base:
        raise RuntimeError("STORAGE_PUBLIC_BASE_URL is not set; cannot build a public video URL.")
    return f"{base}/{key}"
