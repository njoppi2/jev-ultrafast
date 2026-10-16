"""Offline MCP contracts. No browser and no paid APIs."""

import io
import json
from unittest.mock import Mock

import pytest

from jev_ultrafast import browser, mcp


def call(*messages):
    out = io.StringIO()
    mcp.serve([json.dumps(m) for m in messages], out)
    return [json.loads(line) for line in out.getvalue().splitlines()]


def tool(name, arguments=None):
    return {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}}}


def test_handshake_lists_tools_and_ignores_notifications():
    init, tools = call(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    )
    assert init["result"]["protocolVersion"] == "2025-06-18"
    assert {t["name"] for t in tools["result"]["tools"]} == {"browse", "read_page", "close_browser"}


@pytest.mark.parametrize("arguments", [{"goal": "Go", "url": "javascript:alert(1)"}, {"goal": ""}, {"selector": "a"}])
def test_invalid_browse_arguments_never_open_a_browser(monkeypatch, arguments):
    opened = Mock()
    monkeypatch.setattr(mcp, "Browser", opened)
    [reply] = call(tool("browse", arguments))
    assert reply["result"]["isError"]
    opened.assert_not_called()


def test_continuing_without_an_open_page_is_an_error(monkeypatch):
    monkeypatch.setattr(mcp, "BROWSER", None)
    [reply] = call(tool("browse", {"goal": "Open the first result"}))
    assert reply["result"]["isError"]
    assert "Pass a url" in reply["result"]["content"][0]["text"]


def test_browse_reports_a_failed_run_with_its_page(monkeypatch):
    page = {"url": "https://example.test/", "title": "Example", "text": "Hello", "actions": []}

    class FailingAgent:
        def __init__(self, url, goal, browser):
            self.state = {"page": page, "status": "ready", "history": [], "decisions": [{}], "text_calls": [],
                          "elapsed_ms": 5}

        def run(self):
            raise RuntimeError("Model provider returned HTTP 401; no action executed.")
            yield

    monkeypatch.setattr(mcp, "Browser", Mock())
    monkeypatch.setattr(mcp, "Agent", FailingAgent)
    [reply] = call(tool("browse", {"goal": "Say hello", "url": "https://example.test/"}))
    result = json.loads(reply["result"]["content"][0]["text"])
    assert reply["result"]["isError"] and result["status"] == "error"
    assert result["url"] == page["url"] and "HTTP 401" in result["error"]


def test_unknown_method_is_a_protocol_error():
    [reply] = call({"jsonrpc": "2.0", "id": 3, "method": "resources/list"})
    assert reply["error"]["code"] == -32601


def test_observe_waits_for_a_slow_navigation(monkeypatch):
    b = browser.Browser.__new__(browser.Browser)
    b.session = "test"
    loaded = {"url": "https://example.test/next"}
    reads = Mock(side_effect=[browser.StalePage("Document is navigating")] * 20 + [loaded])
    monkeypatch.setattr(browser, "browser_operation", reads)
    monkeypatch.setattr(browser.time, "sleep", Mock())
    assert b.observe(screenshot=False) == loaded
    assert reads.call_count == 21
