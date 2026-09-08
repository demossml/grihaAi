#!/usr/bin/env python3
"""Local voice transcription stub (v1).

Prints a JSON object of shape:
    {"ok": bool, "text": str, "error": str}

Real faster-whisper integration comes later; this keeps the @griha/stt
package wired end-to-end.
"""

import json
import sys


def main() -> None:
    file_path = sys.argv[1] if len(sys.argv) > 1 else None
    print(json.dumps({
        "ok": False,
        "text": "",
        "error": "stt_local not implemented (stub)",
    }))


if __name__ == "__main__":
    main()
