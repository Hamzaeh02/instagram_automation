# Instagram Content Automation

Plans 90 days of Instagram Reels content for a niche, generates a video for
each post, and — only after you review and approve it in the dashboard —
publishes it to Instagram automatically on schedule.

```
config/brand.yaml → Strategy Engine (Anthropic/Groq) → 90-day calendar in DB
                                                      │
                        daily orchestrator (cron) picks posts due soon
                                                      │
                          Video Engine (broll + AI voiceover, or HeyGen) → mp4
                                                      │
                                  Storage (S3/R2) → public URL
                                                      │
                              Dashboard review (video + caption + Approve/Reject)
                                                      │
                        approved ──────────────────────────────┐
                        rejected → regenerate with your reason ─┘
                                                      │
                          scheduled date reached → Instagram API publish
```

## 1. Prerequisites / accounts to set up

Do these once, before running anything:

1. **Instagram Business/Creator account** — you already have this. No Facebook Page
   needed: this project uses the newer **Instagram API with Instagram Login**, which
   authenticates directly against your Instagram account.
2. **Meta Developer App** at https://developers.facebook.com/apps
   - Create it as a **Business** app type, with a Business Portfolio attached.
   - Add the use case **"Manage messaging & content on Instagram"** (adds the
     Instagram API product).
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
4. **LLM provider** for content strategy (scripts, captions, hashtags) — switched with
   `LLM_PROVIDER` in `.env`:
   - **`anthropic` (default)**: `ANTHROPIC_API_KEY`.
   - **`groq`**: `GROQ_API_KEY` (free/low-cost fast inference on open models). Check
     https://console.groq.com/docs/models for current model names and set `GROQ_MODEL`
     if the default doesn't match what's available on your account.
5. **Video engine** — two are built in, switched with `VIDEO_ENGINE` in `.env`:
   - **`broll` (default, free)**: stock footage + AI voiceover + auto-captions.
     Sign up for a free key at https://www.pexels.com/api/ → `PEXELS_API_KEY`.
     Voiceover uses `edge-tts` (free, no key) and captions use `faster-whisper`
     (free, runs locally, downloads its model on first use) — nothing else to set up.
   - **`heygen` (paid, AI avatar)**: set `VIDEO_ENGINE=heygen`, add `HEYGEN_API_KEY`,
     and pick an avatar + voice in HeyGen's dashboard for `heygen_avatar_id` /
     `heygen_voice_id` in `config/brand.yaml`. HeyGen's free tier (3 watermarked
     videos/month) won't cover a multi-post-per-week schedule — budget for a paid plan.
6. **Object storage** (S3 or Cloudflare R2) for hosting generated videos publicly — the
   Instagram API needs a public URL to fetch each video from.
   - Create a bucket, make it publicly readable (R2: enable the free `r2.dev` subdomain,
     or connect a custom domain).
   - Fill in `STORAGE_*` variables, including `STORAGE_PUBLIC_BASE_URL` (the base URL
     videos will be reachable at).
7. **ffmpeg** installed on whatever machine runs video post-processing (must include
   `libass` for caption burn-in — the plain `ffmpeg` Homebrew formula lacks it, use
   `ffmpeg-full` instead): `brew install ffmpeg-full` (mac) or an equivalent
   libass-enabled build on Linux.

## 2. Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env            # fill in every value from step 1
cp config/brand.example.yaml config/brand.yaml   # fill in your niche/brand,
                                                  # or do this from the dashboard's
                                                  # onboarding flow instead (see below)

python cli.py init-db
```

## 3. The dashboard (recommended way to run this)

```bash
cd dashboard && npm install && npm run build && cd ..
python scripts/run_server.py     # serves the dashboard + API at http://localhost:8000
```

Set `DASHBOARD_PASSWORD` and `SESSION_SECRET` in `.env` first (`SESSION_SECRET` can be
any random string, e.g. `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`).

Open `http://localhost:8000`:
- **First run** walks you through an onboarding wizard that writes `config/brand.yaml`
  for you (niche, audience, tone, content pillars, posting cadence, voice).
- **Settings → Integrations** lets you enter every API key/credential from step 1
  directly in the browser, with a live "Test connection" button per integration —
  no need to hand-edit `.env`.
- **Overview** shows connection status for each integration, upcoming posts, and a
  "Run automation now" button.
- **Calendar** lists every planned/generated/published post.
- **Post detail** is where you review each generated video and its caption/hashtags/
  script — **Approve**, **Reject** (with a reason, which regenerates the post), or
  edit the text directly.

Nothing ever publishes to Instagram without an explicit Approve here.

## 4. Or drive it from the CLI instead

```bash
python cli.py plan --days 90   # generate the 90-day calendar
python cli.py show             # list all planned/generated/posted content
python cli.py run-once         # one orchestrator pass: fill calendar, generate
                                # due videos, publish anything already approved
```

Schedule `run-once` daily via cron — see `deploy/crontab.example`. Review/approve
still happens in the dashboard (or directly against the DB) either way.

## 5. Project layout

| Path | Purpose |
|---|---|
| `config/brand.yaml` | The only file that defines your niche/brand (edit directly, or via the dashboard) |
| `strategy/generate_calendar.py`, `strategy/llm.py` | 90-day calendar generation; `llm.py` dispatches to the active `LLM_PROVIDER` |
| `video/generate.py` | Dispatches to the active video engine (`VIDEO_ENGINE`) |
| `video/broll_engine.py`, `video/tts.py`, `video/broll.py`, `video/captions.py`, `video/assemble.py` | Free engine: voiceover (edge-tts) + stock footage (Pexels) + captions (faster-whisper) + ffmpeg assembly |
| `video/heygen_engine.py`, `video/postprocess.py` | Paid engine: HeyGen avatar video + ffmpeg formatting |
| `storage/upload.py` | Uploads videos to S3/R2 for a public URL |
| `review/actions.py` | Approve/reject state-machine logic, shared by the dashboard API |
| `publish/instagram.py` | Instagram API publish flow |
| `orchestrator/daily.py` | Ties it all together; run once a day via cron or the dashboard's "Run now" |
| `db/models.py` | Post + run-log schema |
| `api/` | Dashboard REST API (FastAPI) — auth, brand profile, posts, credentials, orchestrator triggers |
| `dashboard/` | React dashboard frontend |
| `cli.py` | `init-db`, `plan`, `show`, `run-once` commands |

## 6. Before turning on the full 90-day run

Do a small end-to-end dry run first: let 2-3 posts go through the full generate →
dashboard review → approve → publish cycle and confirm each stage before letting
the daily cron run unattended.
