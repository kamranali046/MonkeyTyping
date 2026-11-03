# Typing Test (MonkeyType-style)

A static typing test site built with plain HTML, CSS, and JavaScript. No backend. Deployable on Cloudflare Pages.

## Features
- Typing test with WPM, accuracy, raw WPM, and per-character feedback
- Modes: time (15/30/60/120s), words (10/25/50/100), sentence
- Random sentences picked from your sentence list
- Sentences are loaded from `sentences.txt` (one sentence per line); edit that file and redeploy to change the pool
- Settings: theme, font size, sound, punctuation, numbers, mode
- Results screen with WPM history chart
- Bubble typing game: words float in bubbles, type to burst them, score and lives
- All data stored in the browser (localStorage)

## Run locally
Open `index.html` in a browser, or serve the folder (recommended, so `sentences.txt` loads):

```
npx serve .
```

## Deploy to Cloudflare Pages
1. Push this folder (`typing-site`) to a Git repository (or upload directly).
2. In Cloudflare Pages, create a project and set the build output directory to `typing-site` (or upload the contents of `typing-site`).
3. No build command is required.
4. Deploy.

## Structure
- `index.html` - typing test
- `bubble.html` - bubble typing game
- `sentences.txt` - sentence pool (one sentence per line)
- `css/style.css` - styles and themes
- `js/storage.js` - settings persistence
- `js/app.js` - typing engine
