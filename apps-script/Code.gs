/**
 * OBOE DAILY LESSON — BRAIN
 * ---------------------------------------------------------
 * Picks a topic from the curated list below and dispatches it to
 * GitHub Actions (which runs the browser bot — with Claude Haiku
 * answering real questions), and later receives a webhook back with
 * either a failure alert or a "what you learned" summary, both
 * emailed to you via MailApp.
 *
 * RECOMMENDED: two topics/day via two separate single-topic runs
 * (morning + afternoon) rather than both in one job — real lessons can
 * run 15+ interactive rounds plus live web research, and two topics in
 * a single 30-minute GitHub Actions job risk one getting cut off before
 * Oboe's Skills tracking registers it as complete.
 *
 * SETUP (one time):
 * 1. Extensions > Apps Script > Project Settings > Script Properties.
 *    Add these keys:
 *      GITHUB_TOKEN    - a GitHub Personal Access Token (fine-grained,
 *                          "Contents: read" + "Actions: read/write"
 *                          scoped to your automation repo only)
 *      GITHUB_REPO     - "your-username/oboe-automation"
 *      ALERT_EMAIL      - the email address you want alerts/summaries sent to
 *      WEBHOOK_SECRET    - any random string you make up (also goes in a
 *                          GitHub secret) — stops strangers from spamming
 *                          your inbox via the public web app URL
 * 2. Run `createTwiceDailyTriggers` once from the Apps Script editor to
 *    schedule two single-topic runs a day (8am and 2pm).
 * 3. Run `generateAndDispatchOneTopic` manually once to test end-to-end.
 * 4. Deploy > New deployment > type "Web app" > Execute as: Me > Who has
 *    access: Anyone. Copy the deployment URL — you'll put it in a GitHub
 *    secret (see README) so GitHub Actions can call it back.
 */

const TOPICS_PER_DAY = 2;

// ---- These run first, in order, before the regular rotation kicks in.
// With TOPICS_PER_DAY = 2, this fills days 1-2 completely and spills one
// topic into day 3, after which TOPIC_LIST takes over as normal.
const PRIORITY_TOPICS = [
  { topic: 'effective communication skills', calibrationAnswer: "I'm a political candidate and community leader, keep it practical." },
  { topic: 'negotiation strategies', calibrationAnswer: "I'm an elected-office candidate who negotiates with party stakeholders regularly." },
  { topic: 'navigating office politics', calibrationAnswer: "I lead teams and manage stakeholder relationships, keep it practical." },
  { topic: 'networking and relationship building', calibrationAnswer: "I'm building political and professional relationships, keep it practical." },
  { topic: 'interpersonal and people skills', calibrationAnswer: "I lead a team and community, keep it practical." }
];

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

function generateAndDispatchTopics() {
  try {
    generateAndDispatchTopics_();
  } catch (err) {
    const alertEmail = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
    if (alertEmail) {
      MailApp.sendEmail(
        alertEmail,
        '⚠️ Oboe daily lesson: topic selection failed',
        `The Apps Script step failed before it could reach GitHub.\n\nError: ${err.message}\n\nCheck Apps Script > Executions for the full log.`
      );
    }
    throw err;
  }
}

function generateAndDispatchTopics_() {
  const props = PropertiesService.getScriptProperties();
  const githubToken = props.getProperty('GITHUB_TOKEN');
  const githubRepo = props.getProperty('GITHUB_REPO');

  if (!githubToken || !githubRepo) {
    throw new Error('Missing script properties. Set GITHUB_TOKEN and GITHUB_REPO.');
  }

  const todaysTopics = pickNextTopics_(TOPICS_PER_DAY);
  todaysTopics.forEach(t => saveTopicToLog(t.topic));
  dispatchToGitHub(githubToken, githubRepo, todaysTopics);

  Logger.log('Dispatched topics: ' + todaysTopics.map(t => t.topic).join(' | '));
}

// ---- RECOMMENDED: dispatches ONE topic per call. Now that real lessons
// can run 15+ interactive rounds plus live web research, two topics in a
// single GitHub Actions job risk hitting its 30-minute limit — the
// second topic (or even the tail end of the first) can get cut off
// before Oboe's Skills tracking registers it as complete. Call this
// twice a day instead (see createTwiceDailyTriggers below) so each
// topic gets its own full run and full time budget.
function generateAndDispatchOneTopic() {
  try {
    generateAndDispatchOneTopic_();
  } catch (err) {
    const alertEmail = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
    if (alertEmail) {
      MailApp.sendEmail(
        alertEmail,
        '⚠️ Oboe daily lesson: topic selection failed',
        `The Apps Script step failed before it could reach GitHub.\n\nError: ${err.message}\n\nCheck Apps Script > Executions for the full log.`
      );
    }
    throw err;
  }
}

function generateAndDispatchOneTopic_() {
  const props = PropertiesService.getScriptProperties();
  const githubToken = props.getProperty('GITHUB_TOKEN');
  const githubRepo = props.getProperty('GITHUB_REPO');

  if (!githubToken || !githubRepo) {
    throw new Error('Missing script properties. Set GITHUB_TOKEN and GITHUB_REPO.');
  }

  const todaysTopic = pickNextTopics_(1);
  todaysTopic.forEach(t => saveTopicToLog(t.topic));
  dispatchToGitHub(githubToken, githubRepo, todaysTopic);

  Logger.log('Dispatched topic: ' + todaysTopic.map(t => t.topic).join(' | '));
}

// ---- picks N un-used topics: PRIORITY_TOPICS first (in order), then
// TOPIC_LIST, cycling TOPIC_LIST once it's exhausted ----
function pickNextTopics_(count) {
  const usedTopics = getAllLoggedTopics();
  const unusedPriority = PRIORITY_TOPICS.filter(t => usedTopics.indexOf(t.topic) === -1);
  const unusedRegular = TOPIC_LIST.filter(t => usedTopics.indexOf(t.topic) === -1);

  const picked = unusedPriority.slice(0, count);
  if (picked.length < count) {
    picked.push(...unusedRegular.slice(0, count - picked.length));
  }

  // Safety net: if both lists are somehow exhausted, cycle back through TOPIC_LIST.
  let i = 0;
  while (picked.length < count) {
    const candidate = TOPIC_LIST[i % TOPIC_LIST.length];
    if (picked.indexOf(candidate) === -1) picked.push(candidate);
    i++;
    if (i > TOPIC_LIST.length * 2) break; // safety valve
  }
  return picked;
}

function dispatchToGitHub(token, repo, topics) {
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
        topics: topics, // array of {topic, calibrationAnswer}
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

// ---- receives pings from GitHub Actions: either a failure alert or a
// daily summary of what was learned — both get emailed to you ----
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
    return ContentService.createTextOutput('unauthorized').setMimeType(ContentService.MimeType.TEXT);
  }

  if (payload.type === 'summary') {
    sendSummaryEmail_(payload, alertEmail);
  } else {
    sendFailureEmail_(payload, alertEmail);
  }

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function sendFailureEmail_(payload, alertEmail) {
  const subject = `⚠️ Oboe daily lesson failed (${payload.date || 'today'})`;
  const body = `
The automated Oboe lesson run failed.

Error: ${payload.errorMessage || '(no details provided)'}
Full run logs & screenshots: ${payload.runUrl || '(no link provided)'}

You'll need to check what went wrong — most commonly this is either an
expired Oboe session (re-run save-session.js) or a UI change on Oboe's
side (check the screenshot in the run's uploaded artifact).
`;
  if (alertEmail) MailApp.sendEmail(alertEmail, subject, body);
}

function sendSummaryEmail_(payload, alertEmail) {
  const topics = payload.topics || [];
  const subject = `✅ Today's Oboe lessons (${payload.date || 'today'}) — ${topics.length} topic(s)`;

  let body = `Here's what got covered today:\n\n`;
  topics.forEach((t, i) => {
    body += `${i + 1}. ${t.topic}\n`;
    if (t.studyGuideText) {
      body += `   Study guide highlights: ${t.studyGuideText.slice(0, 500)}${t.studyGuideText.length > 500 ? '...' : ''}\n`;
    } else if (t.finalMessage) {
      body += `   ${t.finalMessage.slice(0, 300)}${t.finalMessage.length > 300 ? '...' : ''}\n`;
    }
    body += `\n`;
  });
  body += `\nOpen Oboe to see the full lessons and check your Skills page for updates.`;

  if (alertEmail) MailApp.sendEmail(alertEmail, subject, body);
}

// ---- run once to schedule the OLD two-topics-in-one-run approach.
// Kept for reference — createTwiceDailyTriggers below is now recommended instead.
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'generateAndDispatchTopics') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('generateAndDispatchTopics')
    .timeBased()
    .everyDays(1)
    .atHour(6) // 6am in the script's timezone (set under Project Settings)
    .create();
}

// ---- RECOMMENDED: run once to schedule two separate single-topic runs
// per day (morning + afternoon), each getting its own full GitHub
// Actions time budget instead of splitting one budget across two
// increasingly-long, deeply-interactive lessons.
function createTwiceDailyTriggers() {
  // Clear ALL existing triggers on this project first (both the old
  // single daily one and any previous twice-daily ones) to avoid
  // duplicates or the old two-topic version running alongside this.
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('generateAndDispatchOneTopic')
    .timeBased()
    .everyDays(1)
    .atHour(8) // morning run, 8am in the script's timezone
    .create();

  ScriptApp.newTrigger('generateAndDispatchOneTopic')
    .timeBased()
    .everyDays(1)
    .atHour(14) // afternoon run, 2pm in the script's timezone
    .create();

  Logger.log('Scheduled two daily triggers: 8am and 2pm, one topic each.');
}
