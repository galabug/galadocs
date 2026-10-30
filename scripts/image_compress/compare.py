#!/usr/bin/env python3
"""Inspect two images without changing them."""

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, JpegImagePlugin

from compress import measure_quality


def inspect_image(path: Path) -> dict:
    data = path.read_bytes()
    with Image.open(io.BytesIO(data)) as image:
        result = {
            'path': str(path.resolve()),
            'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
            'format': image.format,
            'size': image.size,
            'frames': getattr(image, 'n_frames', 1),
            'progressive': bool(image.info.get('progressive')),
        }
        if image.format == 'JPEG':
            result['sampling'] = {0: '4:4:4', 1: '4:2:2', 2: '4:2:0'}.get(
                JpegImagePlugin.get_sampling(image), 'grayscale/other'
            )
            matches = []
            for quality in range(1, 101):
                buffer = io.BytesIO()
                Image.new('RGB', (8, 8)).save(buffer, 'JPEG', quality=quality)
                with Image.open(io.BytesIO(buffer.getvalue())) as standard:
                    if image.quantization == standard.quantization:
                        matches.append(quality)
            result['matching_standard_jpeg_qualities'] = matches
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    args = parser.parse_args()
    try:
        before, after = inspect_image(args.before), inspect_image(args.after)
        result = {'before': before, 'after': after,
                  'identical_files': before['sha256'] == after['sha256'],
                  'saved_percent': round((1 - after['bytes'] / before['bytes']) * 100, 2)}
        if before['size'] == after['size'] and before['frames'] == after['frames'] == 1:
            with Image.open(args.before) as first, Image.open(args.after) as second:
                ssim, psnr = measure_quality(first, second)
                result.update(block_ssim=round(ssim, 6),
                              psnr_db=round(psnr, 2) if psnr != float('inf') else 'infinity')
        else:
            result['quality_note'] = 'Metrics require equal dimensions and single-frame images'
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, f'Cannot compare images: {error}\n')


if __name__ == '__main__':
    main()
