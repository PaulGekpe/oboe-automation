# Oboe Daily Lesson Bot

Fully automated daily learning: an AI picks today's topic based on your
goals, a browser bot logs into Oboe and runs the lesson for you, and
you get an email if any run fails. No clicking required once it's set up.

**Three moving parts:**
- `apps-script/Code.gs` — the "brain." Runs daily in Google Apps Script,
  asks an AI model for today's topic, pings GitHub Actions to go run it,
  and emails you if anything fails.
- `playwright/` — the "hands." A headless-browser bot (runs on GitHub's
  servers via Actions) that logs into Oboe and completes the lesson.
- A small failure-alert loop: if the bot fails, GitHub Actions calls back
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
  - `ANTHROPIC_API_KEY` — from console.anthropic.com
  - `GITHUB_TOKEN` — a fine-grained GitHub Personal Access Token
    (github.com/settings/tokens, "Fine-grained tokens") scoped only to
    this repo, with **Contents: Read** and **Actions: Read and write**
  - `GITHUB_REPO` — e.g. `YOUR-USERNAME/oboe-automation`
  - `ALERT_EMAIL` — the email address you want failure alerts sent to
  - `WEBHOOK_SECRET` — make up any random string, e.g. a UUID; you'll
    reuse this exact value in a GitHub secret in step 4
- Edit the `LEARNER_CONTEXT` block near the top of `Code.gs` if you want
  to steer the kinds of topics it picks.
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

### 5. Test the bot manually before automating it
In your repo: **Actions tab > Daily Oboe Lesson > Run workflow**, fill in
a test topic, run it. Check the uploaded `run-output` artifact
(screenshots + log) to confirm each step worked.

Oboe's real page structure may differ slightly from the guessed
selectors in `playwright/run-lesson.js` — if a step fails, the error
screenshot will show you exactly where, and the `SELECTORS` object near
the top of that file is where to fix it (on oboe.com, right-click the
relevant box > Inspect > copy a stable selector like an `id` or
`data-testid` if one exists).

**Also test the alert path on purpose once:** temporarily break something
(e.g. set `OBOE_STORAGE_STATE_B64` to garbage) and re-run the workflow.
You should get a failure email within a minute or two. Then put the real
value back.

### 6. Wire up the daily schedule
Back in the Apps Script editor, run `generateAndDispatchTopic` once
manually (▶ button, pick that function) to test the full chain
end-to-end — check Apps Script's **Executions** log, then your repo's
**Actions** tab. Once that works, run `createDailyTrigger` once to
schedule it to run automatically every day.

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
