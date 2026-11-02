"""Exhausted Codex quota: keep a 0% card with its reset time instead of hiding it."""
import time
import unittest
from unittest.mock import patch

from tests.test_provider_usage import API

NOW = 1_800_000_000.0


def entry(**over):
    row = {
        "id": "fixture", "auth_type": "oauth", "last_status": "exhausted",
        "last_error_code": 429, "last_error_reason": "usage_limit_reached",
        "last_error_reset_at": NOW + 92 * 60,
    }
    row.update(over)
    return row


class CodexLimitFallbackTest(unittest.TestCase):
    def fetch(self, rows, live=None):
        with patch.object(API, "_hermes_usage", return_value=live), \
             patch.object(API, "_auth_json_pool_entries", return_value=rows), \
             patch.object(API.time, "time", return_value=NOW), \
             patch.object(API, "HOME", API.Path("does-not-exist")):
            return API.fetch_openai_codex()

    def test_exhausted_short_window_is_session_at_100_with_reset(self):
        result = self.fetch([entry()])
        self.assertEqual(result["status"], "ok")
        self.assertEqual([w["label"] for w in result["windows"]], ["5h"])
        self.assertEqual(result["windows"][0]["percent"], 100.0)
        self.assertEqual(result["windows"][0]["resets_at"], time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(NOW + 92 * 60)))

    def test_reset_beyond_five_hours_is_the_weekly_window(self):
        result = self.fetch([entry(last_error_reset_at=NOW + 70 * 3600)])
        self.assertEqual([w["label"] for w in result["windows"]], ["7d"])
        self.assertEqual(result["windows"][0]["percent"], 100.0)

    def test_live_usage_always_wins(self):
        live = {"id": "openai-codex", "status": "ok", "windows": [{"label": "5h", "percent": 4.0}]}
        self.assertIs(self.fetch([entry()], live=live), live)

    def test_any_non_exhausted_account_hides_the_fallback(self):
        with self.assertRaises(API._Skip):
            self.fetch([entry(), entry(last_status="ok")])

    def test_expired_or_missing_reset_never_fabricates_a_limit(self):
        for row in (entry(last_error_reset_at=NOW - 1), entry(last_error_reset_at=None), entry(last_status="ok")):
            with self.assertRaises(API._Skip):
                self.fetch([row])

    def test_no_oauth_entries_stays_hidden(self):
        with self.assertRaises(API._Skip):
            self.fetch([entry(auth_type="api_key")])

    def test_live_http_failure_falls_back_instead_of_error_card(self):
        with patch.object(API, "_hermes_usage", return_value=None), \
             patch.object(API, "_auth_json_pool_entries", return_value=[entry()]), \
             patch.object(API.time, "time", return_value=NOW), \
             patch.object(API, "_http_json", side_effect=PermissionError("HTTP 429")), \
             patch.object(API, "HOME", API.Path("does-not-exist")):
            self.assertEqual(API.fetch_openai_codex()["windows"][0]["percent"], 100.0)


if __name__ == "__main__":
    unittest.main()
