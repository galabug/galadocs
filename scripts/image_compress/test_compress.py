import contextlib
import errno
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageCms

from compress import compress_image, display_rgba, encode_palette_png, main, measure_quality, optimize_jpeg, write_new_file
from compare import inspect_image, main as compare_main


class CompressionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_jpeg_smaller_with_dimensions_orientation_and_profile_preserved(self):
        # Real image content: gradients and sharp text-like edges, not random noise.
        x, y = np.meshgrid(np.arange(256), np.arange(256))
        pixels = np.stack((x, y, (x + y) // 2), axis=2).astype(np.uint8)
        pixels[50:90, 30:200] = 10
        image = Image.fromarray(pixels)
        exif = Image.Exif()
        exif[274] = 6
        source = self.root / 'photo.jpg'
        image.save(source, quality=100, subsampling=0, exif=exif, icc_profile=b'test-profile')
        data, method, ssim, psnr = compress_image(source, 'reference')
        self.assertLess(len(data), source.stat().st_size)
        self.assertIn('JPEG', method)
        self.assertGreaterEqual(ssim, 0.97)
        self.assertGreaterEqual(psnr, 38)
        with Image.open(io.BytesIO(data)) as result:
            self.assertEqual(result.size, image.size)
            self.assertEqual(result.getexif()[274], 6)
            self.assertEqual(result.info['icc_profile'], b'test-profile')
            self.assertTrue(result.info['progressive'])

    def test_transparent_png_preserves_alpha_exactly(self):
        source = self.root / 'alpha.png'
        pixels = np.zeros((96, 128, 4), dtype=np.uint8)
        pixels[:, :, 0] = 200
        pixels[:, :, 3] = np.arange(128, dtype=np.uint8)[None, :] * 2
        Image.fromarray(pixels).save(source, compress_level=0)
        data, _, _, _ = compress_image(source, 'reference')
        self.assertLessEqual(len(data), source.stat().st_size)
        with Image.open(io.BytesIO(data)) as result:
            np.testing.assert_array_equal(np.asarray(result.convert('RGBA'))[:, :, 3], pixels[:, :, 3])

    def test_animation_timing_loop_and_all_frames_are_preserved(self):
        source = self.root / 'animation.gif'
        frames = [Image.new('RGB', (24, 24), color) for color in ('red', 'green', 'blue')]
        frames[0].save(source, save_all=True, append_images=frames[1:], duration=[40, 70, 120], loop=3)
        data, _, _, _ = compress_image(source, 'reference')
        with Image.open(source) as original, Image.open(io.BytesIO(data)) as result:
            self.assertEqual(result.n_frames, original.n_frames)
            self.assertEqual(result.info['loop'], 3)
            for index in range(original.n_frames):
                original.seek(index)
                result.seek(index)
                self.assertEqual(result.info['duration'], original.info['duration'])
                np.testing.assert_array_equal(np.asarray(result.convert('RGBA')), np.asarray(original.convert('RGBA')))

    def test_animated_png_is_copied_without_losing_frames(self):
        source = self.root / 'animated.png'
        first, second = [Image.new('RGBA', (20, 20), color) for color in ('red', 'blue')]
        first.save(source, save_all=True, append_images=[second], duration=[100, 200], loop=2)
        self.assertEqual(compress_image(source, 'reference')[0], source.read_bytes())

    def test_tiny_images_and_last_pixel_are_included_in_quality_check(self):
        original = Image.new('RGB', (1, 1), 'white')
        self.assertEqual(measure_quality(original, original), (1, float('inf')))
        ssim, psnr = measure_quality(original, Image.new('RGB', (1, 1), 'black'))
        self.assertLess(ssim, 0.01)
        self.assertEqual(psnr, 0)
        original = Image.new('RGB', (9, 9), 'white')
        changed = original.copy()
        changed.putpixel((8, 8), (0, 0, 0))
        self.assertLess(measure_quality(original, changed)[0], 1)

    def test_cli_recursion_keeps_duplicate_filenames_and_reports_bad_file(self):
        source = self.root / 'input'
        for group in ('Banner', '图标'):
            folder = source / group
            folder.mkdir(parents=True)
            Image.new('RGB', (10, 10), 'red').save(folder / 'same.png')
        (source / 'broken.jpg').write_bytes(b'not a jpeg')
        output = self.root / 'output'
        with patch('sys.argv', ['compress.py', str(source), '-o', str(output)]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 1)
        for group in ('Banner', '图标'):
            self.assertTrue((output / group / 'same.png').is_file())
        self.assertIn('broken.jpg', (output / 'compression-report.csv').read_text(encoding='utf-8-sig'))

    def test_existing_output_and_nested_output_are_rejected(self):
        source = self.root / 'input'
        source.mkdir()
        for output in (source, source / 'nested', self.root):
            with patch('sys.argv', ['compress.py', str(source), '-o', str(output)]), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    main()
                self.assertEqual(error.exception.code, 2)

    def test_atomic_write_never_overwrites_existing_data(self):
        target = self.root / 'existing.png'
        target.write_bytes(b'original')
        with self.assertRaises(FileExistsError):
            write_new_file(target, b'new data')
        self.assertEqual(target.read_bytes(), b'original')
        self.assertFalse(list(self.root.glob('.compress-*')))

    def test_external_disk_without_hard_links_still_writes_and_protects_files(self):
        target = self.root / 'external-disk.png'
        with patch('compress.os.link', side_effect=OSError(errno.ENOTSUP, 'no hard links')):
            write_new_file(target, b'first')
            with self.assertRaises(FileExistsError):
                write_new_file(target, b'second')
        self.assertEqual(target.read_bytes(), b'first')

    def test_flat_collection_preserves_subdirectories_and_duplicate_names(self):
        source = self.root / 'input'
        for group in ('Banner', '中文'):
            (source / group).mkdir(parents=True)
            Image.new('RGB', (16, 16), 'pink').save(source / group / 'same.png')
        output = self.root / 'output'
        with patch('sys.argv', ['compress.py', str(source), '-o', str(output), '--flat']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        flat = sorted((output.parent / '0000').glob('*.png'))
        self.assertEqual(len(flat), 2)
        self.assertFalse((output / '0000').exists())
        for group in ('Banner', '中文'):
            self.assertTrue((output / group / 'same.png').is_file())
        self.assertNotEqual(flat[0].name, flat[1].name)
        self.assertIn('../0000/', (output / 'compression-report.csv').read_text(encoding='utf-8-sig'))

    def test_original_module_named_0000_is_preserved_separately(self):
        source = self.root / 'input'
        (source / '0000').mkdir(parents=True)
        Image.new('RGB', (16, 16), 'pink').save(source / '0000' / 'same.png')
        output = self.root / 'output'
        with patch('sys.argv', ['compress.py', str(source), '-o', str(output), '--flat']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        self.assertTrue((source / '0000' / 'same.png').is_file())
        self.assertTrue((output / '0000' / 'same.png').is_file())
        self.assertTrue((output.parent / '0000' / 'same.png').is_file())

    def test_existing_sibling_collection_is_preserved_and_numbered(self):
        source = self.root / 'input.png'
        Image.new('RGB', (16, 16), 'pink').save(source)
        existing = self.root / '0000'
        existing.mkdir()
        (existing / 'keep.txt').write_text('previous run')
        output = self.root / 'output'
        with patch('sys.argv', ['compress.py', str(source), '-o', str(output), '--flat']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        self.assertEqual((existing / 'keep.txt').read_text(), 'previous run')
        self.assertTrue((self.root / '0000-2' / 'input.png').is_file())
        self.assertFalse((output / '0000').exists())
        self.assertIn('../0000-2/', (output / 'compression-report.csv').read_text(encoding='utf-8-sig'))

    def test_collection_follows_custom_output_location(self):
        source = self.root / 'input.png'
        Image.new('RGB', (16, 16), 'blue').save(source)
        output = self.root / '目标位置' / '压缩结果'
        with patch('sys.argv', ['compress.py', str(source), '-o', str(output), '--flat']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        copied = output.parent / '0000' / source.name
        self.assertEqual(copied.read_bytes(), (output / source.name).read_bytes())
        self.assertFalse((self.root / '0000').exists())
        self.assertFalse((output / '0000').exists())

    def test_compare_recognizes_reference_jpeg_and_duplicate_files(self):
        source = self.root / 'reference.jpg'
        Image.new('RGB', (24, 24), 'pink').save(
            source, quality=65, subsampling=0, progressive=True
        )
        info = inspect_image(source)
        self.assertEqual(info['matching_standard_jpeg_qualities'], [65])
        self.assertEqual(info['sampling'], '4:4:4')
        self.assertTrue(info['progressive'])
        copy = self.root / 'copy.jpg'
        copy.write_bytes(source.read_bytes())
        output = io.StringIO()
        with patch('sys.argv', ['compare.py', str(source), str(copy)]), contextlib.redirect_stdout(output):
            compare_main()
        report = json.loads(output.getvalue())
        self.assertTrue(report['identical_files'])
        self.assertEqual(report['saved_percent'], 0)
        self.assertEqual(report['block_ssim'], 1)

    def test_palette_compaction_preserves_rgba_palette_and_partial_transparency(self):
        image = Image.frombytes('P', (4, 1), bytes([7, 2, 7, 4]))
        palette = [0, 0, 0, 0] * 256
        palette[7 * 4:8 * 4] = [255, 30, 60, 128]
        palette[2 * 4:3 * 4] = [12, 180, 80, 0]
        palette[4 * 4:5 * 4] = [30, 40, 255, 255]
        image.putpalette(palette, rawmode='RGBA')
        encoded = encode_palette_png(image)
        with Image.open(io.BytesIO(encoded)) as result:
            np.testing.assert_array_equal(np.asarray(image.convert('RGBA')), np.asarray(result.convert('RGBA')))
        # PNG IHDR bit depth: three used indices fit in two bits.
        self.assertEqual(encoded[24], 2)

    def test_color_managed_comparison_preserves_alpha(self):
        image = Image.new('RGBA', (16, 16), (30, 150, 220, 127))
        image.info['icc_profile'] = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        normalized = display_rgba(image)
        np.testing.assert_array_equal(np.asarray(normalized), np.asarray(image))
        self.assertNotIn('icc_profile', normalized.info)
        self.assertEqual(measure_quality(image, Image.new('RGBA', image.size, (30, 150, 220, 127))), (1, float('inf')))

    def test_smart_mode_preserves_transparent_areas_and_bounds_alpha_changes(self):
        source = self.root / 'smart-alpha.png'
        x, y = np.meshgrid(np.arange(64), np.arange(64))
        pixels = np.stack((x * 4, y * 4, (x + y) * 2, x * 4), axis=2).astype(np.uint8)
        pixels[:, -1, 3] = 255
        Image.fromarray(pixels).save(source, compress_level=0)
        data, _, _, _ = compress_image(source, 'smart')
        with Image.open(io.BytesIO(data)) as result:
            alpha = np.asarray(result.convert('RGBA'))[:, :, 3].astype(int)
        self.assertTrue(np.all(alpha[:, 0] == 0))
        self.assertTrue(np.all(alpha[:, -1] >= 251))
        self.assertLessEqual(np.abs(alpha - pixels[:, :, 3].astype(int)).max(), 64)

    def test_basic_compression_works_without_optional_python_encoders(self):
        source = self.root / 'basic.png'
        Image.new('RGB', (80, 80), 'green').save(source, compress_level=0)
        with patch('compress.imagequant', None), patch('compress.mozjpeg_optimizer', None), patch('compress.shutil.which', return_value=None):
            data, _, _, _ = compress_image(source, 'smart')
        self.assertLess(len(data), source.stat().st_size)

    def test_older_mozjpeg_binding_keeps_display_metadata(self):
        from types import SimpleNamespace
        image = Image.new('RGB', (16, 16), 'pink')
        exif = Image.Exif()
        exif[274] = 6
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', exif=exif, icc_profile=b'profile')
        original = buffer.getvalue()
        with patch('compress.mozjpeg_optimizer', SimpleNamespace(optimize=lambda data: b'unsafe')):
            self.assertEqual(optimize_jpeg(original), original)


if __name__ == '__main__':
    unittest.main()
