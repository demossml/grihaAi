---
name: voice-intake
description: Turn voice messages into structured input. Use when the user sends a voice note and wants a reminder, note, commitment, expense or meeting action.
tags: [system, voice]
---

# Voice Intake

Voice is transcribed locally (faster-whisper) and never leaves the machine.

## Workflow
1. Call `transcribe_voice` with the local path or Telegram `fileId`.
2. Read the returned `confidence` / `uncertain`.
3. If the transcript is uncertain — ask the user to repeat or confirm. Never guess.
4. If confident, map the text to the requested workflow:
   - reminder → commitment (with due date) or cron note;
   - note → memory;
   - commitment → `commitment_add`;
   - expense → expense-intake workflow;
   - meeting action → commitment linked to the meeting.

## Rules
- Never infer critical numbers, dates, names or amounts from an uncertain transcript.
- If the transcript is empty or garbled, re-ask instead of proceeding.
- Do not claim a reminder/commitment was created unless the tool call succeeded.
