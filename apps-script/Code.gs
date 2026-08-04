/**
 * OBOE DAILY LESSON — BRAIN (free version, no paid API required)
 * ---------------------------------------------------------
 * Runs once a day on a trigger. Picks the next topic from a curated
 * list below (no AI call, no cost), then dispatches a
 * "repository_dispatch" event to GitHub Actions, which runs the
 * actual browser bot that logs into Oboe and completes the lesson.
 *
 * Anthropic's API requires prepaid credits (a card on file) to run,
 * so this version skips it entirely and just rotates through a
 * hand-written list instead — completely free. If you ever want
 * freshly AI-written topics instead, see the commented-out
 * `generateTopicWithAI_` function near the bottom: it's a drop-in
 * replacement for `pickNextTopic_`, and at these volumes (one short
 * call a day) it would cost a fraction of a cent per month once
 * you're comfortable adding a card.
 *
 * SETUP (one time):
 * 1. Extensions > Apps Script > Project Settings > Script Properties.
 *    Add these keys:
 *      GITHUB_TOKEN    - a GitHub Personal Access Token (fine-grained,
 *                          "Contents: read" + "Actions: read/write"
 *                          scoped to your automation repo only)
 *      GITHUB_REPO     - "your-username/oboe-automation"
 *      ALERT_EMAIL      - the email address you want failure alerts sent to
 *      WEBHOOK_SECRET    - any random string you make up (also goes in a
 *                          GitHub secret) — stops strangers from spamming
 *                          your alert email via the public web app URL
 * 2. Run `createDailyTrigger` once from the Apps Script editor to schedule it.
 * 3. Run `generateAndDispatchTopic` manually once to test end-to-end.
 * 4. Deploy > New deployment > type "Web app" > Execute as: Me > Who has
 *    access: Anyone. Copy the deployment URL — you'll put it in a GitHub
 *    secret (see README) so GitHub Actions can call it on failure.
 */

// ---- EDIT THIS: add, remove, or reorder topics freely ----
const TOPIC_LIST = [
  { topic: 'how a bill becomes law in a Nigerian state house of assembly', calibrationAnswer: "I'm running for state assembly, keep it practical, not academic." },
  { topic: 'public speaking techniques for political rallies', calibrationAnswer: "I'm an experienced speaker, give me advanced refinement tips." },
  { topic: 'how local government areas function in Nigeria', calibrationAnswer: "I'm a state-level candidate who needs to understand LGA dynamics for constituency work." },
  { topic: 'grassroots campaign organizing basics', calibrationAnswer: "I'm running a real campaign right now, keep it actionable." },
  { topic: 'the history of women in Nigerian politics', calibrationAnswer: "I'm a women's political representation advocate, go a bit deeper than basics." },
  { topic: 'what dividend investing is and how it works', calibrationAnswer: "I'm a complete beginner investor, keep it super basic." },
  { topic: 'negotiation tactics for political coalition-building', calibrationAnswer: "I'm an elected-office candidate who negotiates with party stakeholders regularly." },
  { topic: 'constitutional powers of Nigerian state assemblies', calibrationAnswer: "I'm running for state assembly, keep it practical, not academic." },
  { topic: 'how to read a company balance sheet as a beginner investor', calibrationAnswer: "I'm brand new to investing, explain it like I've never seen one before." },
  { topic: 'media training basics for political candidates', calibrationAnswer: "I do interviews and press events regularly, give me practical polish tips." },
  { topic: 'gender policy and reserved legislative seats globally', calibrationAnswer: "I coordinate a Reserved Seats for Women campaign, go a bit deeper than basics." },
  { topic: 'leadership styles and when to use each one', calibrationAnswer: "I lead a campaign team and community organization, keep it practical." },
  { topic: 'how party primaries and zoning arrangements work in Nigeria', calibrationAnswer: "I'm a PDP candidate navigating zoning right now, keep it practical." },
  { topic: 'the basics of REITs (real estate investment trusts)', calibrationAnswer: "I'm a beginner dividend investor, keep it simple with real examples." },
  { topic: 'crisis communication for public figures', calibrationAnswer: "I'm a political candidate who may face media scrutiny, keep it practical." },
  { topic: 'how state budgets are created and approved', calibrationAnswer: "I'm running for state assembly, keep it practical, not academic." },
  { topic: 'community organizing case studies from other African countries', calibrationAnswer: "I run grassroots welfare programs, give me transferable ideas." },
  { topic: 'basics of compound interest and long-term investing', calibrationAnswer: "I'm a beginner investor, keep it simple with real numbers." },
  { topic: 'how to build a policy platform voters actually remember', calibrationAnswer: "I'm building my own platform for a 2027 race, keep it practical." },
  { topic: 'the role of a state legislator versus a governor', calibrationAnswer: "I'm running for state assembly, keep it practical, not academic." },
  { topic: 'active listening and conflict resolution for leaders', calibrationAnswer: "I lead a team and community, keep it practical." },
  { topic: 'how dividend yield and payout ratio work', calibrationAnswer: "I'm a beginner investor and just made my first purchase, build on that." },
  { topic: 'women\'s political representation policy models around the world', calibrationAnswer: "I coordinate a Reserved Seats for Women campaign, go a bit deeper than basics." },
  { topic: 'how to run an effective town hall meeting', calibrationAnswer: "I host community meetings regularly, give me practical facilitation tips." },
  { topic: 'basics of Nigeria\'s electoral process and INEC', calibrationAnswer: "I'm a 2027 candidate, keep it practical for someone on the ballot." },
  { topic: 'personal branding for political candidates', calibrationAnswer: "I'm actively campaigning, keep it practical and specific." },
  { topic: 'how diversified portfolios reduce investing risk', calibrationAnswer: "I'm a beginner investor, keep it simple." },
  { topic: 'storytelling techniques for persuasive speeches', calibrationAnswer: "I give political speeches regularly, give me advanced refinement." },
  { topic: 'how committees work inside a state legislature', calibrationAnswer: "I'm running for state assembly, keep it practical, not academic." },
  { topic: 'basics of monthly passive income strategies', calibrationAnswer: "I'm a beginner investor building a monthly dividend income strategy." }
];

function generateAndDispatchTopic() {
  try {
    generateAndDispatchTopic_();
  } catch (err) {
    // If the "brain" itself fails (GitHub down, bad token, etc.) email
    // directly rather than relying on the GitHub-side webhook, since we
    // never made it to GitHub in this case.
    const alertEmail = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
    if (alertEmail) {
      MailApp.sendEmail(
        alertEmail,
        '⚠️ Oboe daily lesson: topic selection failed',
        `The Apps Script step failed before it could reach GitHub.\n\nError: ${err.message}\n\nCheck Apps Script > Executions for the full log.`
      );
    }
    throw err; // still surface it in Apps Script's own execution log
  }
}

function generateAndDispatchTopic_() {
  const props = PropertiesService.getScriptProperties();
  const githubToken = props.getProperty('GITHUB_TOKEN');
  const githubRepo = props.getProperty('GITHUB_REPO');

  if (!githubToken || !githubRepo) {
    throw new Error('Missing script properties. Set GITHUB_TOKEN and GITHUB_REPO.');
  }

  const parsed = pickNextTopic_();

  saveTopicToLog(parsed.topic);
  dispatchToGitHub(githubToken, githubRepo, parsed);

  Logger.log('Dispatched topic: ' + parsed.topic);
}

// ---- picks the next un-used topic from TOPIC_LIST, cycling once the list is exhausted ----
function pickNextTopic_() {
  const usedTopics = getAllLoggedTopics();
  const next = TOPIC_LIST.find(t => usedTopics.indexOf(t.topic) === -1);
  return next || TOPIC_LIST[usedTopics.length % TOPIC_LIST.length]; // cycle back around once all used
}

/*
// ---- OPTIONAL UPGRADE: swap pickNextTopic_() for this once you're ready
// to add a card at console.anthropic.com. Costs roughly a fraction of a
// cent per call at this volume. Also add an ANTHROPIC_API_KEY script
// property if you use this.
function generateTopicWithAI_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const recentTopics = getAllLoggedTopics().slice(-14);
  const prompt = `Pick one specific 5-10 minute learning topic for a Nigerian
state assembly candidate and women's-political-representation advocate who
is also a beginner dividend investor. Avoid repeating: ${JSON.stringify(recentTopics)}.
Return ONLY JSON: {"topic": "...", "calibrationAnswer": "..."}`;

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });
  const body = JSON.parse(response.getContentText());
  const raw = body.content[0].text.trim().replace(/^```json\s*|\s*```$/g, '');
  return JSON.parse(raw);
}
*/

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

// ---- topic history, stored in a Sheet, so we don't repeat ourselves ----
function getAllLoggedTopics() {
  const sheet = getLogSheet();
  const data = sheet.getDataRange().getValues();
  return data.slice(1).map(row => row[1]).filter(String);
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
