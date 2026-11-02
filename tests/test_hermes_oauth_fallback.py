"""Regression coverage for stale external Claude credentials, no live tokens."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace, ModuleType

from tests.test_provider_usage import API


class HermesOAuthFallbackTest(unittest.TestCase):
    def test_valid_hermes_oauth_used_when_account_helper_has_no_usage(self):
        with patch.object(API, '_hermes_usage', return_value=None), \
             patch.object(API, '_hermes_anthropic_oauth_accounts', return_value=[('acct', 'fixture-oauth')]), \
             patch.object(API, '_claude_code_oauth_token', return_value=None), \
             patch.object(API, '_http_json', return_value={'five_hour': {'utilization': 12.0}}) as http:
            try:
                result = API.fetch_anthropic()
            except API._Skip:
                result = None
            self.assertIsNotNone(result, 'Valid Hermes OAuth must work without a Claude CLI login')
            self.assertEqual(result['windows'][0]['percent'], 12.0)
            self.assertEqual(http.call_args.args[1]['Authorization'], 'Bearer fixture-oauth')

    def test_rejected_pool_token_falls_through_to_claude_cli(self):
        with patch.object(API, '_hermes_usage', return_value=None), \
             patch.object(API, '_hermes_anthropic_oauth_accounts', return_value=[('acct', 'expired-fixture')]), \
             patch.object(API, '_claude_code_oauth_token', return_value='cli-fixture'), \
             patch.object(API, '_http_json', side_effect=[PermissionError('HTTP 401'), {'seven_day': {'utilization': 3}}]) as http:
            try:
                result = API.fetch_anthropic()
            except PermissionError:
                result = None
            self.assertIsNotNone(result, 'Rejected pool token must not prevent CLI fallback')
            self.assertEqual(http.call_count, 2)
            self.assertEqual(result['windows'][0]['percent'], 3.0)

    def test_pool_candidates_exclude_api_keys_and_deduplicate(self):
        entries = [SimpleNamespace(auth_type='api_key', access_token='api-fixture'),
                   SimpleNamespace(auth_type='oauth', access_token='oauth-fixture'),
                   SimpleNamespace(auth_type='oauth', access_token='oauth-fixture'),
                   SimpleNamespace(auth_type='oauth', access_token='')]
        pool_module = ModuleType('agent.credential_pool')
        pool_module.load_pool = lambda provider: SimpleNamespace(entries=lambda: entries)
        with patch.dict('sys.modules', {'agent.credential_pool': pool_module}):
            helper = getattr(API, '_hermes_anthropic_oauth_tokens', lambda: [])
            self.assertEqual(helper(), ['oauth-fixture'])

    def test_non_auth_failure_does_not_silently_try_another_account(self):
        with patch.object(API, '_hermes_usage', return_value=None), \
             patch.object(API, '_hermes_anthropic_oauth_accounts', return_value=[('acct', 'fixture')]), \
             patch.object(API, '_claude_code_oauth_token', return_value=None), \
             patch.object(API, '_http_json', side_effect=RuntimeError('HTTP 503')):
            try:
                API.fetch_anthropic()
            except API._Skip:
                self.fail('A service error must surface, not hide the provider')
            except RuntimeError as error:
                self.assertEqual(str(error), 'HTTP 503')
            else:
                self.fail('Expected service error')

    def test_unscoped_pool_loader_falls_back_to_auth_json(self):
        # multiplexed backend: load_pool raises UnscopedSecretError (a RuntimeError)
        pool_module = ModuleType('agent.credential_pool')
        def boom(provider):
            raise RuntimeError('Hermes could not read this profile\'s ANTHROPIC_TOKEN')
        pool_module.load_pool = boom
        rows = [{'label': 'anthropic-work', 'auth_type': 'oauth', 'access_token': 'fx-a'},
                {'label': 'anthropic-api-key', 'auth_type': 'api_key', 'access_token': 'fx-k'},
                {'label': 'anthropic-home', 'auth_type': 'oauth', 'access_token': 'fx-b'}]
        with patch.dict('sys.modules', {'agent.credential_pool': pool_module}), \
             patch.object(API, '_auth_json_anthropic_entries', return_value=rows):
            self.assertEqual(API._hermes_anthropic_oauth_accounts(),
                             [('anthropic-work', 'fx-a'), ('anthropic-home', 'fx-b')])

    def test_two_accounts_render_side_by_side_with_credits(self):
        bodies = {
            'Bearer fx-a': {'five_hour': {'utilization': 52.0, 'resets_at': '2026-10-08T08:59:59+00:00'},
                            'seven_day': None},
            'Bearer fx-b': {'five_hour': {'utilization': 0.0, 'resets_at': None},
                            'seven_day': {'utilization': 100.0, 'resets_at': '2026-10-08T19:00:00+00:00'},
                            'iguana_necktie': {'utilization': 64.46, 'limit_dollars': 100, 'used_dollars': 64.46}},
        }
        with patch.object(API, '_hermes_usage', side_effect=AssertionError('helper must not mask accounts')), \
             patch.object(API, '_hermes_anthropic_oauth_accounts',
                          return_value=[('anthropic-work', 'fx-a'), ('anthropic-home', 'fx-b')]), \
             patch.object(API, '_claude_code_oauth_token', return_value=None), \
             patch.object(API, '_http_json', side_effect=lambda url, h, **kw: bodies[h['Authorization']]):
            p = API.fetch_anthropic()
        labels = [w['label'] for w in p['windows']]
        self.assertEqual(labels, ['work · 5h', 'home · 5h', 'home · 7d'])
        self.assertEqual(p['windows'][2]['percent'], 100.0)
        self.assertEqual(p['money'], [{'label': 'home · Credits', 'left': 35.54, 'total': 100.0, 'cur': 'USD'}])

    def test_one_rejected_account_keeps_the_other(self):
        def http(url, h, **kw):
            if h['Authorization'] == 'Bearer fx-a':
                raise PermissionError('HTTP 401')
            return {'five_hour': {'utilization': 7}}
        with patch.object(API, '_hermes_anthropic_oauth_accounts', return_value=[('a', 'fx-a'), ('b', 'fx-b')]), \
             patch.object(API, '_claude_code_oauth_token', return_value=None), \
             patch.object(API, '_http_json', side_effect=http):
            p = API.fetch_anthropic()
        self.assertEqual([w['label'] for w in p['windows']], ['5h'])  # single answer: no prefix
        self.assertEqual(p['windows'][0]['percent'], 7.0)


if __name__ == '__main__':
    unittest.main()
