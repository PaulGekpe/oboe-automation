# Oboe Daily Lesson Bot

Fully automated daily learning: 2 topics a day, a browser bot that logs
into Oboe and actually reads Oboe's questions to pick genuine answers
(via Claude Haiku), a daily "what you learned" summary email, and a
failure alert if any run breaks. No clicking required once it's set up.

**Three moving parts:**
- `apps-script/Code.gs` — the "brain." Runs daily in Google Apps Script,
  picks 2 topics from a curated list, pings GitHub Actions to go run
  them, and emails you either a failure alert or a summary of what was
  covered, depending on what GitHub Actions reports back.
- `playwright/` — the "hands." A headless-browser bot (runs on GitHub's
  servers via Actions) that logs into Oboe, runs both lessons, and — for
  each question or multiple-choice prompt Oboe shows — calls Claude
  Haiku with the real on-screen text to pick a genuinely relevant
  answer, rather than guessing randomly.
- A small alert/summary loop: after each run, GitHub Actions calls back
  to your Apps Script (deployed as a tiny web app), which emails you via
  your own Gmail — no separate email service needed.

These instructions assume **Windows** — commands below are for
PowerShell. Before relying on this daily, skim Oboe's Terms of Service
for anything about automated/bot access — most consumer apps restrict
it, and I couldn't find a published ToS page to check for you.

---

## Prerequisites

- **Node.js** installed (nodejs.org — get the LTS installer, it includes npm).
- **Git for Windows** (git-scm.com) if you don't already have git.
- A GitHub account and a Google account.

---

## Setup

### 1. Create the GitHub repo
Create a new **private** repo (e.g. `oboe-automation`) on github.com.
Then, in PowerShell, from the folder containing these files:
```powershell
cd path\to\oboe-automation
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/oboe-automation.git
git push -u origin main
```
Private matters — this repo's Actions logs/screenshots could reveal your
lesson content, and its config references secrets.

### 2. Capture your Oboe login session (on your own PC, not GitHub)
```powershell
cd playwright
npm install
node save-session.js
```
A browser window opens. Log into Oboe normally (handle any 2FA). Once
you're on your home screen, go back to the PowerShell window and press
Enter. This creates `storageState.json` — **never commit this file**,
it's equivalent to your password (it's already excluded via `.gitignore`
if you keep the one included here).

Base64-encode it and copy the result to your clipboard:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("storageState.json")) | Set-Clipboard
```

### 3. Deploy the Apps Script "brain" and get its web app URL
- Go to script.google.com > New project. Paste in `apps-script/Code.gs`.
- **Project Settings (gear icon) > Script Properties**, add:
  - `GITHUB_TOKEN` — a fine-grained GitHub Personal Access Token
    (github.com/settings/tokens, "Fine-grained tokens") scoped only to
    this repo, with **Contents: Read** and **Actions: Read and write**
  - `GITHUB_REPO` — e.g. `YOUR-USERNAME/oboe-automation`
  - `ALERT_EMAIL` — the email address you want alerts/summaries sent to
  - `WEBHOOK_SECRET` — make up any random string, e.g. a UUID; you'll
    reuse this exact value in a GitHub secret in step 4
- Topics come from the hand-written `TOPIC_LIST` near the top of
  `Code.gs` — edit that list to add, remove, or reorder topics.
  **Recommended: 2 topics/day via two separate single-topic runs**
  (morning + afternoon) rather than both in one job — see step 6.
- **Deploy > New deployment > type "Web app"** — set "Execute as: Me"
  and "Who has access: Anyone." Click Deploy, authorize the requested
  permissions, and copy the **Web app URL** it gives you (looks like
  `https://script.google.com/macros/s/AKfycb.../exec`). You'll need this
  in step 4. (The URL is only useful to someone who also has your
  `WEBHOOK_SECRET`, so it's safe to leave access as "Anyone.")

### 4. Add GitHub secrets
In your repo: **Settings > Secrets and variables > Actions > New repository secret**. Add:
- `OBOE_STORAGE_STATE_B64` — the base64 string from step 2
- `APPS_SCRIPT_WEBHOOK_URL` — the web app URL from step 3
- `WEBHOOK_SECRET` — the exact same random string you put in Apps Script's `WEBHOOK_SECRET` property
- `ANTHROPIC_API_KEY` — the key you created at console.anthropic.com. Without
  this secret the bot still works, it just falls back to random chip
  picks and generic replies instead of AI-chosen answers — so it's worth
  double-checking this one's set correctly.

### 5. Test the bot manually before automating it
In your repo: **Actions tab > Daily Oboe Lesson > Run workflow**. The
default `topicsJson` input already has one test topic filled in — leave
it as a single topic for testing (real lessons now run 15-30+
interactive rounds, so testing with 2 topics at once will take a while
and risks the 30-minute job timeout — that's exactly the problem the
twice-daily setup in step 6 avoids).

Run it, then check the uploaded `run-output` artifact (screenshots +
log) to confirm each step worked — including whether the log shows
"AI-selected" / "AI-written" (means `ANTHROPIC_API_KEY` is working) or
"randomly picked" / "generic" (means it silently fell back — check the
secret's spelled and pasted correctly).

Oboe's real page structure may differ slightly from the selectors in
`playwright/run-lesson.js` — if a step fails, the error screenshot will
show you exactly where, and the `SELECTORS` object near the top of that
file is where to fix it (on oboe.com, right-click the relevant box >
Inspect > copy a stable selector like a class name or `data-testid`).

**Also test the alert path on purpose once:** temporarily break something
(e.g. set `OBOE_STORAGE_STATE_B64` to garbage) and re-run the workflow.
You should get exactly one failure email within a minute or two. Then put
the real value back. A successful run should land you exactly one ✅
summary email once it finishes — never both from the same run.

### 6. Wire up the twice-daily schedule
Back in the Apps Script editor, run `generateAndDispatchOneTopic` once
manually (▶ button, pick that function) to test the full chain
end-to-end — check Apps Script's **Executions** log, then your repo's
**Actions** tab. Once that works, run `createTwiceDailyTriggers` once —
this schedules two runs a day (8am and 2pm in your script's timezone),
each picking and completing one topic. This replaces the older
`createDailyTrigger` / `generateAndDispatchTopics` (two-topics-in-one-run)
approach — `createTwiceDailyTriggers` clears any existing triggers
first, so you don't need to manually remove the old one.

---

## Ongoing maintenance
- **Oboe sessions expire eventually.** When that happens you'll get a
  failure email saying "Session appears expired." Redo step 2 and update
  the `OBOE_STORAGE_STATE_B64` secret (Settings > Secrets > Actions >
  update the existing one).
- **If Oboe updates their UI**, a step may start failing — the failure
  email links straight to the run, whose uploaded screenshot will show
  where things broke; adjust `SELECTORS` in `run-lesson.js` accordingly.
- **If you ever want to pause it**, delete the trigger: in the Apps
  Script editor, run `ScriptApp.getProjectTriggers().forEach(t =>
  ScriptApp.deleteTrigger(t))` from a throwaway function, or use the
  Triggers (clock icon) sidebar to delete it manually.
