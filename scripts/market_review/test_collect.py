from datetime import date, timedelta
from contextlib import redirect_stdout
import io
import json
import sqlite3
import unittest
import tempfile
from pathlib import Path

from collect import collect, eligible, summarize, demo_rows, publish_health


def stock(code='600001.SH', boards=1, name='样本', one_word=False):
    return {'ts_code': code, 'limit_times': boards, 'name': name, 'all_one_word': one_word}


def snapshot(up=None, down=None, daily=None, st=None):
    return {'up': up or [], 'down': down or [], 'daily': daily or [], 'st': st or []}


class FakeProvider:
    def __init__(self):
        self.days = [date(2026, 1, 5) + timedelta(days=i) for i in range(100)
                     if (date(2026, 1, 5) + timedelta(days=i)).weekday() < 5]
        self.calls = []
        self.fail_on = None

    def calendar(self, start, end):
        return [d for d in self.days if start <= d <= end]

    def snapshot(self, day):
        self.calls.append(day)
        if day == self.fail_on:
            raise RuntimeError('network error')
        return snapshot([stock(boards=3)], daily=[{'ts_code': '600001.SH', 'close': 11, 'pre_close': 10}])


class MetricTests(unittest.TestCase):
    def test_universe(self):
        for code in ['600001.SH', '601001.SH', '603001.SH', '605001.SH', '000001.SZ', '001001.SZ', '002001.SZ', '003001.SZ']:
            self.assertTrue(eligible(stock(code), set()))
        for code in ['688001.SH', '300001.SZ', '920001.BJ', '200001.SZ', '900001.SH']:
            self.assertFalse(eligible(stock(code), set()))
        self.assertFalse(eligible(stock(name='*ST样本'), set()))
        self.assertFalse(eligible(stock(name='样本退'), set()))
        self.assertFalse(eligible(stock(), {'600001.SH'}))

    def test_prior_cohort_not_today_survivors_and_exclusions(self):
        previous = snapshot([stock(), stock('000001.SZ', 4), stock('000002.SZ', 2), stock('000003.SZ')])
        current = snapshot([stock(boards=3), stock('000004.SZ', 5)], daily=[
            {'ts_code': '600001.SH', 'close': 11, 'pre_close': 10},
            {'ts_code': '000001.SZ', 'close': 9, 'pre_close': 10},
            {'ts_code': '000003.SZ', 'close': 20, 'pre_close': 10},
        ], st=['000003.SZ'])
        row = summarize('2026-09-24', previous, current)
        self.assertAlmostEqual(row['upPremium'], 0)
        self.assertAlmostEqual(row['consecutivePremium'], -10)
        self.assertEqual((row['upSamples'], row['upExcluded']), (2, 2))
        self.assertEqual((row['consecutiveSamples'], row['consecutiveExcluded']), (1, 1))
        self.assertEqual((row['highest'], row['secondHighest']), (5, 3))

    def test_null_is_not_zero(self):
        row = summarize('2026-09-24', snapshot(), snapshot([stock()]))
        self.assertIsNone(row['upPremium'])
        self.assertIsNone(row['consecutivePremium'])
        self.assertIsNone(row['highest'])
        self.assertIsNone(row['lowest'])
        self.assertEqual(row['consecutive'], 0)

    def test_adjusted_previous_close(self):
        row = summarize('2026-09-24', snapshot([stock()]), snapshot(daily=[
            {'ts_code': '600001.SH', 'close': 5.5, 'pre_close': 5}]))
        self.assertEqual(row['upPremium'], 10)

    def test_initial_incremental_idempotent_and_calendar(self):
        provider = FakeProvider()
        db = sqlite3.connect(':memory:')
        with redirect_stdout(io.StringIO()):
            rows = collect(provider, db, provider.days[40], refresh=0)
            self.assertEqual(len(rows), 40)
            self.assertEqual(len(provider.calls), 41)
            self.assertEqual(rows[0]['upPremium'], 10)
            provider.calls.clear()
            self.assertEqual(collect(provider, db, provider.days[40], refresh=0), rows)
            self.assertEqual(provider.calls, [])
            rows = collect(provider, db, provider.days[43], refresh=0)
            self.assertEqual(len(rows), 43)
            self.assertEqual(provider.calls, provider.days[41:44])
            self.assertTrue(all(date.fromisoformat(r['date']).weekday() < 5 for r in rows))
            provider.calls.clear()
            collect(provider, db, provider.days[43], refresh=3)
            self.assertEqual(provider.calls, provider.days[40:44])

    def test_backfills_earlier_trading_days_without_replacing_history(self):
        provider = FakeProvider()
        db = sqlite3.connect(':memory:')
        with redirect_stdout(io.StringIO()):
            recent = collect(provider, db, provider.days[60], refresh=0)
            self.assertEqual(len(recent), 40)
            provider.calls.clear()
            rows = collect(provider, db, provider.days[60], refresh=0,
                           start_day=provider.days[2])
            self.assertEqual(provider.calls, provider.days[1:20])
            self.assertEqual(len(rows), 59)
            self.assertEqual(rows[0]['date'], provider.days[2].isoformat())
            self.assertEqual(rows[-1]['date'], provider.days[60].isoformat())
            self.assertEqual(len({row['date'] for row in rows}), len(rows))
            provider.calls.clear()
            self.assertEqual(collect(provider, db, provider.days[60], refresh=0,
                                     start_day=provider.days[2]), rows)
            self.assertEqual(provider.calls, [])

    def test_bulk_backfill_fetches_all_snapshots_before_summarizing(self):
        provider = FakeProvider()
        db = sqlite3.connect(':memory:')
        with redirect_stdout(io.StringIO()):
            collect(provider, db, provider.days[40], refresh=0)
            baseline = db.execute('SELECT COUNT(*) FROM metrics').fetchone()[0]
            original_snapshot = provider.snapshot

            def checked_snapshot(day):
                self.assertEqual(db.execute('SELECT COUNT(*) FROM metrics').fetchone()[0], baseline)
                return original_snapshot(day)

            provider.snapshot = checked_snapshot
            rows = collect(provider, db, provider.days[42], refresh=0,
                           start_day=provider.days[1])
        self.assertEqual(len(rows), 42)
        self.assertEqual(rows[0]['date'], provider.days[1].isoformat())

    def test_failed_batch_rolls_back(self):
        provider = FakeProvider()
        db = sqlite3.connect(':memory:')
        with redirect_stdout(io.StringIO()):
            collect(provider, db, provider.days[40], refresh=0)
            provider.fail_on = provider.days[42]
            with self.assertRaises(RuntimeError):
                collect(provider, db, provider.days[43], refresh=0)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM metrics').fetchone()[0], 40)
        self.assertEqual(db.execute('SELECT MAX(date) FROM snapshots').fetchone()[0], provider.days[40].isoformat())

    def test_second_highest_ranks_individual_stocks(self):
        for heights, expected in [([5, 5, 3, 2], 5), ([5, 5], 5), ([5, 3, 2], 3), ([2], None), ([], None)]:
            current = snapshot([stock(f'60000{i}.SH', boards=h) for i, h in enumerate(heights)])
            self.assertEqual(summarize('2026-09-28', snapshot(), current)['secondHighest'], expected)

    def test_all_one_word_streaks_are_annotated_but_not_ranked(self):
        current = snapshot([
            stock('600001.SH', 8, one_word=True),
            stock('600002.SH', 6), stock('600003.SH', 6),
            stock('600004.SH', 4, one_word=True),
        ])
        row = summarize('2026-09-28', snapshot(), current)
        self.assertEqual((row['highest'], row['secondHighest']), (6, 6))
        self.assertEqual((row['oneWordCount'], row['oneWordHighest']), (2, 8))
        self.assertEqual(row['oneWordStocks'][0], {'code': '600001.SH', 'name': '样本', 'boards': 8})
        self.assertEqual(len(row['highestStocks']), 2)
        self.assertEqual(len(row['secondHighestStocks']), 2)
        self.assertEqual(row['consecutive'], 4)
        current['up'] = [stock('600001.SH', 8, one_word=True)]
        self.assertIsNone(summarize('2026-09-28', snapshot(), current)['highest'])

    def test_unknown_one_word_status_does_not_claim_height(self):
        current = snapshot([stock('600001.SH', 5), stock('600002.SH', 7)])
        del current['up'][1]['all_one_word']
        row = summarize('2026-09-28', snapshot(), current)
        self.assertEqual(row['heightUnknown'], 1)
        self.assertIsNone(row['highest'])

    def test_health_publish_preserves_newer_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sources.json'
            publish_health(path, {'sources': [{'id': 'sina', 'status': 'ok', 'checkedAt': '2026-09-28T20:30:00+08:00'}]})
            publish_health(path, {'sources': [{'id': 'sina', 'status': 'untested', 'checkedAt': None}]})
            self.assertEqual(json.loads(path.read_text())['sources'][0]['status'], 'ok')

    def test_missed_days_saved_when_today_pending_then_caught_up(self):
        provider = FakeProvider()
        db = sqlite3.connect(':memory:')
        with redirect_stdout(io.StringIO()):
            collect(provider, db, provider.days[40], refresh=0)
            provider.fail_on = provider.days[43]
            rows = collect(provider, db, provider.days[43], refresh=0, allow_pending_latest=True)
            self.assertEqual(len(rows), 42)
            self.assertEqual(rows[-1]['date'], provider.days[42].isoformat())
            self.assertEqual(provider.pending_day['date'], provider.days[43].isoformat())
            provider.fail_on = None
            rows = collect(provider, db, provider.days[44], refresh=0)
            self.assertEqual(len(rows), 44)
            self.assertEqual(len({r['date'] for r in rows}), 44)

    def test_demo_is_deterministic(self):
        rows = demo_rows()
        self.assertEqual(len(rows), 40)
        self.assertEqual(rows, demo_rows())
        self.assertEqual(len({r['date'] for r in rows}), 40)
        json.dumps(rows, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
