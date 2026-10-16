"""A stdio MCP server, so coding agents such as Claude Code and Codex can hand Jev a browser goal."""

import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

from .agent import Agent
from .browser import Browser
from .demo import load_environment
from .model import action_space

PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
RUN_SECONDS = 240
TEXT_LIMIT = 20000
BROWSER = None

TOOLS = [
    {
        "name": "browse",
        "description": (
            "Give Jev one natural-language browser goal. Jev observes the page, clicks, types, selects, and "
            "scrolls until it chooses DONE or BLOCKED. Pass url to start in a fresh tab; omit it to continue "
            "on the page left by the previous call. Jev's DONE is its own judgement, not proof: check the "
            "returned page, or call read_page, before relying on the result. Do not use it for payments, "
            "logins, or other irreversible actions unless the user asked for them."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "goal": {"type": "string", "description": "What to accomplish, with every required detail."},
                "url": {"type": "string", "description": "http(s) URL to open first. Omit to continue."},
            },
            "required": ["goal"],
        },
    },
    {
        "name": "read_page",
        "description": (
            "Read the current Jev tab without changing it and without model calls: URL, title, text, and the "
            "indexed controls Jev can act on. Set full to read the whole document instead of the viewport."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"full": {"type": "boolean", "description": "Return the whole page's text."}},
        },
    },
    {
        "name": "close_browser",
        "description": "Close the tab Jev opened. The user's other Chrome tabs are untouched.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def tidy(value):
    return " ".join(value.split()) if isinstance(value, str) else value


def close_browser():
    global BROWSER
    if BROWSER:
        BROWSER.close()
        BROWSER = None
    return {"closed": True}


def browse(goal=None, url=None):
    global BROWSER
    if not isinstance(goal, str) or not goal.strip() or len(goal) > 4000:
        raise ValueError("goal must be 1–4,000 characters")
    if url is not None:
        if urlparse(url).scheme not in {"http", "https"}:
            raise ValueError("url must start with http:// or https://")
        close_browser()
        BROWSER = Browser(url)
    elif BROWSER is None:
        raise ValueError("No page is open. Pass a url.")
    agent = Agent(None, goal, browser=BROWSER)
    started, error = time.monotonic(), None
    try:
        for state in agent.run():
            if time.monotonic() - started > RUN_SECONDS:
                error = f"Stopped after {RUN_SECONDS} s without DONE or BLOCKED."
                break
    except (ValueError, RuntimeError, TimeoutError) as exc:
        error = str(exc)
    state = agent.state
    page = state["page"]
    result = {
        "status": "error" if error else state["status"],
        "url": page["url"],
        "title": page["title"],
        "visible_text": page["text"],
        "actions": [
            {k: tidy(h[k]) if k == "action" else h[k]
             for k in ("step", "action", "kind", "text", "page_changed") if h.get(k) is not None}
            for h in state["history"]
        ],
        "elapsed_ms": state["elapsed_ms"],
        "model_calls": len(state["decisions"]) + len(state["text_calls"]),
    }
    if error:
        result["error"] = error
    if result["status"] == "done":
        result["note"] = "Jev chose DONE. Verify the outcome from this page before reporting success."
    return result


def read_page(full=False):
    if BROWSER is None:
        raise ValueError("No page is open. Call browse with a url.")
    page = BROWSER.observe(screenshot=False)
    result = {"url": page["url"], "title": page["title"]}
    if full:
        result["text"] = BROWSER.read_text(TEXT_LIMIT)
    else:
        result["visible_text"] = page["text"]
    result["elements"] = [
        " · ".join(filter(None, map(tidy, [f"[{e['index']}] {e['role']}", e["label"], e.get("value"),
                                           e.get("context")])))
        for e in action_space(page["actions"])[0]
    ]
    return result


HANDLERS = {"browse": browse, "read_page": read_page, "close_browser": close_browser}


def handle(message):
    method, params = message.get("method"), message.get("params") or {}
    if method == "initialize":
        requested = params.get("protocolVersion")
        return {
            "protocolVersion": requested if requested in PROTOCOLS else PROTOCOLS[0],
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "jev", "version": "0.1.0"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments") or {}
        if name not in HANDLERS:
            raise LookupError(f"Unknown tool: {name}")
        schema = next(t["inputSchema"] for t in TOOLS if t["name"] == name)
        try:
            if not isinstance(arguments, dict) or set(arguments) - set(schema["properties"]):
                raise ValueError(f"Arguments must be among: {', '.join(schema['properties']) or 'none'}")
            content, failed = HANDLERS[name](**arguments), False
        except Exception as exc:
            content, failed = {"error": str(exc) or type(exc).__name__}, True
        failed = failed or content.get("status") == "error"
        return {"content": [{"type": "text", "text": json.dumps(content, ensure_ascii=False)}], "isError": failed}
    raise LookupError(f"Unknown method: {method}")


def serve(lines, out):
    for line in lines:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        else:
            if "id" not in message:
                continue  # Notifications, such as notifications/initialized, need no reply.
            try:
                reply = {"jsonrpc": "2.0", "id": message["id"], "result": handle(message)}
            except LookupError as exc:
                reply = {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": str(exc)}}
        out.write(json.dumps(reply) + "\n")
        out.flush()


def main():
    load_environment()
    load_environment(Path(__file__).resolve().parent.parent / ".env")
    # stdout carries the protocol. Anything a dependency prints goes to stderr instead.
    out, sys.stdout = sys.stdout, sys.stderr
    try:
        serve(sys.stdin, out)
    finally:
        close_browser()


if __name__ == "__main__":
    main()
