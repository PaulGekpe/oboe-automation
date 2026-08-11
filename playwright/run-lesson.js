/**
 * OBOE DAILY LESSON — HANDS (AI-answer version)
 * ---------------------------------------------------------
 * Loads a saved logged-in session, then for each topic in TOPICS_JSON:
 * submits it, answers the calibration question, waits for the lesson,
 * engages with follow-up questions using Claude Haiku to pick genuine
 * answers (falling back to random/generic if no API key is set), and
 * requests a study guide artifact. Screenshots go to ./run-output/.
 * At the end, posts a combined summary of all topics to the Apps Script
 * webhook, which emails it to you.
 *
 * NOTE ON SELECTORS: best-guesses refined from a real captured Oboe
 * page — see SELECTORS below. If Oboe changes their UI, screenshots in
 * run-output/ will show exactly where a step broke.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT_DIR = path.join(__dirname, 'run-output');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const STORAGE_STATE_B64 = process.env.OBOE_STORAGE_STATE_B64;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // optional — falls back to free behavior if unset
const WEBHOOK_URL = process.env.APPS_SCRIPT_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// TOPICS_JSON looks like: [{"topic":"...", "calibrationAnswer":"..."}, {...}]
let TOPICS;
try {
  TOPICS = JSON.parse(process.env.TOPICS_JSON || '[]');
} catch (e) {
  TOPICS = [];
}

if (!STORAGE_STATE_B64 || TOPICS.length === 0) {
  console.error('Missing OBOE_STORAGE_STATE_B64 or TOPICS_JSON env vars.');
  process.exit(1);
}

// All confirmed from real captured Oboe markup — no more guessing here.
const SELECTORS = {
  promptBox: 'textarea[name="prompt"]', // confirmed on both fresh home screen and mid-lesson
  sendButton: 'button[type="submit"][aria-label="Send message"]',
  // Confirmed: plain suggestions AND lettered A/B/C/D quizzes both use this
  // same followUpRow class, inside a shared suggested-replies container.
  suggestedReplyChip: '[data-test-id="suggested-replies"] .followUpRow',
  pathContainer: 'text=Your path',
  currentStepLabel: 'text=Current Step' // confirmed exact text (CSS renders it as uppercase, but the DOM text is mixed-case)
};

const GENERIC_ENGAGED_REPLIES = [
  'That makes sense — can you give me a real-world example?',
  "Got it. What's the most common mistake people make here?",
  'Interesting, how would this apply in my specific situation?',
  'Can you summarize the key takeaway so far?',
  'What should I focus on practicing first?',
  'Yes, that helps — please go a bit deeper on that point.'
];

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function waitForOboeToFinishThinking(page, maxMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const thinking = await page.locator('text=Thinking...').first().isVisible().catch(() => false);
    if (!thinking) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

async function findSuggestionChips(page) {
  const chips = await page.locator(SELECTORS.suggestedReplyChip).all();
  const visible = [];
  for (const chip of chips) {
    if (await chip.isVisible().catch(() => false)) visible.push(chip);
  }
  return visible;
}

// Grabs the text of the last visible assistant message, for AI context and
// for the end-of-day summary. Best-effort: falls back to empty string.
// Filters out obvious non-message UI labels that were showing up as false
// context (e.g. artifact panel titles, step badges).
async function getLastMessageText(page) {
  try {
    const NOISE = /^(guide|current step|next step|your path|share|upgrade)$/i;
    const blocks = await page.locator('p, div').allInnerTexts();
    const candidates = blocks
      .map(t => (t || '').trim())
      .filter(t => t.length > 40 && !NOISE.test(t))
      // Skip blocks that are almost entirely a UI label repeated (heuristic:
      // real prose has spaces between many words; labels tend to be short
      // and title-cased without much punctuation).
      .filter(t => t.split(' ').length > 6);
    return candidates.length ? candidates[candidates.length - 1] : '';
  } catch (e) {
    return '';
  }
}

// If Oboe shows a structured "Your path" checklist, this returns whether
// it looks complete (path exists, but no "CURRENT STEP" marker left).
// Returns null if no path is present at all (topic isn't using that format).
async function isStructuredPathComplete(page) {
  const hasPath = await page.locator(SELECTORS.pathContainer).first().isVisible().catch(() => false);
  if (!hasPath) return null;
  const hasCurrentStep = await page.locator(SELECTORS.currentStepLabel).first().isVisible().catch(() => false);
  return !hasCurrentStep;
}

// Calls Claude Haiku to either pick the best chip index or write a genuine
// short reply. Returns { chipIndex } or { replyText }. Falls back to null
// (caller should use free/random behavior) if no API key or on any error.
async function askClaudeForAnswer(lastMessageText, chipTexts) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const prompt = chipTexts.length > 0
      ? `Oboe (a learning app) just said:\n"""${lastMessageText}"""\n\nIt's offering these reply options:\n${chipTexts.map((t, i) => `${i}: ${t}`).join('\n')}\n\nAs the learner, which option number is the most sensible, genuinely engaged choice? Reply with ONLY the number, nothing else.`
      : `Oboe (a learning app) just said:\n"""${lastMessageText}"""\n\nAs the learner, write a short (1-2 sentence), genuinely engaged reply or answer to keep the lesson moving. Reply with ONLY the reply text, nothing else.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim();
    if (!text) return null;

    if (chipTexts.length > 0) {
      const idx = parseInt(text.match(/\d+/)?.[0], 10);
      return Number.isInteger(idx) && idx >= 0 && idx < chipTexts.length ? { chipIndex: idx } : null;
    }
    return { replyText: text };
  } catch (e) {
    return null; // fall back to free behavior
  }
}

async function engageWithFollowUps(page, record, topicLabel, maxRounds = 20, maxMs = 300000) {
  const start = Date.now();
  for (let round = 1; round <= maxRounds; round++) {
    if (Date.now() - start > maxMs) {
      record(`Round ${round}: hit the ${Math.round(maxMs / 60000)}-minute time budget for this topic — moving on.`);
      break;
    }

    await waitForOboeToFinishThinking(page);

    // If Oboe shows a structured step-by-step path and it's no longer on a
    // "current step," treat the lesson as genuinely finished rather than
    // continuing to poke at it.
    const pathComplete = await isStructuredPathComplete(page);
    if (pathComplete === true) {
      record(`Round ${round}: structured lesson path shows complete (no more "CURRENT STEP") — stopping here.`);
      break;
    }

    const chips = await findSuggestionChips(page);
    const lastMessage = await getLastMessageText(page);

    if (chips.length > 0) {
      const chipTexts = [];
      for (const chip of chips) chipTexts.push((await chip.innerText()).trim());

      const aiChoice = await askClaudeForAnswer(lastMessage, chipTexts);
      const chosenIndex = aiChoice?.chipIndex ?? Math.floor(Math.random() * chips.length);
      const source = aiChoice ? 'AI-selected' : 'randomly picked (no AI / AI unavailable)';
      record(`Round ${round}: ${source} — "${chipTexts[chosenIndex]}"`);
      await chips[chosenIndex].click().catch(() => record(`Round ${round}: chip click failed, skipping.`));
    } else {
      const askBox = page.locator(SELECTORS.promptBox).first();
      if (!(await askBox.isVisible().catch(() => false))) {
        record(`Round ${round}: no chips or input box — assuming lesson is done.`);
        break;
      }
      const aiChoice = await askClaudeForAnswer(lastMessage, []);
      const reply = aiChoice?.replyText || GENERIC_ENGAGED_REPLIES[Math.floor(Math.random() * GENERIC_ENGAGED_REPLIES.length)];
      const source = aiChoice ? 'AI-written' : 'generic (no AI / AI unavailable)';
      record(`Round ${round}: ${source} reply — "${reply}"`);
      await askBox.click();
      await askBox.fill(reply);
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(1500);
    await waitForOboeToFinishThinking(page);
    await screenshot(page, `${topicLabel}-engagement-round-${round}`);
  }
}

async function runOneTopic(page, record, topicIndex, topicObj) {
  const label = `topic${topicIndex + 1}`;
  const { topic, calibrationAnswer } = topicObj;

  record(`[${label}] Typing topic: "${topic}"`);
  const promptBox = page.locator(SELECTORS.promptBox).first();
  await promptBox.click();
  await promptBox.fill(topic);
  await page.keyboard.press('Enter');
  await screenshot(page, `${label}-01-submitted`);

  record(`[${label}] Waiting for calibration question...`);
  await page.waitForTimeout(3000);
  await screenshot(page, `${label}-02-calibration`);

  record(`[${label}] Answering calibration: "${calibrationAnswer}"`);
  const calibrationInput = page.locator(SELECTORS.promptBox).first();
  await calibrationInput.click();
  await calibrationInput.fill(calibrationAnswer || "I'm a busy professional, keep it practical and concise.");
  await page.keyboard.press('Enter');

  record(`[${label}] Waiting for the lesson to build...`);
  await page.waitForTimeout(2000);
  await waitForOboeToFinishThinking(page);
  await screenshot(page, `${label}-03-built`);

  record(`[${label}] Engaging with follow-up questions...`);
  await engageWithFollowUps(page, record, label);

  const finalMessage = await getLastMessageText(page);

  record(`[${label}] Requesting a study guide artifact...`);
  const askBox = page.locator(SELECTORS.promptBox).first();
  let studyGuideText = '';
  if (await askBox.isVisible().catch(() => false)) {
    await askBox.click();
    await askBox.fill('/studyguide');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    await waitForOboeToFinishThinking(page);
    studyGuideText = await getLastMessageText(page);
    await screenshot(page, `${label}-99-studyguide`);
  } else {
    record(`[${label}] Ask box not found — skipping study guide step.`);
  }

  return { topic, finalMessage, studyGuideText };
}

async function postSummaryToWebhook(summaries, record) {
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    record('No webhook configured — skipping summary email.');
    return;
  }
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: WEBHOOK_SECRET,
        type: 'summary',
        date: new Date().toISOString().slice(0, 10),
        topics: summaries
      })
    });
    record('Posted daily summary to webhook.');
  } catch (e) {
    record('Failed to post summary webhook: ' + e.message);
  }
}

async function run() {
  const stateJson = Buffer.from(STORAGE_STATE_B64, 'base64').toString('utf-8');
  const storageStatePath = path.join(OUT_DIR, 'storageState.json');
  fs.writeFileSync(storageStatePath, stateJson);

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();
  page.setDefaultTimeout(45000); // more headroom than Playwright's 30s default, for a slower CI runner

  const log = [];
  const record = msg => { console.log(msg); log.push(`${new Date().toISOString()} ${msg}`); };
  const summaries = [];

  try {
    record('Opening Oboe home...');
    await page.goto('https://oboe.com/', { waitUntil: 'networkidle' });
    await screenshot(page, '00-home');

    // The real crash we hit wasn't a wrong selector — it was the page
    // taking longer to render on GitHub's servers than expected. Wait
    // explicitly and generously, with one reload-and-retry if needed,
    // instead of assuming networkidle alone means the app has mounted.
    let promptReady = await page.locator(SELECTORS.promptBox).first()
      .waitFor({ state: 'visible', timeout: 45000 }).then(() => true).catch(() => false);
    if (!promptReady) {
      record('Prompt box not visible after 45s — reloading once and trying again.');
      await page.reload({ waitUntil: 'networkidle' });
      await screenshot(page, '00b-home-after-reload');
      promptReady = await page.locator(SELECTORS.promptBox).first()
        .waitFor({ state: 'visible', timeout: 45000 }).then(() => true).catch(() => false);
    }
    if (!promptReady) {
      throw new Error('Prompt box never appeared even after a reload — see 00-home.png / 00b-home-after-reload.png to check what the page actually showed.');
    }

    const loggedOut = await page.locator('text=Log in').first().isVisible().catch(() => false);
    if (loggedOut) {
      throw new Error('Session appears expired — "Log in" is visible. Re-run save-session.js and update the GitHub secret.');
    }

    for (let i = 0; i < TOPICS.length; i++) {
      // Start a fresh chat for each topic after the first (click the "+" new-chat control).
      if (i > 0) {
        await page.goto('https://oboe.com/', { waitUntil: 'networkidle' });
        await page.locator(SELECTORS.promptBox).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
      const result = await runOneTopic(page, record, i, TOPICS[i]);
      summaries.push(result);
    }

    await postSummaryToWebhook(summaries, record);
    record('Done with all topics for today.');
  } catch (err) {
    record('ERROR: ' + err.message);
    await screenshot(page, '99-error-state');
    if (summaries.length > 0) await postSummaryToWebhook(summaries, record); // send partial summary if any topics finished
    fs.writeFileSync(path.join(OUT_DIR, 'run-log.txt'), log.join('\n'));
    await browser.close();
    process.exit(1);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'run-log.txt'), log.join('\n'));
  await browser.close();
}

run();
