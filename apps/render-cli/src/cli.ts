import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { renderDocument, listTemplates } from "@griha/render-tools";

const USAGE = `Usage:
  griha-render <pdf|pptx> --template <name> --out <dir> [--data <file> | --stdin]
  griha-render list-templates

Commands:
  pdf             render a PDF document
  pptx            render a PPTX document
  list-templates  print available template names (JSON)

Options:
  --template <name>  template: sales-report | expense-report | meeting-minutes
  --data <file>      read JSON request from a file
  --stdin            read JSON request from stdin
  --out <dir>        output directory (required for pdf/pptx)
  -h, --help         show this help
`;

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export async function run(argv: string[], io: CliIO): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];

  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        template: { type: "string" },
        data: { type: "string" },
        out: { type: "string" },
        stdin: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values as Record<string, string | boolean | undefined>;
    positionals = parsed.positionals;
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const command = positionals[0];

  if (values.help || command === undefined) {
    io.stdout(USAGE);
    return values.help ? 0 : 1;
  }

  if (command === "list-templates") {
    io.stdout(JSON.stringify(listTemplates()));
    return 0;
  }

  if (command !== "pdf" && command !== "pptx") {
    io.stderr(`unknown command: ${command}`);
    return 1;
  }

  const template = typeof values.template === "string" ? values.template : undefined;
  const out = typeof values.out === "string" ? values.out : undefined;
  if (!template || !out) {
    io.stderr("--template and --out are required");
    return 1;
  }

  let raw: string;
  try {
    if (values.stdin) {
      raw = await readStdin();
    } else if (typeof values.data === "string" && values.data) {
      raw = await readFile(values.data, "utf8");
    } else {
      io.stderr("provide --data <file> or --stdin");
      return 1;
    }
  } catch (err) {
    io.stderr(`read failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    io.stdout(JSON.stringify({ ok: false, code: "INVALID_INPUT", message: "invalid JSON" }));
    return 1;
  }

  const request = { ...(parsedJson as Record<string, unknown>), format: command };
  const result = await renderDocument(request, { outDir: out });
  io.stdout(JSON.stringify(result));
  return result.ok ? 0 : 1;
}
