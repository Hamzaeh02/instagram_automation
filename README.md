# Instagram Content Automation

Plans 90 days of Instagram Reels content for a niche, generates an AI avatar
video for each post, sends it to you on WhatsApp for review, and — only after
you approve it — publishes it to Instagram automatically on schedule.

```
config/brand.yaml → Strategy Engine (Claude) → 90-day calendar in DB
                                                      │
                        daily orchestrator (cron) picks posts due soon
                                                      │
                              Video Engine (HeyGen + ffmpeg) → mp4
                                                      │
                                  Storage (S3/R2) → public URL
                                                      │
                         WhatsApp review (video + caption + Approve/Reject)
                                                      │
                        approved ──────────────────────────────┐
                        rejected → regenerate with your reason ─┘
                                                      │
                          scheduled date reached → Instagram API publish
                                                      │
                                    WhatsApp confirmation with the live link
```

## 1. Prerequisites / accounts to set up

Do these once, before running anything:

1. **Instagram Business/Creator account** — you already have this. No Facebook Page
   needed: this project uses the newer **Instagram API with Instagram Login**, which
   authenticates directly against your Instagram account.
2. **Meta Developer App** at https://developers.facebook.com/apps
   - Create it as a **Business** app type, with a Business Portfolio attached.
   - Add the use case **"Manage messaging & content on Instagram"** (adds the
     Instagram API product) and **"Connect with customers through WhatsApp"**
     (adds the WhatsApp product).
   - Under the Instagram product's **Permissions and features**, add
     `instagram_business_content_publish` (needed to post) alongside the
     default `instagram_business_basic` / `instagram_business_manage_comments` /
     `instagram_business_manage_messages`.
   - Note your App ID and App Secret (App Settings → Basic) → `META_APP_ID`, `META_APP_SECRET`.
3. **Instagram User ID + Access Token**
   - In the Instagram product's dashboard, go to **Roles** and add your own Instagram
     account as an **Instagram Tester** (then accept the invite from inside Instagram:
     Settings → Apps and websites).
   - Back in the dashboard's **"Generate access tokens"** step, add your Instagram
     account — this runs Business Login for Instagram and gives you an **Instagram
     User Access Token** and your **Instagram User ID** → `INSTAGRAM_ACCESS_TOKEN`,
     `IG_BUSINESS_ACCOUNT_ID`.
   - App Review is **not** required for this — you're only publishing to your own
     account as a tester, not other users' accounts.
4. **WhatsApp Cloud API**
   - From the WhatsApp product in your Meta app: note the `Phone number ID` → `WHATSAPP_PHONE_NUMBER_ID`.
   - Generate a permanent access token (System User token, `whatsapp_business_messaging` scope) → `WHATSAPP_ACCESS_TOKEN`.
   - Add your own phone number as an allowed test recipient (until the app goes through Meta review) → `MY_WHATSAPP_NUMBER` (E.164 format, e.g. `15551234567`).
   - Pick any random string as your webhook verify token → `WHATSAPP_VERIFY_TOKEN`.
5. **LLM provider** for content strategy (scripts, captions, hashtags) — switched with
   `LLM_PROVIDER` in `.env`:
   - **`anthropic` (default)**: `ANTHROPIC_API_KEY`.
   - **`groq`**: `GROQ_API_KEY` (free/low-cost fast inference on open models). Check
     https://console.groq.com/docs/models for current model names and set `GROQ_MODEL`
     if the default doesn't match what's available on your account.
6. **Video engine** — two are built in, switched with `VIDEO_ENGINE` in `.env`:
   - **`broll` (default, free)**: stock footage + AI voiceover + auto-captions.
     Sign up for a free key at https://www.pexels.com/api/ → `PEXELS_API_KEY`.
     Voiceover uses `edge-tts` (free, no key) and captions use `faster-whisper`
     (free, runs locally, downloads its model on first use) — nothing else to set up.
   - **`heygen` (paid, AI avatar)**: set `VIDEO_ENGINE=heygen`, add `HEYGEN_API_KEY`,
     and pick an avatar + voice in HeyGen's dashboard for `heygen_avatar_id` /
     `heygen_voice_id` in `config/brand.yaml`. HeyGen's free tier (3 watermarked
     videos/month) won't cover a multi-post-per-week schedule — budget for a paid plan.
7. **Object storage** (S3 or Cloudflare R2) for hosting generated videos publicly — the
   Instagram Graph API needs a public URL to fetch each video from.
   - Create a bucket, make it publicly readable (or serve via a CDN domain).
   - Fill in `STORAGE_*` variables, including `STORAGE_PUBLIC_BASE_URL` (the base URL
     videos will be reachable at).
8. **A small always-on server + domain with HTTPS** to host the WhatsApp webhook — Meta
   requires HTTPS callback URLs. A $5-6/mo VM (DigitalOcean/Lightsail) plus a subdomain
   and Let's Encrypt cert works well. During local development you can use a tunnel
   (e.g. `ngrok http 8000`) to get a temporary HTTPS URL.
9. **ffmpeg** installed on whatever machine runs video post-processing (must include
   `libass` for caption burn-in, which Homebrew/apt builds include by default):
   `brew install ffmpeg` (mac) or `apt install ffmpeg` (Linux server).

## 2. Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env            # fill in every value from step 1
cp config/brand.example.yaml config/brand.yaml   # fill in your niche/brand

python cli.py init-db
```

## 3. Generate and review the 90-day calendar (no video yet)

Before spending on video generation, sanity-check the plan itself:

```bash
python cli.py plan --days 90
python cli.py show
```

This calls Claude to produce hooks/scripts/captions/hashtags/titles for every
scheduled date and stores them in `data/app.db`. Review the output — if the
niche/tone is off, adjust `config/brand.yaml` and re-run (already-planned
dates are skipped, so re-running only fills gaps).

## 4. Wire up the WhatsApp webhook

In your Meta app's WhatsApp product settings, set the webhook callback URL to
`https://<your-domain>/webhook` with the verify token from `.env`, and
subscribe to the `messages` field.

Run the webhook receiver:

```bash
python scripts/run_webhook.py
```

In production, run it under systemd — see `deploy/webhook.service.example`.

## 5. Run the daily orchestrator

```bash
python cli.py run-once
```

This: tops up the calendar if it's running low, generates video for any post
due within `VIDEO_GEN_LEAD_DAYS`, sends new videos to your WhatsApp for
review, and publishes anything already approved whose scheduled date has
arrived.

Schedule it once a day via cron — see `deploy/crontab.example`.

## 6. Reviewing on WhatsApp

Each new post arrives as a WhatsApp message: the video, its caption/hashtags/
title, and **Approve** / **Reject** buttons.

- **Approve** → the post is locked in and will publish automatically on its
  scheduled date.
- **Reject** → you'll be asked to reply with a reason; the script/video is
  then regenerated incorporating your feedback and sent back for review
  (capped at `MAX_AUTO_RETRIES`, after which it's flagged for manual editing
  instead of auto-retrying forever).

Nothing ever posts to Instagram without an explicit Approve.

## 7. Project layout

| Path | Purpose |
|---|---|
| `config/brand.yaml` | The only file you edit to point the tool at a new niche/brand |
| `strategy/generate_calendar.py`, `strategy/llm.py` | 90-day calendar generation; `llm.py` dispatches to the active `LLM_PROVIDER` |
| `video/generate.py` | Dispatches to the active video engine (`VIDEO_ENGINE`) |
| `video/broll_engine.py`, `video/tts.py`, `video/broll.py`, `video/captions.py`, `video/assemble.py` | Free engine: voiceover (edge-tts) + stock footage (Pexels) + captions (faster-whisper) + ffmpeg assembly |
| `video/heygen_engine.py`, `video/postprocess.py` | Paid engine: HeyGen avatar video + ffmpeg formatting |
| `storage/upload.py` | Uploads videos to S3/R2 for a public URL |
| `review/whatsapp.py`, `review/webhook.py` | WhatsApp send + approve/reject webhook |
| `publish/instagram.py` | Instagram Graph API container/publish flow |
| `orchestrator/daily.py` | Ties it all together; run once a day via cron |
| `db/models.py` | Post status machine and schema |
| `cli.py` | `init-db`, `plan`, `show`, `run-once` commands |

## 8. Before turning on the full 90-day run

Do a small end-to-end dry run first (see the plan's Phase 6): let 2-3 posts
go through the full generate → WhatsApp review → approve → publish cycle and
confirm each stage before letting the daily cron run unattended.
