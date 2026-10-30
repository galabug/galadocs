#!/usr/bin/env python3
"""Compress local images without resizing; retain only smaller, verified files."""

import argparse
from collections import Counter
import csv
import errno
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageCms

try:
    import imagequant
except ImportError:
    imagequant = None

try:
    import mozjpeg_lossless_optimization as mozjpeg_optimizer
except ImportError:
    mozjpeg_optimizer = None


EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
PROFILES = {
    'smart': (45, 0.97, 38.0),
    'reference': (65, 0.97, 38.0),
    'gentle': (85, 0.98, 40.0),
}


def display_rgba(image: Image.Image) -> Image.Image:
    """Normalize tagged images to sRGB before comparing display appearance."""
    rgba = image.convert('RGBA')
    profile = image.info.get('icc_profile')
    if not profile:
        return rgba
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        rgb = ImageCms.profileToProfile(
            rgba.convert('RGB'), source, ImageCms.createProfile('sRGB'), outputMode='RGB'
        )
        result = rgb.convert('RGBA')
        result.putalpha(rgba.getchannel('A'))
        result.info.pop('icc_profile', None)
        return result
    except (OSError, ValueError, ImageCms.PyCMSError):
        # Preserve invalid/unsupported profiles in the output and compare raw pixels.
        return rgba


def measure_quality(original: Image.Image, candidate: Image.Image) -> tuple:
    """Mean 8x8-block SSIM and PSNR, checked on white and black backgrounds.

    This is block SSIM, not the sliding-window SSIM from scikit-image.
    Process strips to bound temporary array memory, including for large photos.
    """
    if original.size != candidate.size:
        raise ValueError('Image dimensions changed')
    original = display_rgba(original)
    candidate = display_rgba(candidate)
    scores, psnrs = [], []
    for background in ('white', 'black'):
        squared_error, pixel_count, score_sum, block_count = 0.0, 0, 0.0, 0
        for top in range(0, original.height, 128):
            box = (0, top, original.width, min(top + 128, original.height))
            arrays = []
            for image in (original, candidate):
                crop = image.crop(box)
                base = Image.new('RGBA', crop.size, background)
                base.alpha_composite(crop)
                arrays.append(np.asarray(base.convert('RGB'), dtype=np.float32))
            x, y = arrays
            squared_error += float(np.sum((x - y) ** 2, dtype=np.float64))
            pixel_count += x.size
            # Pad the final blocks so right/bottom edge text is also measured.
            h, w = x.shape[:2]
            padding = ((0, -h % 8), (0, -w % 8), (0, 0))
            blocks = []
            for array in (x, y):
                array = np.pad(array, padding, mode='edge')
                ph, pw = array.shape[:2]
                blocks.append(
                    array.reshape(ph // 8, 8, pw // 8, 8, 3)
                    .transpose(0, 2, 4, 1, 3)
                    .reshape(-1, 64)
                )
            x, y = blocks
            mx, my = x.mean(1), y.mean(1)
            vx, vy = x.var(1), y.var(1)
            covariance = ((x - mx[:, None]) * (y - my[:, None])).mean(1)
            ssim = ((2 * mx * my + 6.5025) * (2 * covariance + 58.5225)) / (
                (mx * mx + my * my + 6.5025) * (vx + vy + 58.5225)
            )
            score_sum += float(ssim.sum(dtype=np.float64))
            block_count += ssim.size
        scores.append(score_sum / block_count)
        mse = squared_error / pixel_count
        psnrs.append(10 * math.log10(255**2 / mse) if mse else math.inf)
    return min(scores), min(psnrs)


def same_pixels(original: Image.Image, candidate: Image.Image) -> bool:
    """Verify decoded frames, transparency, duration, loop, and orientation."""
    if original.size != candidate.size or original.format != candidate.format:
        return False
    frames = getattr(original, 'n_frames', 1)
    if frames != getattr(candidate, 'n_frames', 1):
        return False
    if original.info.get('loop') != candidate.info.get('loop'):
        return False
    if original.getexif().get(274) != candidate.getexif().get(274):
        return False
    for index in range(frames):
        original.seek(index)
        candidate.seek(index)
        if original.info.get('duration') != candidate.info.get('duration'):
            return False
        if not np.array_equal(
            np.asarray(original.convert('RGBA')), np.asarray(candidate.convert('RGBA'))
        ):
            return False
    original.seek(0)
    candidate.seek(0)
    return True


def encode(image: Image.Image, fmt: str, **options) -> bytes:
    buffer = io.BytesIO()
    metadata = {key: image.info[key] for key in ('icc_profile', 'exif', 'dpi') if key in image.info}
    image.save(buffer, format=fmt, **metadata, **options)
    return buffer.getvalue()


def optimize_jpeg(data: bytes) -> bytes:
    if mozjpeg_optimizer is None:
        return data
    if hasattr(mozjpeg_optimizer, 'COPY_MARKERS'):
        optimized = mozjpeg_optimizer.optimize(data, copy=mozjpeg_optimizer.COPY_MARKERS.ALL)
    else:
        # Older bindings on Python 3.7 always strip metadata. Keep candidates
        # that carry orientation or a colour profile intact instead.
        with Image.open(io.BytesIO(data)) as image:
            if image.info.get('exif') or image.info.get('icc_profile'):
                return data
        optimized = mozjpeg_optimizer.optimize(data)
    return optimized if len(optimized) < len(data) else data


def encode_palette_png(image: Image.Image) -> bytes:
    """Remove unused palette entries and choose 1/2/4/8-bit indices."""
    indices = np.asarray(image)
    used = np.unique(indices)
    lookup = Image.frombytes('P', (256, 1), bytes(range(256)))
    lookup.putpalette(image.getpalette('RGBA'), rawmode='RGBA')
    lookup.info.update(image.info)
    colors = np.asarray(lookup.convert('RGBA'))[0][used]
    remap = np.zeros(256, dtype=np.uint8)
    remap[used] = np.arange(len(used), dtype=np.uint8)
    compact = Image.fromarray(remap[indices])
    compact.putpalette(colors[:, :3].reshape(-1).tolist())
    compact.info.update({key: value for key, value in image.info.items()
                         if key != 'transparency'})
    if np.any(colors[:, 3] != 255):
        compact.info['transparency'] = bytes(colors[:, 3])
    count = len(used)
    bits = 1 if count <= 2 else 2 if count <= 4 else 4 if count <= 16 else 8
    return encode(compact, 'PNG', optimize=True, compress_level=9, bits=bits)


def external_candidate(tool: str, source: Path) -> bytes:
    """Optional native encoders; no shell and no changes to the source file."""
    with tempfile.TemporaryDirectory(prefix='image-compress-') as directory:
        target = Path(directory) / source.name
        if tool == 'pngquant':
            command = [tool, '--quality', '90-100', '--speed', '1', '--output', str(target), str(source)]
        elif tool == 'oxipng':
            shutil.copyfile(source, target)
            command = [tool, '-o', '4', str(target)]
        else:
            command = [tool, '-O3', str(source), '-o', str(target)]
        result = subprocess.run(command, capture_output=True, timeout=120)
        return target.read_bytes() if result.returncode == 0 and target.exists() else b''


def compress_image(source: Path, profile: str) -> tuple:
    source_bytes = source.read_bytes()
    best, method, best_ssim, best_psnr = source_bytes, 'original', 1.0, math.inf
    start_quality, min_ssim, min_psnr = PROFILES[profile]
    with Image.open(io.BytesIO(source_bytes)) as original:
        original.load()
        reference = display_rgba(original)
        prepared = original
        if profile == 'smart':
            # Normalize valid profiles to sRGB and retain display-critical metadata.
            # Untagged output is interpreted as sRGB by ordinary image viewers.
            prepared = reference.copy()
            preserved_profile = reference.info.get('icc_profile')
            prepared.info.clear()
            if preserved_profile:
                prepared.info['icc_profile'] = preserved_profile
            orientation = original.getexif().get(274)
            if orientation is not None:
                exif = Image.Exif()
                exif[274] = orientation
                prepared.info['exif'] = exif.tobytes()
        if profile == 'smart' and original.format == 'PNG' and original.mode == 'P':
            min_ssim = max(min_ssim, 0.985)
        # Animated PNG/WebP are preserved; GIF can use lossless gifsicle.
        animated = getattr(original, 'n_frames', 1) > 1

        def consider(data: bytes, label: str, lossless: bool = False) -> bool:
            nonlocal best, method, best_ssim, best_psnr
            if not data or len(data) >= len(best):
                return False
            with Image.open(io.BytesIO(data)) as candidate:
                candidate.load()
                if original.size != candidate.size or original.format != candidate.format:
                    return False
                if profile != 'smart' and original.info.get('icc_profile') != candidate.info.get('icc_profile'):
                    return False
                if original.getexif().get(274) != candidate.getexif().get(274):
                    return False
                if lossless:
                    if not same_pixels(original, candidate):
                        return False
                    ssim, psnr = 1.0, math.inf
                else:
                    if getattr(candidate, 'n_frames', 1) != 1:
                        return False
                    alpha = np.asarray(original.convert('RGBA').getchannel('A'), dtype=np.int16)
                    other = np.asarray(candidate.convert('RGBA').getchannel('A'), dtype=np.int16)
                    # Smart palette quantization may adjust partial alpha, as TinyPNG
                    # does. Keep zero alpha exact and opaque pixels nearly opaque.
                    allowed = 64 if profile == 'smart' else 0
                    opaque_allowance = 4 if profile == 'smart' else 0
                    if (np.max(np.abs(alpha - other)) > allowed
                            or np.any((alpha == 0) & (other != 0))
                            or np.any((alpha == 255) & (other < 255 - opaque_allowance))):
                        return False
                    ssim, psnr = measure_quality(reference, candidate)
                    if ssim < min_ssim or psnr < min_psnr:
                        return False
                best, method, best_ssim, best_psnr = data, label, ssim, psnr
                return True

        if original.format == 'JPEG' and original.mode in ('RGB', 'L'):
            consider(optimize_jpeg(source_bytes), 'JPEG lossless entropy optimization', True)
            for quality in sorted({start_quality, *range(start_quality + 5, 96, 5), 95}):
                accepted = consider(
                    optimize_jpeg(encode(prepared.convert(original.mode), 'JPEG', quality=quality, subsampling=0,
                                         optimize=True, progressive=True)),
                    f'JPEG quality={quality}, 4:4:4, progressive',
                )
                if accepted:
                    break
        elif original.format == 'PNG' and not animated:
            consider(encode(original, 'PNG', optimize=True, compress_level=9), 'PNG lossless', True)
            if original.mode == 'P':
                consider(encode_palette_png(original), 'PNG lossless compact palette', True)
            if shutil.which('oxipng'):
                consider(external_candidate('oxipng', source), 'oxipng lossless', True)
            if source.stat().st_size > 30_000 and original.mode in ('RGB', 'RGBA') and shutil.which('pngquant'):
                consider(external_candidate('pngquant', source), 'pngquant 90-100')
            if imagequant is not None and profile == 'smart' and original.mode in ('RGB', 'RGBA', 'P'):
                # Full-color photographs/gradients retain at least 128 colors.
                # Already-indexed art can also try compact, lower-bit palettes.
                counts = (256, 192, 128) if original.mode != 'P' else (256, 192, 128, 96, 64, 32, 16, 8)
                for colors in counts:
                    for dithering in (0.0, 0.5):
                        quantized = imagequant.quantize_pil_image(
                            prepared.convert('RGBA'), max_colors=colors,
                            dithering_level=dithering, min_quality=0, max_quality=100,
                        )
                        quantized.info.update({key: prepared.info[key] for key in
                                               ('icc_profile', 'exif', 'dpi') if key in prepared.info})
                        consider(encode_palette_png(quantized),
                                 f'libimagequant colors={colors}, dithering={dithering}')
        elif original.format == 'GIF' and shutil.which('gifsicle'):
            consider(external_candidate('gifsicle', source), 'gifsicle lossless', True)
        elif original.format == 'WEBP' and not animated:
            consider(encode(original, 'WEBP', lossless=True, method=6, exact=True), 'WebP lossless', True)
            for quality in range(max(start_quality, 80), 96, 5):
                if consider(encode(original, 'WEBP', quality=quality, method=6), f'WebP quality={quality}'):
                    break
    return best, method, best_ssim, best_psnr


def write_new_file(target: Path, data: bytes) -> None:
    """Publish atomically without overwriting existing files."""
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.compress-', delete=False) as file:
        temporary = Path(file.name)
        try:
            file.write(data)
            file.close()
            try:
                os.link(temporary, target)
            except OSError as error:
                if error.errno not in {errno.EPERM, errno.EACCES, errno.EXDEV,
                                       errno.ENOSYS, errno.ENOTSUP}:
                    raise
                # FAT/exFAT and some network shares do not support hard links.
                # Exclusive creation still protects existing files on these disks.
                created = False
                try:
                    with target.open('xb') as destination:
                        created = True
                        destination.write(data)
                except BaseException:
                    if created:
                        remove_if_present(target)
                    raise
        finally:
            remove_if_present(temporary)


def remove_if_present(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def create_flat_directory(output: Path, label: str = '0000') -> Path:
    """Create a collection beside the output, without mixing previous runs."""
    number = 1
    while True:
        name = label if number == 1 else f'{label}-{number}'
        candidate = output.parent / name
        try:
            candidate.mkdir()
            return candidate
        except FileExistsError:
            number += 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='One image or a directory (recursive)')
    parser.add_argument('-o', '--output', type=Path, help='New output directory; keeps subdirectories')
    parser.add_argument('--profile', choices=PROFILES, default='smart')
    parser.add_argument('--flat', action='store_true', help='Also copy results into a sibling 0000 directory')
    parser.add_argument('--flat-name', default='0000', help='Name of the optional sibling collection')
    parser.add_argument('--events', action='store_true', help='Emit per-file JSON progress for the GUI')
    args = parser.parse_args()
    source = args.input.expanduser().resolve()
    if not source.exists():
        parser.error(f'Input does not exist: {source}')
    if source.is_file() and source.suffix.lower() not in EXTENSIONS:
        parser.error(f'Unsupported extension: {source.suffix}')
    output = (args.output or source.with_name(source.stem + '-compressed')).expanduser().resolve()
    if output == source or source in output.parents:
        parser.error('Output must be outside the input directory')
    if output.exists():
        parser.error('Output already exists; choose a new directory')
    base = source if source.is_dir() else source.parent
    files = [source] if source.is_file() else sorted(
        path for path in source.rglob('*')
        if path.is_file() and not path.is_symlink() and path.suffix.lower() in EXTENSIONS
    )
    if not files:
        parser.error('No supported images found')
    label = args.flat_name.strip()
    if not label or label in {'.', '..'} or any(c in label for c in '/\\\0:'):
        parser.error('汇总目录名称无效')
    if label == output.name:
        parser.error('汇总目录与压缩结果目录不能同名')
    output.mkdir(parents=True)
    multiple_directories = len({path.parent for path in files}) > 1
    flat_output = create_flat_directory(output, label) if args.flat and multiple_directories else None
    counts = Counter(path.name for path in files)
    used_names = {path.name for path in files if counts[path.name] == 1}
    rows = []
    for index, path in enumerate(files, 1):
        row = {'file': path.relative_to(base).as_posix(), 'status': 'ok', 'original_bytes': 0,
               'compressed_bytes': 0, 'saved_percent': 0, 'method': '', 'block_ssim': '',
               'psnr_db': '', 'flat_file': '', 'error': ''}
        try:
            data, method, ssim, psnr = compress_image(path, args.profile)
            write_new_file(output / path.relative_to(base), data)
            if flat_output is not None:
                name = path.name
                if counts[name] > 1:
                    digest = hashlib.sha256(str(path.relative_to(base)).encode()).hexdigest()[:12]
                    name = f'{path.stem}__{digest}{path.suffix}'
                    while name in used_names:
                        name = '_' + name
                    used_names.add(name)
                write_new_file(flat_output / name, data)
                row['flat_file'] = Path(os.path.relpath(flat_output / name, output)).as_posix()
            before = path.stat().st_size
            row.update(original_bytes=before, compressed_bytes=len(data),
                       saved_percent=round((1 - len(data) / before) * 100, 2),
                       method=method, block_ssim=round(ssim, 6),
                       psnr_db=round(psnr, 2) if math.isfinite(psnr) else 'infinity')
        except Exception as error:
            row.update(status='error', error=str(error))
        rows.append(row)
        print(f'[{index}/{len(files)}] {row["file"]}: {row["saved_percent"]}% {row["error"]}', flush=True)
        if args.events:
            print(json.dumps({'event': 'file', 'index': index, 'file': row['file'],
                              'status': row['status'], 'before': row['original_bytes'],
                              'after': row['compressed_bytes'], 'saved_percent': row['saved_percent'],
                              'error': row['error']}, ensure_ascii=False), flush=True)
    report = io.StringIO(newline='')
    writer = csv.DictWriter(report, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    write_new_file(output / 'compression-report.csv', report.getvalue().encode('utf-8-sig'))
    successful = [row for row in rows if row['status'] == 'ok']
    before = sum(row['original_bytes'] for row in successful)
    after = sum(row['compressed_bytes'] for row in successful)
    if flat_output is not None:
        print(f'汇总目录：{flat_output}', flush=True)
    print(json.dumps({'output': str(output),
                      'flat_output': str(flat_output) if flat_output is not None else None,
                      'success': len(successful),
                      'failed': len(rows) - len(successful), 'before': before, 'after': after,
                      'saved_percent': round((1 - after / before) * 100, 2) if before else 0},
                     ensure_ascii=False))
    return 0 if len(successful) == len(rows) else 1


if __name__ == '__main__':
    sys.exit(main())
