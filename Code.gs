/**
 * OBOE DAILY LESSON — BRAIN
 * ---------------------------------------------------------
 * Runs once a day on a trigger. Generates a topic (tailored to
 * your goals) using the Anthropic API, then dispatches a
 * "repository_dispatch" event to GitHub Actions, which runs the
 * actual browser bot that logs into Oboe and completes the lesson.
 *
 * SETUP (one time):
 * 1. Extensions > Apps Script > Project Settings > Script Properties.
 *    Add these keys:
 *      ANTHROPIC_API_KEY   - your Anthropic API key (console.anthropic.com)
 *      GITHUB_TOKEN         - a GitHub Personal Access Token (fine-grained,
 *                              "Contents: read/write" + "Actions: read/write"
 *                              scoped to your automation repo only)
 *      GITHUB_REPO          - "your-username/oboe-automation"
 *      ALERT_EMAIL           - the email address you want failure alerts sent to
 *      WEBHOOK_SECRET         - any random string you make up (also goes in a
 *                              GitHub secret) — stops strangers from spamming
 *                              your alert email via the public web app URL
 * 2. Run `createDailyTrigger` once from the Apps Script editor to schedule it.
 * 3. Run `generateAndDispatchTopic` manually once to test end-to-end.
 * 4. Deploy > New deployment > type "Web app" > Execute as: Me > Who has
 *    access: Anyone. Copy the deployment URL — you'll put it in a GitHub
 *    secret (see README) so GitHub Actions can call it on failure.
 */

// ---- EDIT THIS: context Oboe should tailor topics around ----
const LEARNER_CONTEXT = `
You are choosing a daily 5-10 minute learning topic for a busy Nigerian
politician. She is a PDP candidate for the Cross River State House of
Assembly (Abi State Constituency), an advocate for women's political
representation (Reserved Seats for Women Bill), and a beginner
dividend-income investor. Rotate across these areas so that over a
month she gets a well-rounded mix:
  - Legislative process / how state assemblies work
  - Political communication, public speaking, media handling
  - Nigerian governance, constitutional law, local government structure
  - Campaign strategy and grassroots organizing
  - Women in politics / gender policy, globally and in Nigeria
  - Personal finance and dividend investing fundamentals
  - Leadership and negotiation skills
Avoid repeating a topic covered in the last 14 days (see RECENT_TOPICS below).
`;

function generateAndDispatchTopic() {
  try {
    generateAndDispatchTopic_();
  } catch (err) {
    // If the "brain" itself fails (bad API key, GitHub down, etc.) email
    // directly rather than relying on the GitHub-side webhook, since we
    // never made it to GitHub in this case.
    const alertEmail = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
    if (alertEmail) {
      MailApp.sendEmail(
        alertEmail,
        '⚠️ Oboe daily lesson: topic generation failed',
        `The Apps Script step failed before it could reach GitHub.\n\nError: ${err.message}\n\nCheck Apps Script > Executions for the full log.`
      );
    }
    throw err; // still surface it in Apps Script's own execution log
  }
}

function generateAndDispatchTopic_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ANTHROPIC_API_KEY');
  const githubToken = props.getProperty('GITHUB_TOKEN');
  const githubRepo = props.getProperty('GITHUB_REPO');

  if (!apiKey || !githubToken || !githubRepo) {
    throw new Error('Missing script properties. Set ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_REPO.');
  }

  const recentTopics = getRecentTopics();

  const prompt = `${LEARNER_CONTEXT}

RECENT_TOPICS (avoid repeating): ${JSON.stringify(recentTopics)}

Return ONLY valid JSON, no markdown fences, no preamble, in exactly this shape:
{
  "topic": "a specific, single learning topic phrased the way someone would type it into a 'I want to learn...' box, e.g. 'how a bill becomes law in a Nigerian state assembly'",
  "calibrationAnswer": "a one-sentence honest answer to a level-check question Oboe will ask, framed for a busy elected-office candidate who wants practical, not academic, framing"
}`;

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(response.getContentText());
  if (!body.content || !body.content[0]) {
    throw new Error('Unexpected Anthropic response: ' + response.getContentText());
  }

  const raw = body.content[0].text.trim().replace(/^```json\s*|\s*```$/g, '');
  const parsed = JSON.parse(raw);

  saveTopicToLog(parsed.topic);
  dispatchToGitHub(githubToken, githubRepo, parsed);

  Logger.log('Dispatched topic: ' + parsed.topic);
}

function dispatchToGitHub(token, repo, parsed) {
  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json'
    },
    payload: JSON.stringify({
      event_type: 'oboe-daily-lesson',
      client_payload: {
        topic: parsed.topic,
        calibrationAnswer: parsed.calibrationAnswer,
        date: Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd')
      }
    }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() >= 300) {
    throw new Error('GitHub dispatch failed: ' + response.getContentText());
  }
}

// ---- simple topic history so we don't repeat ourselves, stored in a Sheet ----
function getRecentTopics() {
  const sheet = getLogSheet();
  const data = sheet.getDataRange().getValues();
  return data.slice(Math.max(1, data.length - 14)).map(row => row[1]).filter(String);
}

function saveTopicToLog(topic) {
  const sheet = getLogSheet();
  sheet.appendRow([new Date(), topic]);
}

function getLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('Oboe Daily Topics');
  let sheet = ss.getSheetByName('Log');
  if (!sheet) {
    sheet = ss.insertSheet('Log');
    sheet.appendRow(['Date', 'Topic']);
  }
  return sheet;
}

// ---- receives failure pings from GitHub Actions and emails you ----
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedSecret = props.getProperty('WEBHOOK_SECRET');
  const alertEmail = props.getProperty('ALERT_EMAIL');

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('bad payload').setMimeType(ContentService.MimeType.TEXT);
  }

  if (!expectedSecret || payload.secret !== expectedSecret) {
    // Wrong/missing secret — silently ignore so this endpoint can't be
    // used to spam your inbox or probe the system.
    return ContentService.createTextOutput('unauthorized').setMimeType(ContentService.MimeType.TEXT);
  }

  const subject = `⚠️ Oboe daily lesson failed (${payload.date || 'today'})`;
  const body = `
The automated Oboe lesson run failed.

Topic attempted: ${payload.topic || '(unknown)'}
Error: ${payload.errorMessage || '(no details provided)'}
Full run logs & screenshots: ${payload.runUrl || '(no link provided)'}

You'll need to check what went wrong — most commonly this is either an
expired Oboe session (re-run save-session.js) or a UI change on Oboe's
side (check the screenshot in the run's uploaded artifact).
`;

  if (alertEmail) {
    MailApp.sendEmail(alertEmail, subject, body);
  }

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

// ---- run once to schedule the daily job ----
function createDailyTrigger() {
  // Clear any existing triggers for this function first to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'generateAndDispatchTopic') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('generateAndDispatchTopic')
    .timeBased()
    .everyDays(1)
    .atHour(6) // 6am in the script's timezone (set under Project Settings)
    .create();
}
