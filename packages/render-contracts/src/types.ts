export type RenderErrorCode =
  | "INVALID_INPUT"
  | "UNKNOWN_TEMPLATE"
  | "RENDER_FAILED"
  | "WRITE_FAILED"
  | "INTERNAL";

export interface RenderSuccess {
  ok: true;
  filePath: string;
  bytes: number;
  pages?: number;
  durationMs: number;
  warnings: string[];
}

export interface RenderFailure {
  ok: false;
  code: RenderErrorCode;
  message: string;
  issues?: string[];
}

export type RenderResult = RenderSuccess | RenderFailure;
