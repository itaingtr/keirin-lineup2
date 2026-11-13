from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
from export_pages import _history_layers


class IndependentHistoryTests(unittest.TestCase):
    def test_failed_ten_refresh_keeps_checked_previous_history(self):
        with patch('export_pages.daily_previous_page',return_value=('<card><previous>',{'checked':True})), \
             patch('rider_history.export_daily',side_effect=ValueError('Conflicting dates')):
            page,previous,ten=_history_layers('site','public','<card>','20261114',allow_missing=True)
        self.assertEqual(page,'<card><previous>');self.assertTrue(previous['checked']);self.assertIsNone(ten)

    def test_failed_previous_history_keeps_checked_ten_cache(self):
        with patch('export_pages.daily_previous_page',side_effect=ValueError('Unavailable row')), \
             patch('rider_history.export_daily',return_value=('<card><ten>',{'checked':True})):
            page,previous,ten=_history_layers('site','public','<card>','20261114',allow_missing=True)
        self.assertEqual(page,'<card><ten>');self.assertIsNone(previous);self.assertTrue(ten['checked'])

    def test_prepared_data_is_used_even_if_a_later_refresh_failed(self):
        with patch('export_pages.daily_previous_page',return_value=('<previous>',{'checked':True})), \
             patch('rider_history.export_daily',return_value=('<previous><ten>',{'checked':True})):
            page,previous,ten=_history_layers('site','public','<card>','20261114',allow_missing=True)
        self.assertEqual(page,'<previous><ten>');self.assertTrue(previous and ten)

    def test_archived_history_validation_remains_strict(self):
        with patch('export_pages.daily_previous_page',side_effect=ValueError('Invalid archive')):
            with self.assertRaisesRegex(ValueError,'Invalid archive'):
                _history_layers('site','public','<card>','20261112')


if __name__=='__main__':unittest.main()
