/**
 * OBOE DAILY LESSON — HANDS
 * ---------------------------------------------------------
 * Loads a saved logged-in session, opens Oboe, submits today's topic,
 * answers the calibration question, waits for the lesson to build,
 * and requests a study guide artifact. Takes screenshots at each step
 * into ./run-output/ so you can verify what happened (uploaded as a
 * GitHub Actions artifact by the workflow).
 *
 * NOTE ON SELECTORS: I can't see Oboe's real DOM from here since it's
 * behind login. The selectors below are best-guesses based on Oboe's
 * own published UI guide (button/placeholder text). If a step fails,
 * open the screenshot in run-output/, then open Oboe yourself, right-
 * click the relevant element > Inspect, and update the matching
 * SELECTORS entry below. This is the one part of the pipeline that
 * will likely need a five-minute tune-up after your first real run.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT_DIR = path.join(__dirname, 'run-output');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const TOPIC = process.env.TOPIC;
const CALIBRATION_ANSWER = process.env.CALIBRATION_ANSWER;
const STORAGE_STATE_B64 = process.env.OBOE_STORAGE_STATE_B64;

if (!TOPIC || !STORAGE_STATE_B64) {
  console.error('Missing TOPIC or OBOE_STORAGE_STATE_B64 env vars.');
  process.exit(1);
}

// Edit these if Oboe's real markup differs from these guesses.
const SELECTORS = {
  learnBox: 'textarea, input[type="text"]', // the "I want to learn..." box on the home screen
  sendButton: 'button[type="submit"], button:has-text("Send")',
  calibrationInput: 'textarea, input[type="text"]', // reused after the first message
  askQuestionBox: 'textarea[placeholder*="Ask a question" i]'
};

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function run() {
  const stateJson = Buffer.from(STORAGE_STATE_B64, 'base64').toString('utf-8');
  const storageStatePath = path.join(OUT_DIR, 'storageState.json');
  fs.writeFileSync(storageStatePath, stateJson);

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();

  const log = [];
  const record = msg => { console.log(msg); log.push(`${new Date().toISOString()} ${msg}`); };

  try {
    record(`Opening Oboe home...`);
    await page.goto('https://oboe.com/', { waitUntil: 'networkidle' });
    await screenshot(page, '01-home');

    // Sanity check: are we actually logged in? Look for something that only
    // appears when authenticated (e.g. absence of a "Log in" button).
    const loggedOut = await page.locator('text=Log in').first().isVisible().catch(() => false);
    if (loggedOut) {
      throw new Error('Session appears expired — "Log in" is visible. Re-run save-session.js and update the GitHub secret.');
    }

    record(`Typing topic: "${TOPIC}"`);
    const learnBox = page.locator(SELECTORS.learnBox).first();
    await learnBox.click();
    await learnBox.fill(TOPIC);
    await page.keyboard.press('Enter');
    await screenshot(page, '02-topic-submitted');

    record('Waiting for calibration question...');
    await page.waitForTimeout(3000); // give the chat time to respond
    await screenshot(page, '03-calibration-question');

    record(`Answering calibration: "${CALIBRATION_ANSWER}"`);
    const calibrationInput = page.locator(SELECTORS.calibrationInput).first();
    await calibrationInput.click();
    await calibrationInput.fill(CALIBRATION_ANSWER || "I'm a busy professional, keep it practical and concise.");
    await page.keyboard.press('Enter');

    record('Waiting for the lesson to build (this can take a bit)...');
    await page.waitForTimeout(15000);
    await screenshot(page, '04-lesson-built');

    record('Requesting a study guide artifact...');
    const askBox = page.locator(SELECTORS.askQuestionBox).first();
    if (await askBox.isVisible().catch(() => false)) {
      await askBox.click();
      await askBox.fill('/studyguide');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(8000);
      await screenshot(page, '05-studyguide');
    } else {
      record('Ask-question box not found — skipping study guide step (selector may need updating).');
    }

    record('Done. Lesson should now be saved in your Oboe chat history.');
  } catch (err) {
    record('ERROR: ' + err.message);
    await screenshot(page, '99-error-state');
    fs.writeFileSync(path.join(OUT_DIR, 'run-log.txt'), log.join('\n'));
    await browser.close();
    process.exit(1);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'run-log.txt'), log.join('\n'));
  await browser.close();
}

run();
