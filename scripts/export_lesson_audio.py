"""Export one MP3 per practice sentence using the existing VoisIT backend.

Requires Python 3 and ffmpeg. No client API key; no scheduling or uploads.
python scripts/export_lesson_audio.py lessons/lesson-08.json --output outputs/lesson-08
"""
from __future__ import annotations
import argparse
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request
import wave

RATE = 24000
MIMES = {'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave'}


def normalize(text):
    return unicodedata.normalize('NFC', text).strip()


def practices(lesson):
    texts, seen = [], set()
    nodes = list(lesson['sentences']) + list(lesson.get('dialogue', {}).get('lines', []))
    nodes += list(lesson.get('homework', []))
    for item in nodes:
        text = normalize(item.get('fo', ''))
        if text and text not in seen:
            seen.add(text)
            texts.append(text)
    return [{'fo': t, 'file': f"บท{int(lesson['number']):02d}_ประโยค{i}.mp3"}
            for i, t in enumerate(texts, 1)]


def audio_format(data, content_type):
    if content_type not in MIMES or not 100 < len(data) <= 10 * 1024 * 1024:
        raise ValueError('Response is not a supported audio file')
    if data[:4] == b'RIFF' and data[8:12] == b'WAVE':
        return 'wav'
    if data[:3] == b'ID3' or (data[0] == 255 and data[1] & 224 == 224):
        return 'mp3'
    raise ValueError('Audio signature is neither MP3 nor WAV')


def request_audio(base_url, text, speed, temp_dir):
    payload = {'text': normalize(text), 'voice': 'elin', 'speed': speed}
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(base_url.rstrip('/') + '/api/tts', data=body,
                                    headers={'Content-Type': 'application/json; charset=utf-8'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            content_type = response.headers.get_content_type()
            if response.status != 200 or content_type not in MIMES:
                raise RuntimeError(f'Unexpected HTTP {response.status}, Content-Type {content_type}')
            data = response.read(10 * 1024 * 1024 + 1)
            extension = audio_format(data, content_type)
            path = temp_dir / (hashlib.sha256(body).hexdigest() + '.' + extension)
            path.write_bytes(data)
            return path, {'status': response.status, 'content_type': content_type,
                          'bytes': len(data), 'voice': 'elin', 'speed': speed, 'text': payload['text'],
                          'sha256': hashlib.sha256(data).hexdigest()}
    except urllib.error.HTTPError as error:
        code = None
        try:
            code = json.loads(error.read(4096)).get('error', {}).get('code')
        except (ValueError, AttributeError):
            pass
        raise RuntimeError(f'HTTP {error.code}; code={code or "UNKNOWN"}') from None
    except urllib.error.URLError as error:
        raise ConnectionError(f'Network request failed before audio was received: {error.reason}') from None


def run_ffmpeg(ffmpeg, args):
    result = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-v', 'error', *args], capture_output=True)
    if result.returncode:
        raise RuntimeError('ffmpeg failed: ' + result.stderr.decode('utf-8', 'replace')[:1500])


def decode(ffmpeg, source, destination):
    # Use files: some Windows ffmpeg builds append status bytes to stdout.
    run_ffmpeg(ffmpeg, ['-xerror', '-y', '-i', str(source), '-map', '0:a:0', '-ac', '1',
                        '-ar', str(RATE), '-c:a', 'pcm_s16le', str(destination)])
    with wave.open(str(destination), 'rb') as wav:
        if (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) != (1, RATE, 2):
            raise RuntimeError('Unexpected decoded format')
        samples = array('h', wav.readframes(wav.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        return samples


def dbfs(samples):
    if not samples:
        return -240.0
    rms = math.sqrt(sum(float(x) ** 2 for x in samples) / len(samples)) / 32768
    return 20 * math.log10(max(rms, 1e-12))


def combine(ffmpeg, normal, slow, output, temp_dir):
    a = decode(ffmpeg, normal, temp_dir / 'normal.wav')
    b = decode(ffmpeg, slow, temp_dir / 'slow.wav')
    if len(a) < RATE / 4 or len(b) < RATE / 4 or min(dbfs(a), dbfs(b)) < -45:
        raise RuntimeError('A source segment is empty or effectively silent')
    graph = ('[0:a]aresample=24000,aformat=sample_fmts=fltp:channel_layouts=mono,asetpts=PTS-STARTPTS[a];'
             '[1:a]atrim=duration=1,asetpts=PTS-STARTPTS[z];'
             '[2:a]aresample=24000,aformat=sample_fmts=fltp:channel_layouts=mono,asetpts=PTS-STARTPTS[b];'
             '[a][z][b]concat=n=3:v=0:a=1[out]')
    partial = output.with_suffix('.partial.mp3')
    run_ffmpeg(ffmpeg, ['-y', '-i', str(normal), '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
                        '-i', str(slow), '-filter_complex', graph, '-map', '[out]', '-ar', '24000',
                        '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', str(partial)])
    final = decode(ffmpeg, partial, temp_dir / 'combined.wav')
    if abs(len(final) - (len(a) + RATE + len(b))) > RATE * .03:
        raise RuntimeError('Unexpected combined duration')
    gap = final[len(a) + 720:len(a) + RATE - 720]
    first, second = final[:len(a)], final[len(a) + RATE:]
    if min(dbfs(first), dbfs(second)) < -45 or dbfs(gap) > -60:
        raise RuntimeError('Speech segments or silence did not validate')
    partial.replace(output)
    return {'path': str(output.resolve()), 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'sample_rate': RATE, 'channels': 1, 'encoder': 'libmp3lame',
            'normal_seconds': len(a) / RATE, 'silence_seconds': 1.0,
            'slow_seconds': len(b) / RATE, 'duration_seconds': len(final) / RATE,
            'first_dbfs': dbfs(first), 'second_dbfs': dbfs(second), 'silence_inner_dbfs': dbfs(gap),
            'decode_check': 'passed', 'attachment_status': 'not_attempted'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('lesson', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--base-url', default='https://faroese-pronunciation.onrender.com')
    parser.add_argument('--ffmpeg', default=os.environ.get('FFMPEG_BIN') or shutil.which('ffmpeg'))
    parser.add_argument('--only', type=int, help='Test a single sentence number')
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error('ffmpeg was not found; provide --ffmpeg or FFMPEG_BIN')
    lesson = json.loads(args.lesson.read_text(encoding='utf-8'))
    jobs = practices(lesson)
    if args.only:
        if not 1 <= args.only <= len(jobs):
            parser.error('--only is outside the practice sentence range')
        jobs = [jobs[args.only - 1]]
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'lesson': lesson['number'], 'provider': 'VoisIT', 'files': [], 'failures': [],
              'attachment_status': 'not_attempted'}
    for job in jobs:
        temp_dir = args.output / '.work' / Path(job['file']).stem
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            normal, normal_meta = request_audio(args.base_url, job['fo'], 1.0, temp_dir)
            slow, slow_meta = request_audio(args.base_url, job['fo'], 0.7, temp_dir)
            entry = combine(args.ffmpeg, normal, slow, args.output / job['file'], temp_dir)
            entry.update(text=job['fo'], requests=[normal_meta, slow_meta])
            report['files'].append(entry)
        except (OSError, RuntimeError, ValueError) as error:
            report['failures'].append({'file': job['file'], 'text': job['fo'], 'reason': str(error)})
            break  # Do not loop on network, quota, permission or whitelist failures.
    report['requested'] = len(jobs)
    report['not_attempted'] = len(jobs) - len(report['files']) - len(report['failures'])
    manifest = args.output / 'audio-manifest.json'
    manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'created': len(report['files']), 'failures': report['failures'],
                      'not_attempted': report['not_attempted'], 'manifest': str(manifest.resolve())}, ensure_ascii=False))
    return 0 if len(report['files']) == len(jobs) else 1


if __name__ == '__main__':
    raise SystemExit(main())
