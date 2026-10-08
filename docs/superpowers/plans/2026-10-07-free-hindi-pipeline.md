# Free Hindi AI-tools Video Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One topic in → a 5–8 minute Hinglish tutorial video (female AI voice, matching visuals, thumbnail) plus 3 Shorts, using only free APIs and open-source tools, and a clear error instead of junk when something can't be done.

**Architecture:** Keep AgentTube's agents, dashboard, review and Shorts. The changes are:
- Harden the Gemini text and TTS calls with model chains.
- Add a local Kokoro TTS fallback.
- Replace image generation with a Pexels → Pollinations → text-slide visual finder.
- Assemble each script scene with its own visual through a new FFmpeg scene timeline.
- Gate output with stricter quality checks.

**Tech Stack:**
- Node 24 (CommonJS), `@google/genai`, `axios`, `sharp`, `ffmpeg-static`.
- Python 3.12 venv running `kokoro` (Apache-2.0) with espeak-ng.
- Pexels API (free key), Pollinations image API (free).

**Spec:** `docs/superpowers/specs/2026-10-07-free-hindi-pipeline-design.md`

## Global Constraints

**Platform and tooling**
- Branch `free-hindi-pipeline`; CommonJS `require`; no new npm dependencies.
- Python is used only inside `D:\youtube\.venv-kokoro`, which is git-ignored.

**Free and open source only**
- Gemini free tier, Pexels free key, Pollinations free, Kokoro (Apache-2.0), espeak-ng (GPL, separate install). No paid providers.

**Secrets and safety**
- Keys live only in `.env` (`PEXELS_API_KEY`, optional `POLLINATIONS_API_KEY`). Keys are never logged and never put in URLs written to logs.
- The server stays bound to `HOST || 127.0.0.1`.

**Models**
- Text chain, configured model first, then: `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`.
- Gemini text requests use `maxOutputTokens = requested + 8192`.
- TTS chain, `GEMINI_TTS_MODEL` first, then: `gemini-3.1-flash-tts-preview`, `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, `gemini-2.5-flash-preview-tts`. Each TTS piece is ≤ 1,200 characters.

**Voice**
- Female voice: Gemini `GEMINI_TTS_VOICE || 'Kore'`; Kokoro `KOKORO_VOICE || 'hf_alpha'`, lang code `h`.

**Language and content**
- Title, `onScreen`, description and `thumbnailText` are Roman Hinglish.
- `narration` is Devanagari, with English tech words kept in Latin script.
- `visualQuery` is English.
- Long video target is 900–1,200 spoken words. The quality gate passes narration audio of 270–540 seconds.

**Output formats**
- Long video: 1920×1080, 30 fps, H.264, yuv420p.
- Thumbnail: 1280×720 JPEG.
- Shorts: existing 1080×1920 output, subtitles in font `Nirmala UI`.

**Behaviour**
- Daily auto-generation runs at `0 14 * * *` local time and stays paused by default (`automation_paused=true` is already set).
- When an AI provider is configured, strategy, script and SEO never fall back to templates.

**Tests**
- Every task adds checks to `test.js` as `SystemTest` methods registered in the `tests` array.
- `TEST_FILTER=<substring> npm test` runs the matching checks.
- The full `npm test` must stay green.

## Review Focus

1. **Topic and title text with `& < > " ' – ? ( )` and Devanagari.** File names, SVG overlays, FFmpeg filter args and thumbnails must render it literally. Pinned in Task 8 (overlay) and Task 9 (thumbnail).
2. **Pexels misbehaving.** No results, 401 (bad key), 429, or no key at all → fall through to Pollinations, then to a slide; the job still finishes. Pinned in Task 7.
3. **One huge AI narration paragraph with no punctuation.** Every TTS piece is still ≤ 1,200 characters and no words are lost. Pinned in Task 6.
4. **Audio length mismatch.** Real audio much shorter or longer than estimated, or a scene with empty narration → no zero or negative segment durations, and segment durations sum to the audio length. Pinned in Task 8.
5. **Free limits exhausted mid-job.** Text or TTS out of quota → the job fails with a readable reason (or uses Kokoro for TTS), never a template script or a placeholder video. Pinned in Tasks 4 and 6.

---

### Task 1: Test harness and baseline

**Files:**
- Modify: `database/db.js:7-8` (constructor)
- Modify: `test.js` (top of file; `runAllTests` loop at ~line 74)
- Modify: `.gitignore`

**Interfaces:**
- Produces:
  - `Database` reads `process.env.AGENTTUBE_DB_PATH` when set.
  - `TEST_FILTER` env filters test names (case-insensitive substring).

- [ ] **Step 1: Commit the existing working-tree patches as the baseline.** Stage the already-modified files plus `utils/transient-retry.js`, then commit.
  - Exclude `.env`, `config/credentials.json` and `config/tokens.json`; they are ignored already.
  - Commit message: `Harden AgentTube: local-only server, escaping, Gemini retries and fallback, TTS chunking, security updates`.
- [ ] **Step 2: Make the database path configurable.** In `database/db.js`, set `this.dbPath = process.env.AGENTTUBE_DB_PATH || <existing default>`.
- [ ] **Step 3: Make the tests use a throwaway database.** At the very top of `test.js`, before any `require` of `./database/db`, set `process.env.AGENTTUBE_DB_PATH` to `path.join(os.tmpdir(), \`agenttube-test-${process.pid}.db\`)` unless it is already set.
- [ ] **Step 4: Add the test filter.** In `runAllTests`, filter `tests` by `process.env.TEST_FILTER` (case-insensitive `name.includes`). Print `Filter: <value> (<n> of <total>)` when a filter is set.
- [ ] **Step 5: Ignore the Kokoro venv.** Add `.venv-kokoro/` to `.gitignore`.
- [ ] **Step 6: Verify.**
  - Note the real DB's size: `ls -l data/youtube_automation.db`.
  - Run `npm test`. Expected: `Passed: 47`, `Failed: 0`.
  - Check `data/youtube_automation.db`: its modified time and size are unchanged.
  - Run `TEST_FILTER=database npm test`. Expected: only checks with "Database" in the name run.
- [ ] **Step 7: Commit:** `test: isolate test database and add TEST_FILTER`

### Task 2: Gemini text chain hardening

**Files:**
- Modify: `utils/ai-text-service.js`
  - `GEMINI_FALLBACK_MODELS`
  - `_generateGeminiWithFallback(prompt, model, maxTokens, temperature)`
- Test: `test.js` (new method `testGeminiModelChain`, registered as `'Gemini Model Chain'`)

**Interfaces:**
- Consumes: `retryTransient`, `isTransientError`, `isQuotaError` from `utils/transient-retry.js`.
- Produces: `AITextService.generateText(prompt, { maxTokens, temperature }) -> Promise<string>` (unchanged signature).

- [ ] **Step 1: Write the failing test `testGeminiModelChain`.** Build the service with `Object.create(AITextService.prototype)`, a fake `gemini.models.generateContent` recording `{ model, config }`, and a stub logger. Pass a sleep stub so no real waits occur: add an optional `this.retryOptions` that the service passes to `retryTransient`.
  - A 429 on `gemini-3.7-flash` → result comes from `gemini-3.6-flash`. Models tried, in order: `['gemini-3.7-flash','gemini-3.6-flash']`.
  - 503 three times on `gemini-3.7-flash` → the next model is used. `gemini-3.7-flash` is called exactly 3 times.
  - A 400 error → rejects after 1 call total.
  - Every recorded `config.maxOutputTokens === 50 + 8192` when `maxTokens: 50`.
  - All models return 429 → rejects. The error message contains `429`.
- [ ] **Step 2: Watch it fail.** Run `TEST_FILTER="Gemini Model Chain" npm test`. Expected: FAIL. The chain stops at `gemini-3.5-flash-lite` and headroom is missing.
- [ ] **Step 3: Implement the chain.**
  - Set `GEMINI_FALLBACK_MODELS` to `['gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite']`.
  - Set `maxOutputTokens` to `maxTokens + 8192`.
  - Pass `this.retryOptions` (default `{}`) into `retryTransient`.
- [ ] **Step 4: Watch it pass.** Run the same command. Expected: PASS. Then run `npm test`; all checks pass.
- [ ] **Step 5: Commit:** `feat: wider free Gemini model chain with thinking headroom`

### Task 3: Shared script scenes and the Hinglish script format

**Files:**
- Create: `utils/script-scenes.js` (moves `textFromSection` and `scriptScenes` out of `utils/scene-repair-service.js:9-64`)
- Modify: `utils/scene-repair-service.js` (import from the new module)
- Modify: `agents/script-writer-agent.js`
  - The prompt in `generateScriptWithAI`, around line 108.
  - `normalizeAISections`.
  - The AI return object: `introduction` and `conclusion` become `null`; `callToAction` comes from the AI.
- Modify: `agents/production-management-agent.js` (`formatScriptForTTS`, line 157)
- Test: `test.js` → `'Hinglish Script Scenes'`

**Interfaces:**
- Produces:
  - `scriptScenes(script) -> Array<{ label: string, scriptText: string, onScreen: string, visualQuery: string, prompt: string }>`. Labels are `'Hook'`, then each section title, then `'Call to action'`. Empty `scriptText` scenes are dropped.
  - AI section shape: `{ type:'ai_generated', title, content:[narration], narration, onScreen, visualQuery, duration }`.
  - Script top level gains `thumbnailText` (Roman Hinglish, ≤ 4 words).
  - `formatScriptForTTS(script) -> string` equals `scriptScenes(script).map(s => s.scriptText).join('\n\n')`.

- [ ] **Step 1: Write the failing test `testHinglishScriptScenes`.** Use a fixture with `hook: { text: 'नमस्ते दोस्तों!' }`, `introduction: null`, `conclusion: null`, two sections with `narration`, `onScreen` and `visualQuery`, and `callToAction: { subscribe: 'Channel subscribe करो' }` (other fields absent).
  - `scriptScenes` labels equal `['Hook', <s1 title>, <s2 title>, 'Call to action']`.
  - `scene.onScreen` and `scene.visualQuery` are carried through.
  - `formatScriptForTTS` contains no `Section`, no `welcome back`, and no `Like this video`.
  - `normalizeAISections([{ title, narration, onScreen, visualQuery, duration: 70 }])[0].content` equals `[narration]`.
- [ ] **Step 2: Watch it fail.** Run `TEST_FILTER="Hinglish Script" npm test`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - Create `utils/script-scenes.js` and have `scene-repair-service` import from it, so its existing tests are unchanged.
  - `scriptScenes` reads `section.onScreen || section.title` and `section.visualQuery || section.title`.
  - The Call-to-action scene joins only truthy strings.
  - Rewrite the script prompt's JSON shape and rules to match the spec: `title`, `thumbnailText`, `hook`, `sections[{title,onScreen,narration,visualQuery,duration}]` (5–7 sections), `cta`, `claims`.
    - Narration rule: Devanagari, with English tech words in Latin; 900–1,200 spoken words in total.
    - On AI scripts: `introduction` and `conclusion` are `null`; `callToAction` is `{ type:'call_to_action', subscribe: <cta text> }`.
  - Set script `maxTokens` to `4000`.
- [ ] **Step 4: Watch it pass.** Run the filter command, then `npm test`. Both pass.
- [ ] **Step 5: Commit:** `feat: Hinglish script format with per-scene narration, slide text and visual query`

### Task 4: No silent template fallback

**Files:**
- Modify: `agents/content-strategy-agent.js` (`generateContentStrategy`, line 229, plus its AI catch)
- Modify: `agents/script-writer-agent.js` (`generateScript` and the AI catch, around line 175)
- Modify: `agents/seo-optimizer-agent.js` (`optimize` and the AI catch)
- Test: `test.js` → `'No Template Fallback With AI'`

**Interfaces:**
- Produces: when `aiTextService.isAvailable()` is true and the AI call fails, each agent rejects. The error is `AiStepError`, with `error.code === 'AI_STEP_FAILED'` and message `"<Step> failed: <reason>. Free Gemini limits may be used up — try again after about 1 PM."`. Export `AiStepError` from `utils/transient-retry.js`.
- Unchanged: with no AI provider, the templates still run.

- [ ] **Step 1: Write the failing test.** Construct each agent with a stub DB (`saveScript` etc. resolving) and an `aiTextService` stub whose `isAvailable` returns true and whose `generateText` rejects with a 429 error.
  - Assert that each of `generateContentStrategy('x')`, `generateScript(strategy)` and `optimize(script, strategy)` rejects with `code === 'AI_STEP_FAILED'`.
  - Repeat with `isAvailable` returning false. Each resolves, and the script result has no `generationSource: 'ai'`.
- [ ] **Step 2: Watch it fail.** Run `TEST_FILTER="No Template Fallback" npm test`. Expected: FAIL. The agents resolve with templates.
- [ ] **Step 3: Implement.** In each AI catch, rethrow `new AiStepError(stepName, error)` when the AI is available. Keep the template path only for the no-provider case.
- [ ] **Step 4: Verify the job reason is visible.** Using the test DB, run a manual-generation job with the failing stub through `index.js` `startGenerationJob` in the same test. Assert that the job ends `status: 'failed'` and `job.error` contains `Free Gemini limits`. Run the filter command; expected: PASS.
- [ ] **Step 5: Run `npm test`. Then commit:** `feat: fail with a clear reason instead of template scripts when AI is configured`

### Task 5: Kokoro local Hindi voice (spike, then helper)

**Files:**
- Create: `scripts/kokoro_tts.py`
- Create: `utils/kokoro-tts.js`
- Modify: `.env.example` (add `KOKORO_PYTHON`, `KOKORO_VOICE=hf_alpha`)
- Test: `test.js` → `'Kokoro Wrapper'`

**Interfaces:**
- Produces:
  - `synthesizeWithKokoro(text: string, outputPath: string, options?: { voice?: string, python?: string, execFileImpl?: Function }) -> Promise<string>`. It writes the text to a temp UTF-8 file, runs `python scripts/kokoro_tts.py --text-file <tmp> --out <outputPath> --voice <voice> --lang h` via `execFile` (args array, no shell, timeout 20 minutes), and resolves to `outputPath`.
  - `isKokoroAvailable(options?) -> Promise<boolean>`. Runs `python -c "import kokoro"`.
  - The Python path is `process.env.KOKORO_PYTHON || 'D:\\youtube\\.venv-kokoro\\Scripts\\python.exe'`.

- [ ] **Step 1 (spike): Install Kokoro.**
  - Create the venv: `py -3.12 -m venv D:\youtube\.venv-kokoro`.
  - Install the packages: `D:\youtube\.venv-kokoro\Scripts\python -m pip install kokoro soundfile`.
  - Install espeak-ng from the official GitHub release MSI. Ask the owner before downloading.
  - If Kokoro can't find the library, set `PHONEMIZER_ESPEAK_LIBRARY` to the installed `libespeak-ng.dll`.
- [ ] **Step 2 (spike): Write `scripts/kokoro_tts.py` and produce a sample.**
  - The script uses `KPipeline(lang_code='h')`, concatenates the generated chunks, and writes 24 kHz mono WAV with `soundfile`.
  - Generate `data/audio/kokoro_sample.wav` from: `नमस्ते दोस्तों! आज हम सीखेंगे कि Gemini app में free AI Pro कैसे activate करें।`
  - Report the generation time to the owner and ask them to listen.
  - **Decision gate:** if Hindi plus the English words sound clearly wrong or the install fails, stop. Report back, and propose Piper `hi_IN` as the replacement before continuing.
- [ ] **Step 3: Write the failing test `testKokoroWrapper`.** Use a fake `execFileImpl` that records `(file, args, options)`, writes a 1-second silent WAV to the `--out` path, and calls back with success.
  - `file` is the configured python.
  - `args` include `'--voice','hf_alpha','--lang','h'`.
  - `options.shell` is not true.
  - The temp text file content equals the input text exactly (UTF-8, Devanagari preserved).
  - The promise resolves to `outputPath`.
  - A fake that calls back with an error → the promise rejects with a message starting `Kokoro TTS failed:`.
- [ ] **Step 4: Watch it fail, implement `utils/kokoro-tts.js`, watch it pass.** Run `TEST_FILTER="Kokoro" npm test`.
- [ ] **Step 5: Commit:** `feat: local Kokoro Hindi TTS helper` (the venv is not committed).

### Task 6: TTS model chain with a consistent voice

**Files:**
- Modify: `utils/ai-video-generator.js`
  - `generateGeminiTTS(text, outputPath)` around line 173.
  - The `generateTTSAudio` Gemini branch, around line 89.
- Test: `test.js` → `'TTS Chain Consistency'`

**Interfaces:**
- Consumes:
  - `splitNarration(text, maxChars=1200)` (exported).
  - `synthesizeWithKokoro`.
  - `isQuotaError` and `isTransientError`.
- Produces:
  - `GEMINI_TTS_MODELS` (exported).
  - `generateGeminiTTS(text, outputPath) -> Promise<{ path, model }>`.
  - `lastNarrationResult.provider` is `'gemini'` or `'kokoro'`, and `.model` is the model that produced *all* pieces.

- [ ] **Step 1: Write the failing test.** Stub `gemini.models.generateContent` to return 0.1 s of PCM per call, recording `model` and piece text. Stub `runFFmpeg` with a test injection seam: a `this.runFFmpegImpl` default, so the test writes a dummy file. Stub Kokoro via `this.kokoroImpl`.
  - (a) A 2,600-character narration → 3 calls, all with the same model.
  - (b) A 429 on the first model's 2nd piece → that model's pieces are discarded. All final pieces come from `gemini-3.8-flash-tts`, and `lastNarrationResult.model === 'gemini-3.8-flash-tts'`.
  - (c) Every TTS model returns 429 → `kokoroImpl` is called once with the full text, and `provider === 'kokoro'`.
  - (d) Kokoro also fails → `generateTTSAudio` rejects, and the message contains `Kokoro`.
  - (e) Review Focus #3: one 5,000-character string with no punctuation → every piece is ≤ 1,200 characters, and the joined pieces equal the input with whitespace normalised.
- [ ] **Step 2: Watch it fail.** Run `TEST_FILTER="TTS Chain" npm test`.
- [ ] **Step 3: Implement.**
  - Iterate the models.
  - For each model, narrate every piece (each piece wrapped in `retryTransient`).
  - On a quota error, or a transient error after retries, move to the next model and drop the collected PCM.
  - When all models are exhausted, call Kokoro on the full text; it produces WAV, which is encoded to the output with FFmpeg.
  - When Kokoro fails, reject.
  - Remove the simulated-audio path for the AI-configured case.
  - Measure the finished file with `getMediaDuration`, set `lastNarrationResult.duration` (seconds), and make sure the production stores it as `assets.audio.duration`. Assert `duration > 0` in test (a).
- [ ] **Step 4: Watch it pass, then run `npm test`.**
- [ ] **Step 5: Commit:** `feat: TTS model chain with consistent voice and Kokoro fallback`

### Task 7: Free scene visuals (Pexels → Pollinations → slide)

**Files:**
- Create: `utils/stock-media.js`
- Create: `utils/pollinations.js`
- Create: `utils/scene-visuals.js`
- Modify: `.env.example` (add `PEXELS_API_KEY=`, `POLLINATIONS_API_KEY=`)
- Test: `test.js` → `'Scene Visual Sources'`

**Interfaces:**
- `stock-media.js`:
  - `searchPexelsVideo(query, { apiKey, http, minDuration=5 }) -> Promise<{ id, pageUrl, fileUrl, width, height, duration, credit } | null>`. Uses landscape orientation. Picks the smallest file with width ≥ 1280.
  - `searchPexelsPhoto(query, { apiKey, http }) -> Promise<{ id, pageUrl, fileUrl, credit } | null>`. Uses `src.large2x`.
  - `downloadTo(url, outputPath, { http }) -> Promise<string>`.
  - A missing key returns `null` without any request. HTTP 401, 429 or 5xx returns `null` and logs the status code only.
- `pollinations.js`:
  - `generatePollinationsImage(prompt, outputPath, { apiKey, http, width=1920, height=1080, now, sleep }) -> Promise<string>`.
  - Without a key, keeps ≥ 15 s between requests.
  - With a key, sends it as `Authorization: Bearer` and requests `nologo=true`.
- `scene-visuals.js`:
  - `findSceneVisual(scene, { index, outputDir, env, http, sleep }) -> Promise<{ type: 'video'|'image'|'slide', path, source: 'pexels'|'pollinations'|'slide', credit: string|null }>`.
  - Order: Pexels video → Pexels photo → Pollinations (prompt = `visualQuery` plus `", clean modern illustration, no text"`) → a slide PNG via `sharp`. The slide is 1920×1080 dark gradient with `onScreen` as escaped SVG text.

- [ ] **Step 1: Write the failing test.** Use a fake `http` (`get` resolving per-URL fixtures or rejecting with `{ response: { status } }`).
  - (a) Video found → `{ type: 'video', source: 'pexels' }`, and the file is written.
  - (b) Video search returns `[]` and a photo is found → `type: 'image'`, `source: 'pexels'`.
  - (c) Pexels 401 on both searches → Pollinations is used.
  - (d) No `PEXELS_API_KEY` → zero Pexels requests are made, and Pollinations is used.
  - (e) Pollinations rejects → `type: 'slide'`. The PNG exists and is 1920×1080, via `sharp(...).metadata()`.
  - (f) Two anonymous Pollinations calls → the injected `sleep` received ≥ 15000 ms in total.
  - (g) Logged messages never contain the key string.
- [ ] **Step 2: Watch it fail.** Run `TEST_FILTER="Scene Visual" npm test`.
- [ ] **Step 3: Implement the three modules.** Use the Pexels endpoints `https://api.pexels.com/videos/search` and `https://api.pexels.com/v1/search`, with an `Authorization: <key>` header and `per_page=10`.
- [ ] **Step 4: Watch it pass, then run `npm test`.**
- [ ] **Step 5: Commit:** `feat: free scene visuals from Pexels and Pollinations with slide fallback`

### Task 8: Scene timeline renderer and production wiring

**Files:**
- Create: `utils/scene-timeline.js`
- Modify: `utils/ai-video-generator.js` (`generateVideo`, line 367: use the timeline when `options.sceneVisuals` is provided)
- Modify: `agents/production-management-agent.js`
  - `generateVideoContent`: use `scriptScenes` and `findSceneVisual`, and store `assets.video.sceneVisuals`.
  - Pass the scene visuals into `assembleVideo` → `generateVideo`.
- Test: `test.js` → `'Scene Timeline'`

**Interfaces:**
- Consumes:
  - `scriptScenes`.
  - `findSceneVisual` results.
  - `getMediaDuration`, `runFFmpeg`.
  - `escapeXML`: move it to `utils/text-escape.js` and reuse it in the thumbnail agent.
- Produces:
  - `planTimeline(scenes, audioSeconds) -> Array<{ label, duration }>`. Durations are proportional to the word count of `scriptText`, each at least 2 s, and the sum equals `audioSeconds` within 0.05 s.
  - `renderSceneTimeline(segments, outputPath) -> Promise<string>`. Each segment is `{ label, duration, visual: { type, path }, onScreen }`.
    - Video segments are looped or trimmed, then scaled to cover 1920×1080.
    - Images use `zoompan` with a slow 1.0 → 1.08 zoom.
    - Slides are shown static.
    - `onScreen` is a bottom caption PNG (sharp SVG, escaped) overlaid on top.
    - All segments are concatenated.
  - `generateVideo` sets `lastVideoResult.scenes` to `[{ index, label, duration, path, provider: visual.source, model: null, taskId: null }]` in `scriptScenes` order, so `buildInitialSceneManifest` matches by label.

- [ ] **Step 1: Write the failing test.**
  - `planTimeline` with scene word counts `[10, 30, 0+]` (an empty scene is dropped earlier) and `audioSeconds = 41` → every duration is ≥ 2, the sum is 41 ± 0.05, and the durations rise with word count.
  - Review Focus #4: `audioSeconds = 3` with 4 scenes → durations sum to 3. With minimums impossible, scale down evenly, and no duration is ≤ 0.
  - Render with fixtures: one 2 s test video made via `runFFmpeg(['-f','lavfi','-i','testsrc=size=640x360:rate=30','-t','2',...])`, one 640×360 PNG, and one slide.
    - Segment durations are `[1.5, 1.5, 1]`.
    - `onScreen` is `'Tips & Tricks <2026> "Free" – क्या?'` (Review Focus #1).
    - The output exists; `getMediaDuration` is 4 ± 0.2; the ffprobe width is 1920.
- [ ] **Step 2: Watch it fail.** Run `TEST_FILTER="Scene Timeline" npm test`.
- [ ] **Step 3: Implement `utils/scene-timeline.js` and wire the production flow.**
  - Order: visuals → audio → measure the audio duration → `planTimeline` → render → add audio (existing `addAudioToVideo`).
  - Remove the "simulate visuals" path for the AI-configured case.
  - Make `generateCaptions` write the YouTube SRT from the same `planTimeline` output: one cue per scene, using that scene's `scriptText` (Devanagari), split into cues of ≤ 84 characters spread evenly across the scene. Add one assertion to this task's test: the SRT for the fixture has its cue end times ascending and its last cue ending at `audioSeconds ± 0.05`.
- [ ] **Step 4: Watch it pass, then run `npm test`.** The existing slideshow and hybrid checks must still pass.
- [ ] **Step 5: Commit:** `feat: scene-aligned video timeline with stock visuals and slide text`

### Task 9: Thumbnail and credits

**Files:**
- Modify: `agents/thumbnail-designer-agent.js`
  - New `composeThumbnail({ backgroundPath, text, outputPath })`.
  - Use `utils/text-escape.js`.
- Modify: `agents/production-management-agent.js`. After the visuals exist, rebuild `assets.thumbnail` from the first scene visual of type `image` (or a frame grabbed from the first `video` via FFmpeg `-ss 1 -frames:v 1`), with `text = script.thumbnailText || first 4 words of title`.
- Modify: `agents/seo-optimizer-agent.js`. Append credit lines when any scene visual used Pexels (`Photos/videos: Pexels (https://www.pexels.com)`) or Pollinations (`AI images: Pollinations (https://pollinations.ai)`).
- Test: `test.js` → `'Thumbnail And Credits'`

**Interfaces:**
- Produces:
  - `composeThumbnail({ backgroundPath, text, outputPath }) -> Promise<{ path, width: 1280, height: 720 }>`.
  - `appendMediaCredits(description, sceneVisuals) -> string`. It is idempotent: credits are never duplicated.

- [ ] **Step 1: Write the failing test.**
  - `composeThumbnail` with a 640×360 PNG background and `text = 'FREE AI PRO & <Jio>!'` (Review Focus #1) → a JPEG of 1280×720; it does not throw.
  - `appendMediaCredits('Desc', [{ source: 'pexels' }, { source: 'slide' }])` contains the Pexels line once and no Pollinations line. Calling it twice yields the same string.
- [ ] **Step 2: Watch it fail.** Run `TEST_FILTER="Thumbnail And Credits" npm test`.
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Watch it pass, then run `npm test`.**
- [ ] **Step 5: Commit:** `feat: thumbnails from scene visuals and automatic media credits`

### Task 10: Quality gate

**Files:**
- Modify: `utils/operator-service.js` (`runQualityChecks`, line 11)
- Test: `test.js` → `'Hindi Quality Gate'`

**Interfaces:**
- Consumes:
  - `production.assets.audio.duration` (seconds; set it in Task 6 from `getMediaDuration`).
  - `production.assets.video.sceneVisuals`.
  - `formatScriptForTTS`.
- Produces three new checks, all blocking unless noted:
  - `narration_language`: Devanagari letters are ≥ 50% of all letters in the TTS text.
  - `narration_length`: audio duration is within 270–540 s. **Non-blocking.**
  - `scene_visuals`: every scene has a visual file on disk. Slides make up ≤ 40% of scenes, otherwise it fails as a warning (non-blocking).

- [ ] **Step 1: Write the failing test.**
  - An English template narration fails `narration_language`.
  - A Devanagari narration passes it.
  - 120 s fails `narration_length` and is non-blocking; 400 s passes.
  - A missing scene file fails `scene_visuals`.
- [ ] **Step 2: Watch it fail, implement, watch it pass, then run `npm test`.** Use `TEST_FILTER="Hindi Quality" npm test`.
- [ ] **Step 3: Commit:** `feat: Hindi narration, length and visual quality gate`

### Task 11: Schedule, settings and cleanup

**Files:**
- Modify: `schedules/daily-automation.js:33` (`'0 6 * * *'` → `'0 14 * * *'`, with the comment updated)
- Modify: `walkthrough.js` (the step 6 "Next steps" text: "generates automatically every day at 2 PM")
- Modify: `.env` (owner adds `PEXELS_API_KEY`; optional `POLLINATIONS_API_KEY`). The owner pastes the keys themselves.
- Test: `test.js` → `'Daily Schedule Time'`

- [ ] **Step 1: Write the failing test.**
  - Before constructing `DailyAutomation`, replace `require('node-cron').schedule` with a recorder that returns `{ start(){}, stop(){} }`.
  - Call `setupScheduledTasks()`.
  - Restore the original `schedule`.
  - Assert the recorded expression for the first task, `daily-content-generation`, is `'0 14 * * *'`.
- [ ] **Step 2: Watch it fail, implement, watch it pass.** Run `TEST_FILTER="Daily Schedule" npm test`.
- [ ] **Step 3: Owner adds the keys.** Ask the owner to create a free Pexels key at pexels.com/api and paste it into `.env` as `PEXELS_API_KEY=` in the editor. Never ask for it in chat. Restart the app.
- [ ] **Step 4: Reject the four broken productions** via `POST /api/content/:id/reject`, with note `Broken test run before free pipeline fixes`. Verify that the dashboard pipeline shows them as rejected.
- [ ] **Step 5: Commit:** `chore: generate daily at 2 PM after free quota reset`

### Task 12: Shorts with Hindi captions

**Files:**
- Modify: `utils/shorts-repurposing-service.js` (`videoFilter`: `FontName=Arial` → `FontName=Nirmala UI`)
- Test: `test.js` → `'Shorts Hindi Captions'`

- [ ] **Step 1: Write the failing test.** `new ShortsRepurposingService(...).videoFilter('blur', 'C:/x/c.srt')` contains `FontName=Nirmala UI` and does not contain `FontName=Arial`.
- [ ] **Step 2: Watch it fail, implement, watch it pass.** Run `TEST_FILTER="Shorts Hindi" npm test`. Then run `npm test`; the existing "Shorts Repurposing Studio" check still passes.
- [ ] **Step 3: Commit:** `fix: Devanagari-capable font for Shorts captions`

### Task 13: Acceptance run

- [ ] **Step 1: Restart the app.** Stop it, run `npm start`, and check that `/health` reports `healthy`.
- [ ] **Step 2: Queue the topic** `Jio users ko FREE Google AI Pro kaise milega? (18 mahine) – Step by Step` via `POST /generate` (`style: tutorial`, `length: medium`). Poll `/api/jobs/:id` until it is terminal.
- [ ] **Step 3: Verify the result.**
  - The job `completed` with no template fallback in the logs.
  - The narration is mostly Devanagari.
  - `getMediaDuration(final)` is 270–540 s.
  - Video 1920×1080 with an audio stream.
  - Scene visuals: at least 60% are Pexels or Pollinations.
  - Thumbnail is 1280×720.
  - The description has the credits.
  - All blocking quality checks pass.
- [ ] **Step 4: Make the Shorts.** In the dashboard Shorts studio (or `POST /api/content/:id/shorts/propose`, then render each), create 3 Shorts. Each Short renders a 1080×1920 MP4 with captions visible. Check a frame with `ffmpeg -ss 5 -frames:v 1`.
- [ ] **Step 5: Hand over to the owner.** Show the video and one Short. Report the actual results, including anything that missed the targets.
- [ ] **Step 6: Commit any fixes found. Then run the final `npm test`.** Expected: all checks pass.
