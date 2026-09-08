#!/usr/bin/env python3
"""Local voice transcription via faster-whisper (offline, CPU).

Usage:
    python3 stt_local.py <audio-file> [--language LANG] [--model SIZE]

Prints a single JSON object to stdout:
    {"ok": bool, "text": str, "error": str, "durationMs": int, "language": str}

This is the backend for @griha/stt (`transcribeVoice` → python3 bridge).
No network is used at transcription time — the model is downloaded once and
cached locally by faster-whisper.
"""

import argparse
import json
import sys
import time

DEFAULT_MODEL = "small"


def transcribe(file_path: str, model_size: str, language: str | None):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return {
            "ok": False,
            "text": "",
            "error": (
                "faster-whisper is not installed. "
                "Install it with: pip install -r apps/agent/scripts/requirements.txt"
            ),
        }

    try:
        # device="cpu" + int8 keeps this dependency-free of CUDA and
        # privacy-friendly (audio never leaves the machine).
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        started = time.time()
        segments, info = model.transcribe(
            file_path,
            language=language,
            beam_size=5,
        )
        text = "".join(segment.text for segment in segments).strip()
        duration_ms = int((time.time() - started) * 1000)
        return {
            "ok": True,
            "text": text,
            "durationMs": duration_ms,
            "language": getattr(info, "language", None),
        }
    except Exception as exc:  # noqa: BLE001 — the bridge reports errors as JSON
        return {"ok": False, "text": "", "error": str(exc)}


def main() -> None:
    parser = argparse.ArgumentParser(description="faster-whisper STT bridge")
    parser.add_argument("file_path", nargs="?")
    parser.add_argument("--language", default=None)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    if not args.file_path:
        print(json.dumps({"ok": False, "text": "", "error": "no audio file provided"}))
        return

    result = transcribe(args.file_path, args.model, args.language)
    print(json.dumps(result))


if __name__ == "__main__":
    sys.exit(main())
