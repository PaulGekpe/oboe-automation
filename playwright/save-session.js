/**
 * RUN THIS ON YOUR OWN COMPUTER, ONCE (and again whenever the session expires).
 * It opens a real browser window, you log into Oboe by hand (including any
 * 2FA), and it saves your session to storageState.json.
 *
 * DO NOT commit storageState.json to git. It is equivalent to your password.
 * You'll base64-encode it and store it as a GitHub Actions secret instead
 * (see README.md).
 *
 * Usage:
 *   node save-session.js
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://oboe.com/');
  console.log('\n👉 Log into Oboe in the opened browser window.');
  console.log('   Once you land on your home screen (the "I want to learn..." box), come back here and press ENTER.\n');

  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  await context.storageState({ path: 'storageState.json' });
  console.log('✅ Saved storageState.json — see README.md for how to load this into GitHub secrets.');

  await browser.close();
})();
