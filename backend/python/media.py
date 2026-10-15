"""Local media extraction; only source downloads and initial model weights use a network."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile


def transcribe(path):
    from faster_whisper import WhisperModel
    model = WhisperModel(os.getenv('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8',
                         download_root=os.getenv('MEDIA_MODEL_DIR', '/data/models/whisper'))
    segments, info = model.transcribe(str(path), vad_filter=True)
    return '\n'.join(segment.text.strip() for segment in segments)


def caption_language(info):
    """Pick one source-language track; avoid downloading translated variants."""
    language = info.get('language')
    for tracks in (info.get('subtitles') or {}, info.get('automatic_captions') or {}):
        if not tracks:
            continue
        for preferred in (f'{language}-orig', language, 'en-orig', 'en'):
            if preferred in tracks:
                return preferred
        return next((code for code in tracks if code.endswith('-orig')), next(iter(tracks)))
    return None


def from_url(url):
    import yt_dlp
    with tempfile.TemporaryDirectory(prefix='brain-media-') as directory:
        options = {'quiet': True, 'no_warnings': True, 'noprogress': True, 'noplaylist': True, 'skip_download': True,
                   'writesubtitles': True, 'writeautomaticsub': True, 'subtitleslangs': [],
                   'subtitlesformat': 'vtt', 'outtmpl': str(Path(directory) / 'source.%(ext)s')}
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
        language = caption_language(info)
        if language:
            options['subtitleslangs'] = [re.escape(language)]
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(url, download=True)
        subtitle_text = []
        for subtitle in Path(directory).glob('*.vtt'):
            previous = ''
            for line in subtitle.read_text().splitlines():
                if not line.strip() or line.startswith(('WEBVTT', 'Kind:', 'Language:')) or '-->' in line or line.strip().isdigit():
                    continue
                text = re.sub(r'<[^>]+>', '', line).strip()
                if text != previous:
                    subtitle_text.append(text)
                previous = text
        if subtitle_text:
            body = '\n'.join(subtitle_text)
        else:
            options.update({'skip_download': False, 'writesubtitles': False, 'writeautomaticsub': False,
                            'format': 'bestaudio/best'})
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(url, download=True)
                path = downloader.prepare_filename(info)
            body = transcribe(path)
        if not body.strip():
            raise ValueError('No captions or intelligible speech were found.')
        return {'title': info.get('title') or 'Media transcript', 'text': body,
                'description': info.get('description', '')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['transcribe', 'url'])
    parser.add_argument('source')
    args = parser.parse_args()
    with contextlib.redirect_stdout(sys.stderr):
        result = from_url(args.source) if args.action == 'url' else {'text': transcribe(args.source)}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
