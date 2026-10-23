from __future__ import annotations

from html import escape

from common.config import settings

LAST_UPDATED = "October 13, 2026"

_STYLE = """<style>
:root{--bg:#faf9f5;--card:#fff;--text:#211f1a;--muted:#6b6558;--faint:#948d7d;--border:rgba(28,26,20,.1);--primary:#5f8a2c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:"IBM Plex Sans",-apple-system,system-ui,sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
header{border-bottom:1px solid var(--border);background:var(--card)}
.bar{max-width:880px;margin:0 auto;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:17px;color:var(--text);text-decoration:none;display:flex;align-items:center;gap:10px}
.brand span{display:inline-flex;width:28px;height:28px;border-radius:7px;background:var(--primary);color:#fff;align-items:center;justify-content:center;font-size:14px}
nav a{color:var(--muted);text-decoration:none;font-size:14px;margin-left:18px}
nav a.active,nav a:hover{color:var(--primary)}
main{max-width:880px;margin:0 auto;padding:48px 24px 80px}
h1{font-family:"Space Grotesk",sans-serif;font-size:2.2rem;line-height:1.15;margin:0 0 8px;letter-spacing:-.02em}
.updated{color:var(--faint);font-size:14px;margin:0 0 32px}
.intro{font-size:1.05rem;color:var(--muted)}
.toc{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px 24px;margin:32px 0 40px}
.toc strong{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin-bottom:8px}
.toc ol{margin:0;padding-left:20px;columns:2;column-gap:32px}
.toc li{font-size:14px;margin:3px 0;break-inside:avoid}
.toc a{color:var(--text);text-decoration:none}.toc a:hover{color:var(--primary)}
h2{font-family:"Space Grotesk",sans-serif;font-size:1.3rem;margin:44px 0 12px;padding-top:8px;scroll-margin-top:16px}
h3{font-size:1.02rem;margin:24px 0 8px}
p,li{color:#3a372f}
ul{padding-left:22px}li{margin:6px 0}
a{color:var(--primary)}
.callout{background:rgba(95,138,44,.07);border:1px solid rgba(95,138,44,.25);border-radius:10px;padding:16px 20px;margin:20px 0}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top}
th{background:rgba(28,26,20,.03);font-weight:600}
tr:last-child td{border-bottom:none}
footer{border-top:1px solid var(--border);color:var(--faint);font-size:13px;text-align:center;padding:24px}
@media(max-width:640px){h1{font-size:1.7rem}.toc ol{columns:1}nav a{margin-left:12px}th,td{padding:8px 10px}}
</style>"""


def _operator() -> str:
    return escape(settings.legal_operator_name or "Reelmind")


def _contact_html() -> str:
    if settings.legal_contact_email:
        email = escape(settings.legal_contact_email)
        return f'<a href="mailto:{email}">{email}</a>'
    return "the contact details provided to you when you were given access to Reelmind"


def _page(title: str, active: str, body: str) -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} - Reelmind</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
{_STYLE}</head><body>
<header><div class="bar"><a class="brand" href="/"><span>&#9889;</span>Reelmind</a>
<nav><a href="/terms" class="{'active' if active == 'terms' else ''}">Terms</a><a href="/privacy" class="{'active' if active == 'privacy' else ''}">Privacy</a></nav></div></header>
<main>{body}</main>
<footer>&copy; 2026 {_operator()} &middot; <a href="/terms">Terms of Service</a> &middot; <a href="/privacy">Privacy Policy</a></footer>
</body></html>"""


def privacy_html() -> str:
    op = _operator()
    contact = _contact_html()
    body = f"""
<h1>Privacy Policy</h1>
<p class="updated">Last updated: {LAST_UPDATED}</p>
<p class="intro">This Privacy Policy explains what information Reelmind (operated by {op}, "we", "us") collects when you use
our content planning and publishing service, how we use it, who we share it with, and the choices you have - including
how to disconnect your social accounts and delete your data.</p>

<div class="toc"><strong>Contents</strong><ol>
<li><a href="#collect">Information we collect</a></li>
<li><a href="#use">How we use information</a></li>
<li><a href="#platforms">Connected platforms</a></li>
<li><a href="#youtube">YouTube API Services</a></li>
<li><a href="#sharing">Sharing and service providers</a></li>
<li><a href="#cookies">Cookies</a></li>
<li><a href="#retention">Retention and deletion</a></li>
<li><a href="#security">Security</a></li>
<li><a href="#rights">Your rights and choices</a></li>
<li><a href="#children">Children</a></li>
<li><a href="#changes">Changes to this policy</a></li>
<li><a href="#contact">Contact us</a></li>
</ol></div>

<h2 id="collect">1. Information we collect</h2>
<h3>Information you give us</h3>
<ul>
<li><strong>Account information:</strong> your email address and password. Passwords are stored only as a salted hash - we never store or see them in plain text.</li>
<li><strong>Workspace and brand information:</strong> workspace names and the brand details you enter, such as brand name, niche, audience, tone, content themes, topics to avoid, posting frequency, and time zone.</li>
<li><strong>Content and files:</strong> briefs, prompts, and documents you upload to plan content; videos and images you upload; and the scripts, captions, hashtags and media created in Reelmind, including your edits, approvals and rejections.</li>
</ul>
<h3>Information from platforms you connect</h3>
<p>When you choose to connect a social media account, the platform gives us an access token (and, for some platforms, a refresh token) that lets Reelmind act on your behalf within the permissions you approve. Depending on the platform, we also receive:</p>
<ul>
<li>Basic account identifiers, such as your account or channel ID, username, Page name, or channel title.</li>
<li>Audience and performance metrics for your own account, such as follower or subscriber counts, total views, post counts, reach, profile views, and likes, comments, shares and views on posts published through Reelmind.</li>
<li>The ID and link of each post we publish for you, so we can show its status and performance.</li>
</ul>
<p>We never receive or store your passwords for these platforms - you sign in on each platform's own login page.</p>
<h3>Information collected automatically</h3>
<ul>
<li><strong>Activity logs:</strong> records of automation runs (for example, content generation and publishing attempts and their results) so you can see what happened in your account.</li>
<li><strong>Technical data:</strong> standard server logs, such as IP address, browser type, and request times, used for security and troubleshooting.</li>
</ul>

<h2 id="use">2. How we use information</h2>
<p>We use information only to provide and improve the service you signed up for:</p>
<ul>
<li>To create and manage your account and workspaces.</li>
<li>To plan and draft content - including sending your brand details, briefs, and document text to AI providers to generate scripts, captions, and hashtags.</li>
<li>To research and write your posts, and to find stock images for photo posts.</li>
<li>To publish content <strong>you have reviewed and approved</strong> to the accounts you have connected, at the times you schedule.</li>
<li>To show you performance and audience statistics for your own connected accounts in your dashboard.</li>
<li>To keep the service secure, prevent abuse, and fix problems.</li>
</ul>
<p>We do <strong>not</strong> sell your personal information, use it for advertising, or use your connected accounts for anything other than the actions you initiate or schedule.</p>

<h2 id="platforms">3. Connected platforms</h2>
<p>You can connect Instagram, Facebook, LinkedIn, TikTok, X, and YouTube. Each connection is optional, belongs to a single workspace, and can be removed at any time from <strong>Settings &rarr; Integrations</strong>. Your use of each platform is also governed by that platform's own terms and privacy policy:</p>
<table>
<tr><th>Platform</th><th>What Reelmind does</th><th>Platform policies</th></tr>
<tr><td>Instagram &amp; Facebook (Meta)</td><td>Publishes approved posts; reads your profile/Page details, follower counts, and post engagement and insights.</td><td><a href="https://www.facebook.com/privacy/policy/">Meta Privacy Policy</a></td></tr>
<tr><td>YouTube (Google)</td><td>Uploads approved videos; reads your channel details and statistics.</td><td>See <a href="#youtube">section 4</a></td></tr>
<tr><td>TikTok</td><td>Publishes approved posts; reads your basic profile information.</td><td><a href="https://www.tiktok.com/legal/privacy-policy">TikTok Privacy Policy</a></td></tr>
<tr><td>LinkedIn</td><td>Publishes approved posts to your own profile; reads your name and member ID.</td><td><a href="https://www.linkedin.com/legal/privacy-policy">LinkedIn Privacy Policy</a></td></tr>
<tr><td>X</td><td>Publishes approved posts; reads your username, follower counts, and post metrics.</td><td><a href="https://x.com/en/privacy">X Privacy Policy</a></td></tr>
</table>

<h2 id="youtube">4. YouTube API Services</h2>
<div class="callout">Reelmind uses <strong>YouTube API Services</strong>. By connecting a YouTube channel to Reelmind, you agree to be bound by the
<a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>, and your information is also subject to the
<a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</div>
<ul>
<li><strong>What we access:</strong> with the permissions you grant (<em>youtube.upload</em> and <em>youtube.readonly</em>), we upload videos you have approved to your channel and read your channel's ID, title, subscriber count, total view count, and video count, plus view, like, and comment counts for videos uploaded through Reelmind.</li>
<li><strong>How we use it:</strong> only to publish your approved videos and to show you your own channel's statistics in your dashboard. It is shown only to you (and others with access to that workspace in your account).</li>
<li><strong>What we store:</strong> your access and refresh tokens, channel ID, and channel title, plus the ID and link of videos we upload for you. Statistics are fetched live from YouTube when you open your dashboard and are not stored.</li>
<li><strong>Sharing:</strong> we do not share YouTube data with any third party, and we do not use it for advertising.</li>
<li><strong>Revoking access:</strong> you can disconnect YouTube at any time in <strong>Settings &rarr; Integrations</strong>, which immediately deletes your stored YouTube tokens and channel details. You can also revoke Reelmind's access from your Google Account at <a href="https://security.google.com/settings/security/permissions">Google security settings</a>.</li>
</ul>

<h2 id="sharing">5. Sharing and service providers</h2>
<p>We share information only as needed to run the service, with providers that process it on our behalf:</p>
<ul>
<li><strong>Anthropic</strong> (Claude) - receives your brand details, prompts, and document text to research and write your posts.</li>
<li><strong>Media providers</strong> (such as Pexels for stock images) - receive search keywords needed to find media.</li>
<li><strong>Cloud storage and hosting providers</strong> - store media files so they can be published to your accounts.</li>
<li><strong>The social platforms you connect</strong> - receive the content you approve for publishing.</li>
</ul>
<p>We may also disclose information if required by law, to protect the rights, safety, or security of our users or the service, or as part of a merger or sale of the service (in which case this policy would continue to apply to your information).</p>

<h2 id="cookies">6. Cookies</h2>
<p>We use only essential cookies:</p>
<ul>
<li><strong>Session cookie</strong> - keeps you signed in.</li>
<li><strong>Workspace cookie</strong> - remembers which workspace you have open.</li>
</ul>
<p>We do not use advertising or third-party tracking cookies.</p>

<h2 id="retention">7. Retention and deletion</h2>
<ul>
<li>We keep your account information and content for as long as your account exists.</li>
<li><strong>Disconnecting a platform</strong> immediately deletes its stored tokens and account details.</li>
<li><strong>Deleting a workspace</strong> permanently deletes its brand profile, connected accounts, content, and activity logs.</li>
<li><strong>Deleting your account:</strong> contact us at {contact} and we will delete your account and all associated data within 30 days, except where we must keep limited records to meet legal obligations.</li>
<li>Content already published to a social platform stays on that platform until you remove it there.</li>
</ul>

<h2 id="security">8. Security</h2>
<p>We protect your information with measures including encrypted (HTTPS) connections, hashed passwords, signed session cookies, and access controls that keep each workspace's data separate. No system is perfectly secure, so we can't guarantee absolute security, but we work to protect your information and will notify you of any breach as required by law.</p>

<h2 id="rights">9. Your rights and choices</h2>
<p>Depending on where you live, you may have the right to access, correct, export, or delete your personal information, and to object to or restrict certain processing. You can update most information directly in Reelmind, disconnect platforms at any time, and contact us at {contact} for anything else. We will respond within 30 days.</p>

<h2 id="children">10. Children</h2>
<p>Reelmind is not intended for children under 13 (or under 16 where local law requires a higher age), and we do not knowingly collect their information. If you believe a child has given us information, contact us and we will delete it.</p>

<h2 id="changes">11. Changes to this policy</h2>
<p>We may update this policy from time to time. If we make significant changes, we will notify you in the app or by email before they take effect. The "Last updated" date above shows when it last changed.</p>

<h2 id="contact">12. Contact us</h2>
<p>Questions or requests about this policy or your data: {contact}.</p>
"""
    return _page("Privacy Policy", "privacy", body)


def terms_html() -> str:
    op = _operator()
    contact = _contact_html()
    body = f"""
<h1>Terms of Service</h1>
<p class="updated">Last updated: {LAST_UPDATED}</p>
<p class="intro">These Terms of Service ("Terms") govern your use of Reelmind, a content planning, creation, and publishing
service operated by {op} ("we", "us"). By creating an account or using Reelmind, you agree to these Terms and to our
<a href="/privacy">Privacy Policy</a>. If you don't agree, please don't use the service.</p>

<div class="toc"><strong>Contents</strong><ol>
<li><a href="#service">The service</a></li>
<li><a href="#accounts">Accounts and workspaces</a></li>
<li><a href="#platforms">Connected platforms</a></li>
<li><a href="#content">Your content</a></li>
<li><a href="#ai">AI-generated content</a></li>
<li><a href="#acceptable">Acceptable use</a></li>
<li><a href="#third-party">Third-party services</a></li>
<li><a href="#availability">Availability and changes</a></li>
<li><a href="#warranty">Disclaimers</a></li>
<li><a href="#liability">Limitation of liability</a></li>
<li><a href="#termination">Termination</a></li>
<li><a href="#general">General</a></li>
</ol></div>

<h2 id="service">1. The service</h2>
<p>Reelmind helps you plan, create, and publish social media content. You can describe your brand, generate a content calendar with AI-written scripts, captions, and hashtags, produce or upload videos and images, review and approve each post, and publish approved posts to social accounts you connect. Reelmind also shows performance statistics for your connected accounts.</p>

<h2 id="accounts">2. Accounts and workspaces</h2>
<ul>
<li>You must give accurate information when you sign up and keep your password secure. You are responsible for all activity under your account.</li>
<li>You must be at least 13 years old (or the minimum age required in your country) and able to form a binding contract.</li>
<li>Workspaces let you keep separate brands apart. If you manage a brand or social account on behalf of someone else, you confirm that you have their permission to do so.</li>
<li>Tell us promptly at {contact} if you believe your account has been accessed without permission.</li>
</ul>

<h2 id="platforms">3. Connected platforms</h2>
<p>When you connect a social media account (Instagram, Facebook, LinkedIn, TikTok, X, or YouTube), you authorize Reelmind to publish content <strong>you have approved</strong> to that account at the times you schedule, and to read account and performance information as described in our <a href="/privacy">Privacy Policy</a>. You can disconnect any account at any time in Settings.</p>
<p>You must have the right to use each account you connect, and your use of each platform remains subject to that platform's own terms, including the
<a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>,
<a href="https://www.facebook.com/terms.php">Meta Terms of Service</a>,
<a href="https://help.instagram.com/581066165581870">Instagram Terms of Use</a>,
<a href="https://www.tiktok.com/legal/terms-of-service">TikTok Terms of Service</a>,
<a href="https://www.linkedin.com/legal/user-agreement">LinkedIn User Agreement</a>, and
<a href="https://x.com/en/tos">X Terms of Service</a>.
Reelmind's use of YouTube is provided through YouTube API Services - by connecting YouTube you agree to the YouTube Terms of Service.</p>

<h2 id="content">4. Your content</h2>
<ul>
<li><strong>You own your content.</strong> This includes the brand information, briefs, documents, and media you upload, and the content generated for you in Reelmind.</li>
<li>You give us a limited license to store, process, and transmit your content only as needed to operate the service - for example, to generate drafts, produce media, and publish to your connected accounts.</li>
<li>You are responsible for making sure you have the rights to everything you upload or publish, including music, footage, images, logos, and other people's likenesses.</li>
</ul>

<h2 id="ai">5. AI-generated content</h2>
<p>Reelmind uses AI to draft scripts, captions, hashtags, and content plans. AI output can be inaccurate, incomplete, or similar to content created for others. <strong>Nothing is published until you approve it</strong>, and you are responsible for reviewing content before approving it - including checking facts, claims, and compliance with advertising and disclosure rules that apply to you.</p>

<h2 id="acceptable">6. Acceptable use</h2>
<p>You agree not to use Reelmind to:</p>
<ul>
<li>Publish content that is illegal, misleading, defamatory, hateful, harassing, sexually explicit, or that infringes anyone's rights.</li>
<li>Send spam, manipulate engagement, or violate any connected platform's rules or community guidelines.</li>
<li>Impersonate any person or organization, or post to accounts you aren't authorized to use.</li>
<li>Interfere with, reverse engineer, or try to gain unauthorized access to Reelmind or its systems.</li>
<li>Use the service in a way that could damage, overload, or impair it.</li>
</ul>
<p>We may remove content or suspend accounts that break these rules.</p>

<h2 id="third-party">7. Third-party services</h2>
<p>Reelmind relies on third-party services - social platforms, AI providers, stock media, and hosting. We aren't responsible for their availability or actions. If a platform changes or limits its API, rejects a post, or restricts your account, some features may stop working. For example, YouTube may keep uploads private until our API project completes YouTube's audit, and TikTok may limit post visibility until our app is approved.</p>

<h2 id="availability">8. Availability and changes</h2>
<p>We work to keep Reelmind running reliably, but we don't guarantee it will always be available or error-free, or that scheduled posts will always publish at the exact time. We may add, change, or remove features. We may update these Terms; if the changes are significant, we'll notify you before they take effect, and continuing to use Reelmind after that means you accept them.</p>

<h2 id="warranty">9. Disclaimers</h2>
<p>Reelmind is provided "as is" and "as available", without warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement, to the extent the law allows. We don't guarantee any particular results, such as reach, engagement, or follower growth.</p>

<h2 id="liability">10. Limitation of liability</h2>
<p>To the extent the law allows, {op} will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenue, data, or goodwill, arising from your use of Reelmind. Our total liability for any claim relating to the service is limited to the amount you paid us for Reelmind in the 12 months before the claim. Nothing in these Terms limits liability that can't be limited under applicable law.</p>

<h2 id="termination">11. Termination</h2>
<p>You can stop using Reelmind at any time and ask us to delete your account at {contact}. We may suspend or end your access if you break these Terms or if required by law. When your account ends, we delete your data as described in our <a href="/privacy">Privacy Policy</a>; content already published to social platforms stays there until you remove it.</p>

<h2 id="general">12. General</h2>
<p>These Terms, together with our Privacy Policy, are the entire agreement between you and us about Reelmind. If any part of these Terms is found unenforceable, the rest still applies. If we don't enforce a provision right away, we haven't waived it. Questions about these Terms: {contact}.</p>
"""
    return _page("Terms of Service", "terms", body)
