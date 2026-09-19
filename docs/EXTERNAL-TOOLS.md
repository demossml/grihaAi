# Внешние инструменты рендера (External Tools)

Вынос рендера PDF/PPTX-отчётов из `apps/agent` в отдельные пакеты и CLI,
активируемые флагами (по умолчанию — старое поведение 1:1).

## MCP-сервер griha-render

`griha-render` умеет работать как MCP stdio-сервер (line-delimited JSON-RPC).
Методы: `initialize`, `tools/list`, `tools/call`. Инструменты: `list_templates`,
`render_pdf`, `render_pptx`.

Пример конфигурации `~/.grish-ai/config.json`:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "griha-render",
        "transport": "stdio",
        "command": "node",
        "args": ["apps/render-cli/dist/bin.js", "mcp"]
      }
    ]
  }
}
```

Активация MCP в агенте — только за флагом `GRIHA_AGENT_RUNTIME=1`
(см. `apps/agent/.pi/extensions/mcp-runtime`).
