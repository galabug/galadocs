from datetime import date, timedelta
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from free_sources import BaoStockSource, EastmoneySource, FreeSources, band_direction, one_word_limit_up

CALENDAR = [date(2026, 7, 1) + timedelta(days=i) for i in range(100)
            if (date(2026, 7, 1) + timedelta(days=i)).weekday() < 5]


def quote(day, close='11.06', prior='10.05', st='0', trading='1'):
    return {'date': day.isoformat(), 'code': 'sh.600001', 'close': close,
            'open': close, 'high': close, 'low': close,
            'preclose': prior, 'isST': st, 'tradestatus': trading, 'adjustflag': '3'}


class PriceRulesTests(unittest.TestCase):
    def test_one_word_requires_all_four_prices_equal(self):
        row = quote(CALENDAR[10])
        self.assertTrue(one_word_limit_up(row))
        self.assertFalse(one_word_limit_up({**row, 'low': '11.05'}))

    def test_exact_half_up_not_percentage_threshold(self):
        day = CALENDAR[10]
        self.assertEqual(band_direction(quote(day), '2000-01-01', CALENDAR), 'up')
        self.assertIsNone(band_direction(quote(day, '11.05'), '2000-01-01', CALENDAR))
        self.assertEqual(band_direction(quote(day, '9.05'), '2000-01-01', CALENDAR), 'down')
        self.assertIsNone(band_direction(quote(day, '9.06'), '2000-01-01', CALENDAR))

    def test_minimum_tick(self):
        self.assertEqual(band_direction(quote(CALENDAR[10], '0.05', '0.04'), '2000-01-01', CALENDAR), 'up')
        self.assertEqual(band_direction(quote(CALENDAR[10], '0.03', '0.04'), '2000-01-01', CALENDAR), 'down')

    def test_st_suspension_and_ipo_first_five_sessions(self):
        day = CALENDAR[10]
        self.assertIsNone(band_direction(quote(day, st='1'), '2000-01-01', CALENDAR))
        self.assertIsNone(band_direction(quote(day, trading='0'), '2000-01-01', CALENDAR))
        self.assertIsNone(band_direction(quote(CALENDAR[4]), CALENDAR[0].isoformat(), CALENDAR))
        self.assertEqual(band_direction(quote(CALENDAR[5]), CALENDAR[0].isoformat(), CALENDAR), 'up')
        with self.assertRaises(RuntimeError):
            band_direction(quote(day, st=''), '2000-01-01', CALENDAR)

    def test_height_backfills_before_display_window_and_breaks_on_st(self):
        with tempfile.TemporaryDirectory() as directory:
            provider = BaoStockSource(directory, CALENDAR[20])
            provider.calendar_days = CALENDAR
            provider.basics = {'600001.SH': {'ipoDate': '2000-01-01'}}
            provider.raw = lambda day: {'600001.SH': quote(day, close='10' if day <= CALENDAR[3] else '11.06')}
            result = provider.snapshot(CALENDAR[9])
            self.assertEqual(result['up'][0]['limit_times'], 6)
            self.assertTrue(result['up'][0]['all_one_word'])
            provider.classified.clear()
            provider.raw = lambda day: {'600001.SH':
                                         {**quote(day, close='10' if day <= CALENDAR[3] else '11.06'),
                                          'low': '11.05'} if day == CALENDAR[5]
                                         else quote(day, close='10' if day <= CALENDAR[3] else '11.06')}
            self.assertFalse(provider.snapshot(CALENDAR[9])['up'][0]['all_one_word'])
            provider.classified.clear()
            provider.raw = lambda day: {'600001.SH': quote(day, st='1' if day == CALENDAR[7] else '0')}
            self.assertEqual(provider.snapshot(CALENDAR[9])['up'][0]['limit_times'], 2)

    def test_rejects_truncated_history(self):
        with tempfile.TemporaryDirectory() as directory:
            provider = BaoStockSource(directory, CALENDAR[2])
            provider.calendar_days = CALENDAR[:3]
            provider.basics = {'600001.SH': {'ipoDate': '2000-01-01'}}
            provider.raw = lambda day: {'600001.SH': quote(day)}
            with self.assertRaisesRegex(RuntimeError, '不能截断'):
                provider.snapshot(CALENDAR[2])


class FallbackTests(unittest.TestCase):
    def test_vendor_request_retries_and_stops(self):
        with tempfile.TemporaryDirectory() as directory, patch('free_sources.time.sleep'):
            source = BaoStockSource(directory, CALENDAR[-1])
            source.request_once = Mock(side_effect=[RuntimeError('connection lost'), [{'ok': True}]])
            self.assertEqual(source.request('daily', date='2026-09-03'), [{'ok': True}])
            self.assertEqual(source.request_once.call_count, 2)
            source.request_once = Mock(side_effect=RuntimeError('still offline'))
            with self.assertRaisesRegex(RuntimeError, 'still offline'):
                source.request('daily', date='2026-09-03')
            self.assertEqual(source.request_once.call_count, 3)

    def test_complete_source_fallback_and_circuit_breaker(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = FreeSources(directory, CALENDAR[-1])
            primary, backup = Mock(), Mock()
            primary.snapshot.side_effect = RuntimeError('offline')
            backup.snapshot.return_value = {'up': [], 'poolSource': 'eastmoney'}
            sources.providers.update(baostock=primary, eastmoney=backup)
            self.assertEqual(sources.snapshot(CALENDAR[10])['poolSource'], 'eastmoney')
            sources.snapshot(CALENDAR[11])
            self.assertEqual(primary.snapshot.call_count, 1)
            self.assertTrue(sources.fallback_used)
            self.assertEqual(sources.health.items['baostock']['status'], 'unavailable')

    def test_calendar_can_use_tencent_then_sina(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = FreeSources(directory, CALENDAR[-1])
            primary, second, third = Mock(), Mock(), Mock()
            primary.calendar.side_effect = RuntimeError('offline')
            second.calendar.side_effect = RuntimeError('offline')
            third.calendar.return_value = CALENDAR
            sources.providers.update(baostock=primary, tencent=second, sina=third)
            self.assertEqual(sources.calendar(CALENDAR[0], CALENDAR[-1]), CALENDAR)
            self.assertEqual(sources.calendar_source, 'sina')

    def test_quote_sources_are_not_promoted_to_complete_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = FreeSources(directory, CALENDAR[-1])
            sources.providers['baostock'] = Mock(snapshot=Mock(side_effect=RuntimeError('offline')))
            sources.providers['eastmoney'] = Mock(snapshot=Mock(side_effect=RuntimeError('history unavailable')))
            with self.assertRaisesRegex(RuntimeError, '无可用完整复盘来源'):
                sources.snapshot(CALENDAR[10])

    def test_eastmoney_validates_date_and_count(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        day = datetime.now(ZoneInfo('Asia/Shanghai')).date()
        http = Mock()
        provider = EastmoneySource(http)
        http.json.return_value = {'data': {'qdate': '20000101', 'tc': 0, 'pool': []}}
        with self.assertRaisesRegex(RuntimeError, '日期'):
            provider.pool('up', day)
        http.json.return_value = {'data': {'qdate': day.strftime('%Y%m%d'), 'tc': 2, 'pool': []}}
        with self.assertRaisesRegex(RuntimeError, '不完整'):
            provider.pool('up', day)
        http.json.return_value = {'data': None}
        with self.assertRaises(RuntimeError):
            provider.pool('up', day)
        with self.assertRaisesRegex(RuntimeError, '不足 40'):
            provider.pool('up', day - timedelta(days=50))


if __name__ == '__main__':
    unittest.main()
