export type PostStatus =
  | "planned"
  | "video_generating"
  | "pending_review"
  | "rejected_pending_reason"
  | "approved"
  | "needs_manual_edit"
  | "publishing"
  | "posted"
  | "failed"

export interface Post {
  id: number
  scheduled_date: string
  pillar: string
  hook: string
  video_concept: string
  script: string
  on_screen_text: string
  caption: string
  hashtags: string
  title: string
  broll_keywords: string
  status: PostStatus
  retry_count: number
  reject_reason: string
  error_message: string
  has_video: boolean
  video_url: string
  ig_permalink: string
  created_at: string
  updated_at: string
}

export interface BrandProfile {
  brand_name: string
  niche: string
  audience: string
  tone: string
  content_pillars: string[]
  banned_topics: string[]
  posting_cadence_per_week: number
  cta_style: string
  hashtag_style: string
  tts_voice: string
  heygen_avatar_id: string
  heygen_voice_id: string
  timezone: string
}

export interface CredentialField {
  name: string
  label: string
  secret: boolean
  configured: boolean
  value: string
}

export type CredentialGroups = Record<string, CredentialField[]>

export interface RunLogEntry {
  id: number
  started_at: string
  finished_at: string | null
  status: "running" | "ok" | "error"
  summary: string
  error: string
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  planned: "Planned",
  video_generating: "Generating video",
  pending_review: "Pending review",
  rejected_pending_reason: "Awaiting reason",
  approved: "Approved",
  needs_manual_edit: "Needs manual edit",
  publishing: "Publishing",
  posted: "Posted",
  failed: "Failed",
}

export const STATUS_COLOR: Record<PostStatus, string> = {
  planned: "slate",
  video_generating: "amber",
  pending_review: "info",
  rejected_pending_reason: "amber",
  approved: "success",
  needs_manual_edit: "danger",
  publishing: "info",
  posted: "success",
  failed: "danger",
}
