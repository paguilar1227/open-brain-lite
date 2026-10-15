import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import media


class CaptionImportTest(unittest.TestCase):
    def test_downloads_one_caption_track_instead_of_every_translation(self):
        calls = []
        metadata = {'title': 'Caption fixture', 'language': 'en',
                    'subtitles': {'en': [], 'en-US': []},
                    'automatic_captions': {'en-orig': [], 'en-de-DE': []}}

        class Downloader:
            def __init__(self, options):
                self.options = dict(options)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def extract_info(self, url, download):
                calls.append((download, self.options))
                if download:
                    if self.options['subtitleslangs'] != ['en']:
                        raise RuntimeError('Unnecessary translated track download failed')
                    target = self.options['outtmpl'].replace('%(ext)s', 'en.vtt')
                    Path(target).write_text('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nKeep local project memory.\n')
                return metadata

        with patch.dict(sys.modules, {'yt_dlp': types.SimpleNamespace(YoutubeDL=Downloader)}):
            result = media.from_url('https://www.youtube.com/watch?v=fixture')
        self.assertEqual(result['text'], 'Keep local project memory.')
        self.assertFalse(calls[0][0])
        self.assertEqual(calls[1][1]['subtitleslangs'], ['en'])

    def test_prefers_original_language_and_supports_automatic_captions(self):
        self.assertEqual(media.caption_language({'language': 'es', 'subtitles': {'en': [], 'es': []}}), 'es')
        self.assertEqual(media.caption_language({'language': 'en', 'automatic_captions': {'en-de-DE': [], 'en-orig': [], 'en': []}}), 'en-orig')
        self.assertIsNone(media.caption_language({'subtitles': {}, 'automatic_captions': {}}))

    def test_transcribes_locally_when_no_captions_exist(self):
        calls = []

        class Downloader:
            def __init__(self, options):
                self.options = dict(options)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def extract_info(self, url, download):
                calls.append((download, self.options))
                return {'title': 'No captions'}

            def prepare_filename(self, info):
                return 'local-audio-fixture'

        with patch.dict(sys.modules, {'yt_dlp': types.SimpleNamespace(YoutubeDL=Downloader)}):
            with patch.object(media, 'transcribe', return_value='Local transcription') as transcribe:
                result = media.from_url('https://www.youtube.com/watch?v=fixture')
        transcribe.assert_called_once_with('local-audio-fixture')
        self.assertEqual(result['text'], 'Local transcription')
        self.assertFalse(calls[-1][1]['skip_download'])
        self.assertFalse(calls[-1][1]['writesubtitles'])


if __name__ == '__main__':
    unittest.main()
