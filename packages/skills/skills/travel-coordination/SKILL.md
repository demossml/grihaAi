---
name: travel-coordination
description: Build a trip itinerary from confirmations, PDFs and screenshots; remind about the trip. Booking is not implemented.
tags: [travel]
---

# Travel Coordination

Keep trip details structured.

## Workflow
1. Ingest booking confirmations / PDFs / screenshots (OCR via `analyze_image`).
2. Save each item with `travel_item_add` (tripId, kind: flight/hotel/transfer,
   times, location).
3. Show the itinerary with `travel_itinerary(tripId)`.
4. Remind about the trip with `travel_list(days: 1)` — wire into a cron job for
   proactive reminders.

## Rules
- Booking is NOT implemented (`travel.book` absent): never claim a booking was
  made.
- Auto-booking requires a connector + approval in the future.
