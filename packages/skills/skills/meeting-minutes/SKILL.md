---
name: meeting-minutes
description: Generate a meeting minutes document. Use when the user provides a meeting recording or transcript and asks for meeting notes or minutes.
tags: [report, meetings]
---

# Meeting Minutes

Generate meeting minutes from a meeting recording or transcript.

## Mandatory procedure
1. If the user sent a **voice recording**, first transcribe it to text (use the STT tool). Do not summarize the audio directly.
2. Then call the tool exactly like this:

   `generate_report(reportType: "meeting-minutes")`

   with the transcript text as the tool's input.

3. Return the generated file to the user.

## Format policy (mandatory)
- The minutes layout, sections and structure are **fixed by the template**.
- You **must not** change the layout, section order, or structure — only fill in the data.
- Do not write meeting minutes by hand. Always use `generate_report` after transcription.
