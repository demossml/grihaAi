---
name: anomaly-watch
description: Detect anomalies (overdue commitments, duplicate invoices, expense spikes) with evidence and explanation — never flag mere differences.
tags: [proactive, finance, monitoring]
---

# Anomaly Watch

Detect anomalies with a baseline/threshold, evidence and an explanation.

## Workflow
1. Anomalies are recorded automatically (e.g. overdue commitments during
   `briefing_generate`) or by the expense/invoice detectors.
2. Show anomalies with `anomaly_list`.
3. On user review, mark them with `anomaly_ack` (`acknowledged` / `resolved`).

## Rules
- Never declare an anomaly just because data differs.
- Every anomaly needs evidence + explanation.
- Do not take automatic corrective action on an anomaly — surface it and ask.
