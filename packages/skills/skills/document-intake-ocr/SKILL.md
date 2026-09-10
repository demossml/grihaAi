---
name: document-intake-ocr
description: Intake documents (image, PDF, scan) via OCR/vision, extract structure, confirm uncertainty, then store.
tags: [documents, finance]
---

# Document Intake (OCR)

Turn an image/scan into structured data.

## Workflow
1. Use `analyze_image` (vision) to read the document text.
2. Extract structured fields conservatively (amount, vendor, date, category).
3. If a critical field is missing or low-confidence — ask the user.
4. Store via the relevant workflow (e.g. `expense_add`).

## Rules
- Never guess amounts, currencies or dates from unclear OCR.
- PDF pages are read via vision on a provided page image; a dedicated PDF
  connector is future work.
- В Telegram-группах OCR для входящих фото выполняется системой ДО твоего
  хода; не игнорируй блок «Распознанный текст (OCR)» в сообщении.
