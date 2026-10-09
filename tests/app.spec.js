// End-to-end checks for PromptCam, run in a real browser with a synthetic
// camera and microphone. Each test is one promise the app makes to its user.
const { test, expect } = require('@playwright/test');

const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
const script = (id, body, extra) => Object.assign({ id, title: 'Script ' + id, body, updatedAt: 1700000000000 }, extra || {});

// Seeds storage before the app's own code runs, then opens it.
async function boot(page, { scripts = [], settings = {}, rawSettings = null, primed = true } = {}) {
  await page.addInitScript(([scripts, settings, primed]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('promptcam_scripts', JSON.stringify(scripts));
    localStorage.setItem('promptcam_settings', JSON.stringify(settings));
    if (primed) localStorage.setItem('promptcam_cam_primed', 'true');
  }, [scripts, rawSettings || Object.assign({ countdown: 0 }, settings), primed]);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/index.html');
  return errors;
}
// Records every camera stream the app opens, optionally making the camera slow to start.
async function instrumentCamera(page, delayMs) {
  await page.addInitScript(delayMs => {
    window.__streams = [];
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async c => {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      const s = await orig(c);
      window.__streams.push(s);
      return s;
    };
  }, delayMs || 0);
}
const liveStreams = page => page.evaluate(() => window.__streams.filter(s => s.getTracks().some(t => t.readyState === 'live')).length);
const active = (page, view) => expect(page.locator('#view-' + view)).toHaveClass(/active/);
async function openPrompter(page) {
  await page.locator('#scriptList [data-act="start"]').first().click();
  await active(page, 'prompter');
}
const cameraReady = page => page.waitForFunction(() => cam.stream !== null);
const snap = page => page.evaluate(() => ({ pos: S.pos, t: S.last }));
async function measureRate(page, ms) {
  const a = await snap(page);
  await page.waitForTimeout(ms);
  const b = await snap(page);
  return (b.pos - a.pos) / ((b.t - a.t) / 1000);
}
async function recordTake(page, ms) {
  await page.click('#btnRecord');
  await page.waitForFunction(() => R !== null);
  await page.waitForTimeout(ms);
  await page.click('#btnRecord');
  await active(page, 'review');
}
const takeCount = page => page.evaluate(() => takesAll().then(a => a.length));

test.describe('scripts', () => {
  test('a new script that is never typed in leaves nothing behind', async ({ page }) => {
    const errors = await boot(page);
    await page.click('#btnNew');
    await active(page, 'editor');
    await page.click('#btnEditorBack');
    await active(page, 'library');
    expect(await page.evaluate(() => getScripts().length)).toBe(0);
    await expect(page.locator('.emptyState')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('typing saves the script, and it survives a reload', async ({ page }) => {
    await boot(page);
    await page.click('#btnNew');
    await page.fill('#scriptTitle', 'My intro');
    await page.fill('#scriptBody', 'Hello there this is a test');
    await expect(page.locator('#wordCount')).toContainText('6 words');
    await page.click('#btnEditorBack');
    await expect(page.locator('#scriptList .card')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#scriptList h3')).toHaveText('My intro');
  });

  test('duplicate makes a copy; delete asks first', async ({ page }) => {
    await boot(page, { scripts: [script('a', 'one two three')] });
    await page.click('#scriptList [data-act="open"]');
    await page.click('#btnDuplicate');
    await expect(page.locator('#scriptTitle')).toHaveValue('Script a (copy)');
    await page.click('#btnDeleteScript');
    await expect(page.locator('#modal')).toBeVisible();
    await page.click('#modalCancel');
    await active(page, 'editor');
    await page.click('#btnDeleteScript');
    await page.click('#modalOk');
    await active(page, 'library');
    await expect(page.locator('#scriptList .card')).toHaveCount(1);
  });

  test('a text file imports as a script; a hostile backup cannot inject markup', async ({ page }) => {
    const errors = await boot(page);
    await page.setInputFiles('#importFile', { name: 'pitch.txt', mimeType: 'text/plain', buffer: Buffer.from('First line\nSecond line here') });
    await active(page, 'editor');
    await expect(page.locator('#scriptTitle')).toHaveValue('pitch');
    await page.click('#btnEditorBack');
    const evil = JSON.stringify([{ id: "x');window.__pwned=1;//", title: '<img src=x onerror="window.__pwned=1">', body: 'safe words here' }]);
    await page.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(evil) });
    await expect(page.locator('#scriptList .card')).toHaveCount(2);
    await page.locator('#scriptList [data-act="open"]').first().click();
    await page.click('#btnEditorBack');
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.evaluate(() => getScripts().every(s => /^[\w-]{1,64}$/.test(s.id)))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('when storage is full, typing still works and the user is told', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
    await page.click('#btnNew');
    await page.fill('#scriptBody', 'some words to save');
    await expect(page.locator('.toast.error')).toBeVisible();
    await expect(page.locator('#scriptBody')).toHaveValue('some words to save');
    expect(errors).toEqual([]);
  });

  test('settings saved by older builds are converted, not trusted', async ({ page }) => {
    await boot(page, { rawSettings: { mode: 'standard', speed: 4, countdown: true, theme: 'ocean', fontSize: 9999 } });
    const s = await page.evaluate(() => settings);
    expect(s.mode).toBe('wpm');
    expect(s.speed).toBe(140);
    expect(s.countdown).toBe(3);
    expect(s.theme).toBe('ocean');
    expect(s.fontSize).toBe(30);
  });

  test('the browser Back button goes up a screen instead of leaving the app', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(40))] });
    await page.click('#scriptList [data-act="open"]');
    await active(page, 'editor');
    await page.evaluate(() => history.back());
    await active(page, 'library');
    await openPrompter(page);
    await page.evaluate(() => history.back());
    await active(page, 'library');
  });
});

test.describe('reading engine', () => {
  for (const n of [25, 400]) {
    test(`speed is the stated words per minute for a ${n}-word script`, async ({ page }) => {
      await boot(page, { scripts: [script('a', words(n), { wpm: 120 })] });
      await openPrompter(page);
      await page.click('#btnPlay');
      await page.waitForTimeout(300);
      const rate = await measureRate(page, 3000);
      expect(rate * 60).toBeGreaterThan(116);
      expect(rate * 60).toBeLessThan(124);
    });
  }

  test('the first word starts on the reading line, and the word being read stays there', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(300), { wpm: 200 })] });
    await openPrompter(page);
    const gap = () => page.evaluate(() => {
      const g = (r => r.top + r.height / 2)(document.getElementById('guideLine').getBoundingClientRect());
      const w = S.wordEls[Math.min(S.N - 1, Math.floor(S.pos))].getBoundingClientRect();
      return { d: Math.abs(w.top + w.height / 2 - g), line: S.lines[0].h * 1.4 };
    });
    expect((await gap()).d).toBeLessThan(3);
    await page.click('#btnPlay');
    await page.waitForTimeout(4000);
    await page.click('#btnPlay');
    const g = await gap();
    expect(g.d).toBeLessThan(g.line);
  });

  test('a [PAUSE] marker holds the scroll for its duration', async ({ page }) => {
    await boot(page, { scripts: [script('a', 'one two three [PAUSE 2] ' + words(40), { wpm: 300 })] });
    await openPrompter(page);
    await page.click('#btnPlay');
    await page.waitForTimeout(1300);
    expect((await snap(page)).pos).toBeCloseTo(3, 5);
    await expect(page.locator('.pauseMark.holding')).toHaveCount(1);
    await page.waitForTimeout(2000);
    expect((await snap(page)).pos).toBeGreaterThan(4);
  });

  test('timed pacing works out the speed from the target time', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(60), { targetSec: 30 })], settings: { mode: 'timed' } });
    await openPrompter(page);
    expect(await page.evaluate(() => effMode())).toBe('timed');
    expect(await page.evaluate(() => effWpm())).toBeCloseTo(120, 3);
    await page.click('#btnPlay');
    await page.waitForTimeout(300);
    expect((await measureRate(page, 2000)) * 60).toBeGreaterThan(115);
    await expect(page.locator('#speedLabel')).toContainText('0:30');
  });

  test('dragging the text moves through the script by hand', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    const box = await page.locator('#promptWindow').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 150, { steps: 6 });
    await page.mouse.up();
    const forward = (await snap(page)).pos;
    expect(forward).toBeGreaterThan(5);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 80, { steps: 6 });
    await page.mouse.up();
    expect((await snap(page)).pos).toBeLessThan(forward);
  });

  test('the keyboard drives the prompter', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(200), { wpm: 140 })] });
    await openPrompter(page);
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => S.playing)).toBe(true);
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => S.wpm)).toBe(145);
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => S.playing)).toBe(false);
    await page.keyboard.press('Home');
    expect((await snap(page)).pos).toBe(0);
    expect(await page.evaluate(() => getScripts()[0].wpm)).toBe(145);
  });

  test('controls stay fully visible until the script is moving, then dim', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(400))] });
    await openPrompter(page);
    await page.waitForTimeout(4600);
    await expect(page.locator('#view-prompter')).not.toHaveClass(/dimmed/);
    await page.click('#btnPlay');
    await page.waitForTimeout(4600);
    await expect(page.locator('#view-prompter')).toHaveClass(/dimmed/);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('btnRecord')).opacity)).toBe('1');
  });
});

test.describe('voice pacing', () => {
  test('voice-paced scrolls while you speak and waits when you stop', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(300), { wpm: 180 })], settings: { mode: 'voice' } });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnPlay');
    expect(await page.evaluate(() => effMode())).toBe('voice');
    // Replace the microphone analyser with one the test controls.
    await page.evaluate(() => {
      window.__loud = false;
      A.buf = new Uint8Array(1024);
      A.an = { getByteTimeDomainData(buf) { for (let i = 0; i < buf.length; i++) buf[i] = window.__loud ? (i % 2 ? 210 : 46) : 128; } };
    });
    await page.waitForTimeout(1200);
    expect(Math.abs(await measureRate(page, 1000))).toBeLessThan(0.15);
    await page.evaluate(() => { window.__loud = true; });
    await page.waitForTimeout(600);
    expect((await measureRate(page, 1500)) * 60).toBeGreaterThan(165);
    await page.evaluate(() => { window.__loud = false; });
    await page.waitForTimeout(1300);
    expect(Math.abs(await measureRate(page, 1000))).toBeLessThan(0.15);
  });

  test('voice-follow tracks recognised words and ignores stray ones', async ({ page }) => {
    await page.addInitScript(() => { window.SpeechRecognition = class { start() { window.__sr = this; } stop() {} }; });
    await boot(page, { scripts: [script('a', words(120))], settings: { mode: 'follow' } });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnPlay');
    await page.waitForFunction(() => window.__sr);
    const say = text => page.evaluate(t => window.__sr.onresult({ resultIndex: 0, results: [[{ transcript: t }]] }), text);
    await say('word0 word1 word2 word3');
    expect(await page.evaluate(() => followWord())).toBe(4);
    await say('banana umbrella');
    expect(await page.evaluate(() => followWord())).toBe(4);
    await say('word40');                       // one word, far ahead: not enough to jump
    expect(await page.evaluate(() => followWord())).toBe(4);
    await say('word20 word21 word22');         // a run of three: a deliberate skip ahead
    expect(await page.evaluate(() => followWord())).toBe(23);
    await page.waitForTimeout(4000);
    const s = await page.evaluate(() => {
      const g = (r => r.top + r.height / 2)(document.getElementById('guideLine').getBoundingClientRect());
      const w = S.wordEls[23].getBoundingClientRect();
      return { pos: S.pos, d: Math.abs(w.top + w.height / 2 - g), line: S.lines[0].h * 1.4 };
    });
    expect(s.pos).toBeGreaterThan(22.5);
    expect(s.pos).toBeLessThan(24);
    expect(s.d).toBeLessThan(s.line);
  });

  test('voice-follow falls back instead of freezing when recognition fails', async ({ page }) => {
    await page.addInitScript(() => { window.SpeechRecognition = class { start() { window.__sr = this; } stop() {} }; });
    await boot(page, { scripts: [script('a', words(120))], settings: { mode: 'follow' } });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnPlay');
    await page.waitForFunction(() => window.__sr);
    await page.evaluate(() => window.__sr.onerror({ error: 'not-allowed' }));
    expect(await page.evaluate(() => effMode())).not.toBe('follow');
    await expect(page.locator('.toast')).toContainText('Voice-paced');
    await expect(page.locator('#modePill')).not.toHaveText('Voice-follow');
  });
});

test.describe('camera', () => {
  test('first use explains the permission; declining still lets you rehearse', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(80))], primed: false });
    await openPrompter(page);
    await expect(page.locator('#modal')).toBeVisible();
    await page.click('#modalCancel');
    await expect(page.locator('#camError')).toBeVisible();
    await page.click('#btnCamSkip');
    await page.click('#btnPlay');
    await page.waitForTimeout(600);
    expect((await snap(page)).pos).toBeGreaterThan(0.5);
    await page.click('#btnRecord');
    expect(await page.evaluate(() => R)).toBeNull();
    await expect(page.locator('.toast')).toBeVisible();
  });

  test('leaving before the camera has started does not leave it running', async ({ page }) => {
    await instrumentCamera(page, 900);
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await page.click('#btnExit');
    await active(page, 'library');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__streams.length)).toBe(1);
    expect(await liveStreams(page)).toBe(0);
  });

  test('tapping record before the camera is ready does not fake a recording', async ({ page }) => {
    await instrumentCamera(page, 1500);
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await page.click('#btnRecord');
    expect(await page.evaluate(() => R)).toBeNull();
    expect(await page.evaluate(() => S.playing)).toBe(false);
    await expect(page.locator('.toast')).toContainText('still starting');
  });

  test('switching camera repeatedly never leaves an extra one running', async ({ page }) => {
    await instrumentCamera(page, 150);
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await cameraReady(page);
    for (let i = 0; i < 4; i++) await page.click('#btnFlip', { delay: 0 });
    await page.waitForTimeout(1500);
    expect(await liveStreams(page)).toBe(1);
    await page.click('#btnExit');
    await page.waitForTimeout(300);
    expect(await liveStreams(page)).toBe(0);
  });
});

test.describe('recording', () => {
  test('recording only starts on tap, produces a take, and Back keeps it', async ({ page }) => {
    const errors = await boot(page, { scripts: [script('a', words(200), { wpm: 240 })] });
    await openPrompter(page);
    await cameraReady(page);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => R)).toBeNull();
    expect((await snap(page)).pos).toBe(0);
    await recordTake(page, 2500);
    await expect(page.locator('#reviewVideo')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('#reviewNote')).toContainText('Kept in Takes');
    expect(await takeCount(page)).toBe(1);
    const take = await page.evaluate(() => takesAll().then(a => ({ size: a[0].size, srt: a[0].srt, dur: a[0].durationMs })));
    expect(take.size).toBeGreaterThan(1000);
    expect(take.dur).toBeGreaterThan(2000);
    expect(take.srt).toMatch(/^1\n00:00:0[0-2],\d{3} --> /);
    await page.click('#btnReviewBack');
    await active(page, 'library');
    await expect(page.locator('#takeList .card')).toHaveCount(1);
    expect(await takeCount(page)).toBe(1);
    await page.reload();
    await page.click('#tabTakes');
    await expect(page.locator('#takeList .card')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('deleting a take asks first', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(200))] });
    await openPrompter(page);
    await cameraReady(page);
    await recordTake(page, 1200);
    await page.click('#btnDeleteTake');
    await page.click('#modalCancel');
    await active(page, 'review');
    expect(await takeCount(page)).toBe(1);
    await page.click('#btnDeleteTake');
    await page.click('#modalOk');
    await active(page, 'library');
    expect(await takeCount(page)).toBe(0);
  });

  test('leaving mid-recording asks; cancelling keeps recording, confirming discards', async ({ page }) => {
    await instrumentCamera(page, 0);
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnRecord');
    await page.waitForFunction(() => R !== null);
    await page.click('#btnExit');
    await page.click('#modalCancel');
    await active(page, 'prompter');
    expect(await page.evaluate(() => R !== null)).toBe(true);
    await page.click('#btnExit');
    await page.click('#modalOk');
    await active(page, 'library');
    await page.waitForTimeout(1200);
    expect(await takeCount(page)).toBe(0);
    expect(await liveStreams(page)).toBe(0);
    expect(await page.evaluate(() => R)).toBeNull();
  });

  test('if the camera is cut off mid-recording, the footage so far is kept', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnRecord');
    await page.waitForFunction(() => R !== null);
    await page.waitForTimeout(1800);
    await page.evaluate(() => cam.stream.getTracks().forEach(t => { t.stop(); t.dispatchEvent(new Event('ended')); }));
    await active(page, 'review');
    expect(await page.evaluate(() => R)).toBeNull();
    expect(await takeCount(page)).toBe(1);
    // and the next take works normally
    await page.click('#btnRetake');
    await active(page, 'prompter');
    await cameraReady(page);
    await recordTake(page, 1200);
    expect(await takeCount(page)).toBe(2);
  });

  test('pausing a recording stops the clock', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnRecord');
    await page.waitForFunction(() => R !== null);
    await page.waitForTimeout(800);
    await page.click('#btnRecPause');
    const a = await page.evaluate(() => recElapsed());
    await page.waitForTimeout(1000);
    const b = await page.evaluate(() => recElapsed());
    expect(b - a).toBeLessThan(60);
    await expect(page.locator('#statusText')).toContainText('Paused');
    await page.click('#btnRecPause');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => recElapsed())).toBeGreaterThan(b + 300);
  });

  test('closing the share sheet never triggers a surprise download', async ({ page }) => {
    await page.addInitScript(() => {
      window.__downloads = 0;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads++; return; } return orig.call(this); };
      window.__shareMode = 'abort';
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => window.__shareMode !== 'none' });
      Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) });
    });
    await boot(page, { scripts: [script('a', words(200))] });
    await openPrompter(page);
    await cameraReady(page);
    await recordTake(page, 1200);
    await page.click('#btnSavePhotos');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__downloads)).toBe(0);
    await page.evaluate(() => { window.__shareMode = 'none'; });
    await page.click('#btnSavePhotos');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__downloads)).toBe(1);
  });

  test('the countdown can be cancelled, and nothing records if it is', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(200))], settings: { countdown: 3 } });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnRecord');
    await expect(page.locator('#countdownOverlay')).toBeVisible();
    await page.click('#countdownOverlay');
    await page.waitForTimeout(3500);
    expect(await page.evaluate(() => R)).toBeNull();
    await page.click('#btnRecord');
    await page.waitForFunction(() => R !== null, null, { timeout: 6000 });
    expect(await page.evaluate(() => S.playing)).toBe(true);
  });
});

test.describe('look and layout', () => {
  test('in the Light theme, text on the camera screen is still light', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(200))], settings: { theme: 'light', countdown: 5 } });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnRecord');
    const colour = id => page.evaluate(i => getComputedStyle(document.getElementById(i)).color, id);
    expect(await colour('countNum')).toBe('rgb(255, 255, 255)');
    expect(await colour('speedLabel')).toBe('rgb(255, 255, 255)');
    expect(await colour('promptText')).toBe('rgb(255, 255, 255)');
  });

  for (const vp of [{ name: 'phone', width: 390, height: 844 }, { name: 'small phone', width: 320, height: 568 },
                    { name: 'phone on its side', width: 844, height: 390 }, { name: 'desktop', width: 1280, height: 800 }]) {
    test(`every control is on screen: ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await boot(page, { scripts: [script('a', words(300))] });
      const onScreen = async sel => {
        const b = await page.locator(sel).boundingBox();
        expect(b, sel + ' should be visible').not.toBeNull();
        expect(b.x).toBeGreaterThanOrEqual(-0.5);
        expect(b.y).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
        expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
      };
      await openPrompter(page);
      await cameraReady(page);
      for (const sel of ['#btnExit', '#btnFlip', '#btnRestart', '#btnPlay', '#btnRecord', '#btnRecPause', '#btnSheet', '#liveSpeed', '#modePill', '#zoomChip']) await onScreen(sel);
      const overlap = await page.evaluate(() => {
        const w = document.getElementById('promptWindow').getBoundingClientRect();
        const t = document.getElementById('topBar').getBoundingClientRect();
        return { top: w.top - t.bottom, h: w.height };
      });
      expect(overlap.top).toBeGreaterThanOrEqual(-0.5);
      expect(overlap.h).toBeGreaterThan(60);
      await recordTake(page, 1200);
      for (const sel of ['#btnReviewBack', '#btnSavePhotos', '#btnSaveFiles', '#btnRetake', '#btnDeleteTake']) await onScreen(sel);
    });
  }

  test('every button has a name a screen reader can announce', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(50))] });
    await page.click('#btnSettings');
    await page.click('#btnSettingsBack');
    await openPrompter(page);
    await page.click('#btnSheet');
    const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll('button, input, select, textarea')).filter(el => {
      if (el.type === 'file') return false;
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector('label[for="' + el.id + '"]'));
      return !labelled && !el.textContent.trim() && !el.placeholder;
    }).map(el => el.id || el.outerHTML.slice(0, 60)));
    expect(unnamed).toEqual([]);
  });

  test('text settings apply live from the camera screen', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(200))] });
    await openPrompter(page);
    await page.click('#btnSheet');
    await expect(page.locator('#quickSheet')).toBeVisible();
    await page.locator('#sh_fontSize').fill('48');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('promptText')).fontSize)).toBe('48px');
    const before = await page.evaluate(() => document.getElementById('promptWindow').offsetHeight);
    await page.locator('#sh_textHeight').fill('80');
    expect(await page.evaluate(() => document.getElementById('promptWindow').offsetHeight)).toBeGreaterThan(before);
    const gap = await page.evaluate(() => {
      const g = (r => r.top + r.height / 2)(document.getElementById('guideLine').getBoundingClientRect());
      const w = S.wordEls[0].getBoundingClientRect();
      return Math.abs(w.top + w.height / 2 - g);
    });
    expect(gap).toBeLessThan(3);
    await page.reload();
    expect(await page.evaluate(() => settings.fontSize)).toBe(48);
  });
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });
  test('the app opens with no connection after one visit', async ({ page, context }) => {
    await page.goto('/index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#view-library h1')).toHaveText('PromptCam');
    expect(await page.evaluate(() => typeof S)).toBe('object');
    await page.click('#btnSettings');
    await expect(page.locator('#aboutLine')).toContainText(await page.evaluate(() => APP_VERSION));
  });
});

// ---------------------------------------------------------------------------
// Picture quality, sound, zoom and framing
// ---------------------------------------------------------------------------
// Wraps the browser's camera, recorder and audio APIs so a test can see exactly
// what the app asked for.
async function spyMedia(page, rejectPrefix) {
  await page.addInitScript(prefix => {
    window.__gum = [];
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async c => {
      window.__gum.push(JSON.parse(JSON.stringify(c)));
      const id = x => (x && x.deviceId && x.deviceId.exact) || '';
      if (prefix && (id(c.video).startsWith(prefix) || id(c.audio).startsWith(prefix))) throw new DOMException('gone', 'OverconstrainedError');
      return orig(c);
    };
    const OrigMR = window.MediaRecorder;
    window.__mr = [];
    window.MediaRecorder = class extends OrigMR { constructor(s, o) { super(s, o); window.__mr.push(o || {}); } };
    const OrigAC = window.AudioContext;
    window.__ac = 0;
    window.AudioContext = class extends OrigAC { constructor(...a) { super(...a); window.__ac++; } };
  }, rejectPrefix || '');
}
const lastGum = page => page.evaluate(() => window.__gum[window.__gum.length - 1]);
const cameraSized = page => page.waitForFunction(() => cam.stream !== null && document.getElementById('camera').videoWidth > 0);

test.describe('picture quality and sound', () => {
  test('asks for the shape the phone is held in, at the chosen quality', async ({ page }) => {
    await spyMedia(page);
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await cameraReady(page);
    let v = (await lastGum(page)).video;
    expect([v.width.ideal, v.height.ideal]).toEqual([1080, 1920]);
    expect(v.frameRate.ideal).toBe(30);
    await page.click('#btnExit');
    await page.setViewportSize({ width: 844, height: 390 });
    await openPrompter(page);
    await cameraReady(page);
    v = (await lastGum(page)).video;
    expect([v.width.ideal, v.height.ideal]).toEqual([1920, 1080]);
  });

  test('Maximum asks for 4K', async ({ page }) => {
    await spyMedia(page);
    await boot(page, { scripts: [script('a', words(80))], settings: { quality: 'max' } });
    await openPrompter(page);
    await cameraReady(page);
    const v = (await lastGum(page)).video;
    expect([v.width.ideal, v.height.ideal]).toEqual([2160, 3840]);
  });

  for (const [quality, fps, mbps] of [['720', 30, 8], ['1080', 30, 16], ['max', 30, 35], ['1080', 60, 24]]) {
    test(`${quality}p at ${fps} fps records at ${mbps} Mbps, far above the old 5 Mbps cap`, async ({ page }) => {
      await spyMedia(page);
      await boot(page, { scripts: [script('a', words(200))], settings: { quality, fps } });
      await openPrompter(page);
      await cameraReady(page);
      await recordTake(page, 1000);
      const o = await page.evaluate(() => window.__mr[0]);
      expect(o.videoBitsPerSecond).toBe(mbps * 1e6);
      expect(o.audioBitsPerSecond).toBe(192000);
    });
  }

  test('the microphone is opened without processing by default, and with it in Voice mode', async ({ page }) => {
    await spyMedia(page);
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await cameraReady(page);
    let a = (await lastGum(page)).audio;
    expect([a.echoCancellation, a.noiseSuppression, a.autoGainControl]).toEqual([false, false, false]);
    await page.click('#btnExit');
    await page.evaluate(() => { settings.audioMode = 'voice'; lsSet(K.settings, settings); });
    await openPrompter(page);
    await page.waitForFunction(() => window.__gum.length === 2);
    a = (await lastGum(page)).audio;
    expect([a.echoCancellation, a.noiseSuppression, a.autoGainControl]).toEqual([true, true, true]);
  });

  test('plain recording never starts an audio engine; voice pacing does', async ({ page }) => {
    await spyMedia(page);
    await boot(page, { scripts: [script('a', words(200))] });
    await openPrompter(page);
    await cameraReady(page);
    await page.mouse.click(200, 700);
    await recordTake(page, 1000);
    expect(await page.evaluate(() => window.__ac)).toBe(0);
    await page.click('#btnRetake');
    await active(page, 'prompter');
    await cameraReady(page);
    await page.evaluate(() => { settings.mode = 'voice'; });
    await page.click('#btnPlay');
    expect(await page.evaluate(() => window.__ac)).toBeGreaterThan(0);
  });

  test('the review screen says how the take was shot', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(200))] });
    await openPrompter(page);
    await cameraReady(page);
    await recordTake(page, 2200);
    await expect(page.locator('#reviewNote')).toContainText(/\d+×\d+/);
    await expect(page.locator('#reviewNote')).toContainText('16 Mbps');
  });

  test('changing quality in the camera tab reopens the camera with the new request', async ({ page }) => {
    await spyMedia(page);
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnSheet');
    await page.click('#shTabCam');
    await page.click('#paneCam [data-key="quality"][data-val="720"]');
    await page.waitForFunction(() => window.__gum.length === 2, null, { timeout: 4000 });
    const v = (await lastGum(page)).video;
    expect([v.width.ideal, v.height.ideal]).toEqual([720, 1280]);
  });

  test('a lens or microphone that has gone is replaced by the default, with a notice', async ({ page }) => {
    await spyMedia(page, 'gone-');
    await page.addInitScript(() => {
      navigator.mediaDevices.enumerateDevices = async () => [
        { kind: 'videoinput', deviceId: 'cam-front', label: 'Front Camera' },
        { kind: 'videoinput', deviceId: 'cam-back', label: 'Back Camera' },
        { kind: 'videoinput', deviceId: 'gone-wide', label: 'Back Ultra Wide Camera' },
        { kind: 'audioinput', deviceId: 'default', label: 'Default' },
        { kind: 'audioinput', deviceId: 'mic-built', label: 'iPhone Microphone' },
        { kind: 'audioinput', deviceId: 'gone-usb', label: 'USB Microphone' }
      ];
    });
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnSheet');
    await page.click('#shTabCam');
    await expect(page.locator('#selLens option')).toHaveCount(4);
    await expect(page.locator('#selMic option')).toHaveCount(3);
    await page.selectOption('#selLens', 'gone-wide');
    await expect(page.locator('.toast')).toContainText("isn't available");
    await page.waitForFunction(() => cam.stream !== null && S.camId === null);
    await page.selectOption('#selMic', 'gone-usb');
    await page.waitForFunction(() => settings.micId === '' && cam.stream !== null, null, { timeout: 5000 });
    const picked = await page.evaluate(() => window.__gum.some(g => g.audio.deviceId && g.audio.deviceId.exact === 'gone-usb'));
    expect(picked).toBe(true);
  });

  test('the microphone check measures the level and releases the audio engine afterwards', async ({ page }) => {
    await spyMedia(page);
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await cameraReady(page);
    await page.click('#btnSheet');
    await page.click('#shTabCam');
    await page.click('#btnMicCheck');
    expect(await page.evaluate(() => A.ctx !== null && A.an !== null)).toBe(true);
    await expect(page.locator('#micCheckText')).toContainText(/dB|No sound/, { timeout: 5000 });
    await page.click('#btnMicCheck');
    expect(await page.evaluate(() => A.ctx)).toBeNull();
    await expect(page.locator('#camBody')).toContainText('In use right now');
  });
});

test.describe('framing and zoom', () => {
  test('the preview shows exactly the recorded picture; Fill screen crops it', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(80))] });
    await openPrompter(page);
    await cameraSized(page);
    const shape = () => page.evaluate(() => {
      const b = document.getElementById('camBox').getBoundingClientRect(), v = document.getElementById('camera');
      return { box: b.width / b.height, video: v.videoWidth / v.videoHeight, w: b.width, h: b.height, vw: innerWidth, vh: document.getElementById('view-prompter').clientHeight };
    });
    let s = await shape();
    expect(Math.abs(s.box - s.video)).toBeLessThan(0.02);
    expect(s.w).toBeLessThanOrEqual(s.vw + 0.5);
    expect(s.h).toBeLessThanOrEqual(s.vh + 0.5);
    await page.click('#btnSheet');
    await page.click('#shTabCam');
    await page.click('#paneCam [data-key="framing"][data-val="fill"]');
    s = await shape();
    expect(s.w).toBeCloseTo(s.vw, 0);
    expect(s.h).toBeCloseTo(s.vh, 0);
  });

  test('digital zoom scales the preview, is baked into the recording, and can change while recording', async ({ page }) => {
    await page.addInitScript(() => {
      window.__draw = [];
      const o = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...a) { if (a.length === 9) window.__draw.push(a.slice(1, 5)); return o.apply(this, a); };
    });
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    await cameraSized(page);
    test.skip(await page.evaluate(() => cam.native), 'this browser offers real zoom');
    await page.evaluate(() => setZoom(2));
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('camera')).getPropertyValue('--z').trim())).toBe('2');
    await expect(page.locator('#zoomChip')).toHaveText('2.0×');
    await page.click('#btnRecord');
    await page.waitForFunction(() => R !== null && R.digital === true);
    await page.waitForTimeout(600);
    await page.evaluate(() => setZoom(3));
    expect(await page.evaluate(() => cam.zoom)).toBe(3);
    await page.waitForTimeout(600);
    const crop = await page.evaluate(() => { const v = document.getElementById('camera'); const d = window.__draw[window.__draw.length - 1]; return { sw: d[2], sh: d[3], vw: v.videoWidth, vh: v.videoHeight }; });
    expect(crop.sw).toBeCloseTo(crop.vw / 3, 0);
    expect(crop.sh).toBeCloseTo(crop.vh / 3, 0);
    await page.click('#btnRecord');
    await active(page, 'review');
    const meta = await page.evaluate(() => takesAll().then(a => ({ meta: a[0].meta, size: a[0].size })));
    expect(meta.meta.digital).toBe(true);
    expect(meta.meta.zoom).toBe(3);
    expect(meta.size).toBeGreaterThan(1000);
    await expect(page.locator('#reviewNote')).toContainText('digital zoom 3');
  });

  test("without real zoom, zoom can't be switched on part-way through a recording", async ({ page }) => {
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    await cameraSized(page);
    test.skip(await page.evaluate(() => cam.native), 'this browser offers real zoom');
    await page.click('#btnRecord');
    await page.waitForFunction(() => R !== null);
    await page.evaluate(() => setZoom(2));
    expect(await page.evaluate(() => cam.zoom)).toBe(1);
    await expect(page.locator('.toast')).toContainText("Zoom can't change during a recording");
  });

  test('when the camera offers real zoom it is used, and it can zoom out', async ({ page }) => {
    await page.addInitScript(() => {
      const P = MediaStreamTrack.prototype, oc = P.getCapabilities, oa = P.applyConstraints;
      P.getCapabilities = function () { const c = oc ? oc.call(this) : {}; return this.kind === 'video' ? Object.assign({}, c, { zoom: { min: 0.5, max: 5, step: 0.1 } }) : c; };
      window.__zoomCalls = [];
      P.applyConstraints = function (c) {
        if (c && c.advanced && c.advanced[0] && 'zoom' in c.advanced[0]) { window.__zoomCalls.push(c.advanced[0].zoom); return Promise.resolve(); }
        return oa.call(this, c);
      };
    });
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    await cameraSized(page);
    expect(await page.evaluate(() => cam.native)).toBe(true);
    await page.evaluate(() => setZoom(2.5));
    await page.evaluate(() => setZoom(0.4));
    expect(await page.evaluate(() => window.__zoomCalls)).toEqual([2.5, 0.5]);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('camera')).getPropertyValue('--z').trim())).toBe('1');
    await page.click('#btnRecord');
    await page.waitForFunction(() => R !== null);
    await page.evaluate(() => setZoom(1.5));
    expect(await page.evaluate(() => R.digital)).toBe(false);
    expect((await page.evaluate(() => window.__zoomCalls)).pop()).toBe(1.5);
    await page.click('#btnRecord');
    await active(page, 'review');
    const meta = await page.evaluate(() => takesAll().then(a => a[0].meta));
    expect(meta.nativeZoom).toBe(true);
    expect(meta.digital).toBe(false);
  });

  test('pinching the preview zooms', async ({ page }) => {
    await boot(page, { scripts: [script('a', words(300))] });
    await openPrompter(page);
    await cameraSized(page);
    test.skip(await page.evaluate(() => cam.native), 'this browser offers real zoom');
    await page.evaluate(() => {
      const t = document.getElementById('camBox');
      const fire = (type, id, x, y) => t.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true }));
      fire('pointerdown', 1, 150, 700); fire('pointerdown', 2, 250, 700);
      fire('pointermove', 2, 350, 700);      // fingers 100px apart -> 200px apart
      fire('pointerup', 1, 150, 700); fire('pointerup', 2, 350, 700);
    });
    expect(await page.evaluate(() => cam.zoom)).toBeCloseTo(2, 1);
  });
});
