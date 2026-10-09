# PromptCam

A free teleprompter that records you while you read. It is a plain website (no accounts, no server, no cost) that installs to a phone's Home Screen and works offline.

## What it does

- **Scripts**: write, import a `.txt` file, duplicate, search. Saved on the device as you type.
- **Reading engine**: speed is real words per minute. The line you are reading sits on a fixed reading band near the top of the screen, close to the camera lens.
- **Four pacing modes**
  - *Speed*: fixed words per minute.
  - *Timed*: set a target time and the speed is worked out for you.
  - *Voice-paced*: scrolls while you speak, waits when you stop.
  - *Voice-follow*: follows your actual words where the browser supports speech recognition, and switches to Voice-paced automatically where it doesn't.
- **Pause markers**: type `[PAUSE]` or `[PAUSE 3]` in a script to hold for a breath.
- **Rehearse** without recording, **drag the text** to move through it, restart, and change text size, position and pacing from the camera screen.
- **Recording**: starts only when you tap Record. 720p, 1080p or Maximum (4K where the phone allows), 30 or 60 fps, hold and resume, countdown, torch, camera switch.
- **Exact preview and zoom**: the preview shows precisely the picture that gets recorded (or "Fill screen" if you prefer). Pinch, or use the 1.0× button, to zoom. It uses the camera's own zoom where the browser allows it, and a digital crop otherwise.
- **Microphone control**: studio (unprocessed) or cleaned-up sound, a microphone picker for external mics, and a level check. The Camera and mic tab also shows what the phone is really delivering.
- **Takes**: every recording is kept on the device until you delete it. Save to Photos or Files, and download captions (`.srt`) timed to your read.
- **Keyboard and Bluetooth remotes**: Space or Page Down to start/stop scrolling, R to record, Up/Down for speed, Left/Right to move a line, Home to restart.

## Putting it online (GitHub + Vercel)

1. Create a repository on GitHub and push this whole folder to it.
2. In Vercel choose **Add New → Project** and import the repository.
3. Set **Root Directory** to `prompcam-web`. Leave the framework as "Other" with no build command.
4. Deploy. Every later push to GitHub redeploys automatically.

To ship an update, change the number in `prompcam-web/version.js`. That one number is shown in Settings and tells phones a new version is ready.

## Using it on an iPhone

Open the site in **Safari** (not Chrome: on iPhone only Safari may run a site full screen), tap **Share → Add to Home Screen**, and open it from that icon. Allow camera and microphone when asked.

The first visit needs a connection. After that it runs with none.

## Tests

`tests/app.spec.js` drives the real app in a browser with a synthetic camera and microphone: speed accuracy, the reading line, pacing modes, recording, takes, layout on four screen sizes, and offline use.

They run automatically on GitHub on every push (see `.github/workflows/tests.yml`), so nothing needs installing on your own computer. To run them locally anyway:

```
npm ci
npx playwright install chromium
npm test
```

## Files

```
prompcam-web/        the site itself; this folder is what gets deployed
  index.html         screens and styling
  app.js             all behaviour
  version.js         the build number
  sw.js              offline support
  manifest.json      Home Screen install details
tests/               automated checks
```

## Video and sound quality

A website can't match the phone's built-in Camera app: it gets a plainer feed from the browser (no HDR or the phone's extra processing) and Safari decides the resolution it will hand over. PromptCam asks for the best the phone offers and records at 16 Mbps by default, but check "Camera and mic" and the line under each take to see what you actually got.

If sound is quiet: open Camera and mic, run the microphone check, and choose your external microphone from the list.

## Known limits

- Scripts and takes live in the browser's storage on one device. Export scripts from Settings now and then, and save takes you care about to Photos or Files.
- Long recordings are held in memory until you stop. Higher quality uses more (about 60, 120 and 260 MB a minute for 720p, 1080p and Maximum), so very long takes can exhaust a phone; use 720p for long sessions.
- Many iPhone browsers don't let websites zoom the lens. There zoom crops the picture, which looks a little softer, and can only be changed before recording starts.
- Voice-follow depends on the browser's speech recognition, which on iPhone can refuse to run alongside video recording. The app detects that and falls back to Voice-paced.
