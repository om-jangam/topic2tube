# Free Hindi AI-tools video pipeline — design

Date: 2026-10-07
Status: approved in conversation, awaiting written-spec review

## Goal

Make AgentTube reliably turn one topic into a finished 5–8 minute Hinglish
tutorial video plus 3 Shorts for the "Om Jangam" channel (AI tools explained in
Hindi), using only free APIs and open-source tools. When a step cannot be done,
the app says why instead of producing placeholder or template content.

### What the owner decided
- Free APIs and open-source tools only; no paid plans.
- AI voice only (no own-voice recording feature). Female voice.
- Visuals: free stock media plus free AI images, on clean text slides.
- Output: one long video (5–8 min) per topic, plus Shorts cut from it.
- Build on AgentTube (approach A), not a new tool.

### Assumptions (open to correction)
- About 1 video per day is enough; capacity for more is a bonus.
- Titles/slides/description in Roman Hinglish; spoken narration in Devanagari
  with English tech words kept in Latin script.
- Uploads stay manual through YouTube Studio (API uploads from an unaudited
  Google project are locked private).

### Constraints found
- Gemini free tier, per model per day: text ≈20 requests (gemini-3.7-flash),
  TTS 10 requests, image generation 0. Each model has its own quota.
- Free models verified working on this key (2026-10-07):
  text — gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash,
  gemini-3.5-flash-lite, gemini-3.1-flash-lite;
  TTS — gemini-3.1-flash-tts-preview, gemini-3.8-flash-tts,
  gemini-3.8-flash-lite-tts, gemini-2.5-flash-preview-tts.
- Free quotas reset at midnight Pacific (≈12:30–1:30 PM IST).
- PC: GTX 1650 (4 GB VRAM), 8 GB RAM, Python 3.12, Docker available. Too small
  for local image models; fine for a small local TTS model on CPU.
- Gemini 3.x "thinking" tokens count toward `maxOutputTokens`; small caps cut
  replies short (root cause of today's truncated script JSON).

## Design

### 1. Script writing (`utils/ai-text-service.js`, `agents/*`)
- Gemini model chain: configured model first, then gemini-3.6-flash →
  gemini-3.5-flash → gemini-3.5-flash-lite → gemini-3.1-flash-lite. Move on
  after retries for overload (5xx, dropped connection) or immediately on quota
  (429). Other errors stop the chain.
- Thinking headroom: Gemini requests get `maxOutputTokens = requested + 8192`.
- Script JSON shape (script-writer prompt):
  `title` (Roman Hinglish), `hook`, `sections[]` with `title`, `onScreen`
  (short Hinglish slide text), `narration` (Devanagari, tech terms in Latin),
  `visualQuery` (English stock-search words), `duration`; `cta`; `claims[]`.
  Target 900–1,200 spoken words.
- Narration text sent to TTS = hook + each section's `narration` + cta, with no
  "Section N:" labels.
- Strategy and SEO prompts use the channel profile's audience and voice and keep
  the requested topic's wording (already patched).
- No template fallback when an AI provider is configured: strategy, script and
  SEO failures fail the job with a plain reason. Templates remain only for the
  no-provider case.

### 2. AI voice (`utils/ai-video-generator.js`, new `scripts/kokoro_tts.py`)
- Gemini TTS chain over the four verified TTS models, female voice (`Kore`,
  overridable via `GEMINI_TTS_VOICE`). Narration is split into ≤1,200-character
  pieces (already patched).
- Voice consistency: if the model changes partway through a video, all pieces
  are re-narrated with the new model.
- Unlimited fallback: Kokoro (Apache-2.0, open source) running locally through a
  small Python helper called with `execFile`, female Hindi voice. Requires the
  `kokoro` Python package and espeak-ng. Used for the whole video when every
  Gemini TTS model is out of quota.
- Captions (SRT, Devanagari) built from narration timing for YouTube upload and
  for burned-in Shorts subtitles.
- If Kokoro also fails, the job stops with a reason; no silent videos.

### 3. Visuals (new `utils/stock-media.js`, `utils/pollinations.js`)
Per scene, using the scene's `visualQuery`:
1. Pexels video clip, as a new free provider in `utils/video-providers.js` so
   existing hybrid clip assembly is reused.
2. Pexels photo, with a slow zoom (FFmpeg `zoompan`) when used as a still.
3. Pollinations AI image (free; optional free key removes watermark and raises
   the rate limit).
4. Clean text slide.

- Slide text: the scene's `onScreen` line, large, on a darkened background.
- Thumbnail: best scene image plus 3–4 large Hinglish words, 1280×720.
- Description gets an automatic credit line ("Photos/videos: Pexels").
- New settings: `PEXELS_API_KEY` (required for stock), `POLLINATIONS_API_KEY`
  (optional). The owner enters keys; they never go in chat.

### 4. Reliability, Shorts, publishing
- Failed steps mark the job "needs attention" with a plain-language reason;
  the existing Retry resumes from the failed stage.
- Automated quality gate before review: narration is mostly Devanagari (not
  English filler), narration length 4.5–9 minutes, every scene has a real
  visual, no placeholder assets. Failures are flagged on the review screen.
- Daily automatic generation moves from 6 AM to 2 PM (after quota reset) and
  stays paused until the owner turns it on.
- Shorts: the existing Shorts studio proposes 3 vertical clips with burned-in
  captions; verify it end to end and fix what breaks.
- Publishing stays manual: download video and thumbnail from the dashboard,
  upload in YouTube Studio with the generated title/description.
- Remove the four broken test productions from the dashboard.

## Error handling summary
| Failure | Behaviour |
|---|---|
| Text model overloaded / out of quota | Next model in chain; all exhausted → job fails: "Free AI limits used today, try after ~1 PM" |
| TTS model out of quota | Next TTS model (re-narrate whole video); all exhausted → Kokoro |
| Kokoro fails | Job fails with reason |
| No Pexels match / key missing | Pollinations → text slide; flagged only if a scene ends with no visual |
| Quality gate fails | Video stays in review with the failed checks listed |

## Testing
- Unit tests (mocked providers) added to `test.js` for: model chains,
  quota/overload classification, narration splitting and re-narration on model
  switch, Kokoro fallback invocation, visual source order, quality gate,
  no-template-fallback behaviour.
- Self-test suite runs in an isolated copy so the real database stays clean.
- Acceptance run: one real topic produces a 5–8 minute Hinglish video with
  female AI narration, relevant visuals, a thumbnail, and 3 rendered Shorts,
  with no placeholder assets.

## Open risks (checked early during implementation)
- Kokoro pronunciation of mixed Devanagari/English text.
- Pexels search relevance for AI-tool topics.
- Pollinations watermark and terms for anonymous use.
- Per-model TTS quotas may differ from the 10/day observed.

## Out of scope
Own-voice recording, local image generation, YouTube API audit or automatic
public publishing, local LLMs (Ollama), paid providers.
