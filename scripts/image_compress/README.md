# 图片压缩脚本

保持原尺寸和格式，批量压缩 JPEG、PNG、GIF、WebP，保留目录结构，输出 CSV 明细。
启动入口兼容 Python 2.7 / Python 3；压缩引擎与图形界面实际使用 Python 3.7+。
所有处理在本地完成。原文件不会被修改，输出目录必须是尚不存在的新目录。
新版默认 `smart` 模式，依据 TinyPNG 网页的多样本实测实现离线近似压缩。
完整实测数据与推断边界见 [TINYPNG-ANALYSIS.md](TINYPNG-ANALYSIS.md)。

## 便携版本（推荐）

`start.py` 可以用 Python 2.7 启动，会自动找到并调用本机 Python 3.7+ 执行 `start_modern.py`。
仅有 Python 2.7 的电脑仍需安装 Python 3，或通过 `IMAGE_COMPRESS_PYTHON3` 指定 Python 3
可执行文件的完整路径。此兼容方式保留当前 Pillow、NumPy 和增强组件的压缩效果。
Python 3.7 会使用 Pillow 9.5.0、NumPy 1.21.6、imagequant 1.1.0 和 MozJPEG 优化组件 1.1.3；
Python 3.8 和 3.9+ 自动使用各自兼容的依赖。旧版库输出体积可能略有不同；图形界面、
压缩模式、分目录和同级 `0000` 功能保持一致。增强组件无对应平台预编译包时回退基础功能。
已在 macOS 使用 PyPy 的 Python 2.7.18 实测启动转接和中文路径批量压缩；图形界面实际处理
两张图片及同级 `0000` 汇总已验证。Windows/Linux 尚未进行真机验证。
另在 macOS 的 CPython 3.7.17 中通过全部 45 项 Python 测试，并成功批量压缩 8 张样本。
浏览器代码通过 ES2015 严格语法检查和 10 项禁用新版 API 的界面测试。

默认提供图形界面：双击系统启动脚本，或运行 `python3 start.py`，会在本机浏览器打开工具。
界面文字使用中文，核心布局参考 TinyPNG：点击拖放区选择多张图片，或选择整个文件夹，
也可直接拖入文件或目录。每张结果显示压缩前大小、压缩后大小和节省比例，支持单张下载、
全部打包下载，以及打开结果/0000 目录。可设置输出位置、目录名称和压缩模式。
浏览器选择的图片仅复制到本机临时目录；默认结果保存在用户的 Pictures/ImageCompressor 中，
可通过“输出到”更改。整个文件夹会保留内部子目录；同时拖入多个文件夹时保留各文件夹名称。
也可展开“使用本机路径”直接选择路径，此时默认输出到原图旁边。
仅一个实际包含图片的目录时不生成汇总目录；多个图片目录时出现汇总勾选项。
汇总目录默认名为 `0000`，可以自行命名；与压缩结果目录同级，同名时自动加编号。
命令行同样跳过单目录汇总；多目录使用 `--flat-name 自定义名称` 或 `--no-flat` 控制。
点击“停止任务”会停止后台进程，已完成的文件保留；重试会使用新的输出目录。
不需要 tkinter 或额外的桌面图形库，图片不会上传到网络服务器。界面只监听本机回环地址，
每次启动生成独立的访问令牌。点击“退出工具”关闭本机服务，单独关闭浏览器页面不会停止它。
浏览器脚本按 ES2015 语法交付，无需编译；请求使用 XMLHttpRequest + Promise，不依赖
async/await、fetch、Array.includes、replaceChildren 或原生 dialog。上传使用原生 file / webkitdirectory 控件，
目录拖入使用 webkitGetAsEntry 并循环读取所有批次；本机路径浏览使用自定义弹层，
提供 Escape 关闭、键盘焦点循环和焦点恢复。按 Chrome 83 的能力范围实现，尚未在实际 Chrome 83 上运行验证。
浏览器仍需支持 ES2015（包括 Promise），
不承诺支持 IE11。布局提供 Flexbox 和静态颜色回退。

整个工具目录可以移动到 Windows、macOS 或 Linux，推荐使用 Python 3.11 / 3.12 作为引擎。
Windows 双击 `start.bat`，macOS 双击 `start.command`；Linux 执行 `sh start.command`。
第一次点击“开始压缩”时自动安装依赖；有 `wheels` 目录时只从本地安装，否则联网安装。
直接指定输入路径仍使用命令行；也可用 `--cli` 进入交互式路径输入。命令行示例：

```bash
python3 start.py "/path/to/images"
python3 start.py "/path/to/images" --profile gentle
python3 start.py "/path/to/images" --no-flat
python3 start.py --cli
```

启动器默认保留目录结构；多个图片目录且开启汇总时，在输出目录旁增加独立的汇总目录。
`0000` 与输出目录同级，不放在输出目录内与模块目录同级。已有 `0000` 时使用 `0000-2`、
`0000-3`，避免混入或覆盖之前的结果。同名图片加稳定的路径摘要，CSV 中汇总路径相对输出
目录记录，例如 `../0000/icon.png`。自动输出目录已存在时递增编号，显式 `-o` 不覆盖已有目录。

```text
目标位置/
├── images-compressed/
│   ├── Banner/
│   ├── anniMenu/
│   └── compression-report.csv
└── 0000/
    └── 所有压缩图片
```

便携包不含 `.venv` / `.runtime`。移动后的 `.runtime` 不可直接跨系统复用，启动器检查
目录、Python 版本和平台后重建环境；携带匹配目标平台的 `wheels` 目录后，移动也能离线安装。
程序文件应放在可写目录中。首次自动尝试安装 `imagequant` 和 MozJPEG 无损优化的本机
二进制包；不支持的平台会回退基础功能，不自动编译 C 代码。没有增强组件时压缩率较低。
Windows/Linux 已提供入口但尚未真机验证；当前测试平台为 macOS。

重新打包（只用 Python 标准库，不会打入本机环境）：

```bash
python3 scripts/image_compress/package.py /path/to/ImageCompressor-portable.zip
```

## 内网与离线安装

内网电脑仍需要已经安装 Python 3.7+，并具备 venv / ensurepip。图片压缩本身完全本地运行。
离线 ZIP 包附带 `wheels` 目录时，解压后执行 `python3 start.py --offline` 即可；也可直接启动界面。
`--offline` 禁止依赖安装访问索引，缺少或不匹配的依赖会直接报错，不会回退联网。
离线安装采用 pip 的 `--no-index --find-links` 方式，并禁用外部 pip 配置，
参见 [pip 官方说明](https://pip.pypa.io/en/stable/cli/pip_download/)。
通过 `--wheel-dir /本地依赖目录` 可指定独立的依赖目录（同时启用离线模式）。

在联网电脑为 Linux aarch64、CPython 3.12 准备依赖（glibc 2.17+，不适用于 Alpine / musl）：

```bash
python3 prepare_offline.py --python-version 3.12 --platform manylinux2014_aarch64 --abi cp312 --implementation cp
```

把整个工具目录连同 `wheels` 复制进内网，运行：

```bash
python3 start.py --offline --setup-only
python3 start.py --offline
```

也可在与目标电脑系统、架构、Python 小版本相同的联网电脑执行 `python3 prepare_offline.py`。
依赖包不能跨架构通用；例如 Windows、macOS、ARM32 和其他 Python 小版本需要重新准备。
源码仓库可使用 `package.py 输出.zip --wheels /依赖目录` 把依赖一起打包。

详细使用说明和常见问题见 `开始使用.txt`。

## 安装和使用

在仓库根目录执行一次：

```bash
python3 -m venv scripts/image_compress/.venv
scripts/image_compress/.venv/bin/pip install -r scripts/image_compress/requirements.txt
# 增强组件，常见系统有预编译包；没有对应包时可省略
scripts/image_compress/.venv/bin/pip install --only-binary=:all: \
  -r scripts/image_compress/requirements-advanced.txt
```

压缩单张图片或整个目录，包括子目录：

```bash
# 默认 smart 模式，按图片内容和画质检查选择参数
scripts/image_compress/.venv/bin/python scripts/image_compress/compress.py \
  /path/to/photo.jpg -o /path/to/photo-compressed

scripts/image_compress/.venv/bin/python scripts/image_compress/compress.py \
  /path/to/images -o /path/to/images-compressed

# 更保守的画质门槛
scripts/image_compress/.venv/bin/python scripts/image_compress/compress.py \
  /path/to/images -o /path/to/images-gentle --profile gentle
```

省略 `-o` 时在输入旁创建 `<名称>-compressed` 目录。Windows 使用虚拟环境的
`.venv\Scripts\python.exe` 和 `.venv\Scripts\pip.exe`。

输出示例：

```text
images-compressed/
├── Banner/example.jpg
├── anniMenu/icon.png
└── compression-report.csv
```

报告包含每个文件的压缩前后字节数、节省比例、编码方式、块 SSIM、PSNR 和错误。
直接使用 `compress.py` 时加 `--flat` 可在输出目录旁生成 `0000`，`start.py` 默认已开启。
有文件失败时继续处理其他图片，最终退出码为 1；全部成功为 0。运行参数错误为 2。
格式由实际文件内容识别，处理范围由文件扩展名筛选。无法识别的损坏文件会报告错误。

## 实现方式

JPEG 使用渐进式编码、优化熵编码、4:4:4 色度采样，不缩放图片。
`smart` 从 quality=45 开始，以 5 为步长提高到 95；`reference` 从 65 开始，`gentle` 从 85 开始。
接受第一个比当前结果小且通过画质检查的有损候选；始终先尝试 JPEG 无损优化。
安装 MozJPEG 优化组件后，还会优化编码的霍夫曼表和渐进扫描，保持该候选的解码像素。
质量数值是编码器参数，不等同于“保留百分之多少画质”。

| 模式 | JPEG 起始 quality | 最低块 SSIM | 最低 PSNR |
| --- | --- | --- | --- |
| smart | 45 | 0.97 | 38 dB |
| reference | 65 | 0.97 | 38 dB |
| gentle | 85 | 0.98 | 40 dB |

`smart` 对已有调色板的 PNG 使用更保守的最低块 SSIM=0.985，全彩 PNG 与 JPEG 同为 0.97。
画质检查先将有效 ICC 配置转换到 sRGB，
再在白色、黑色背景上各计算一次，取较低分数。无效/不支持的 ICC 配置保留，退回原始像素比较。
`reference` / `gentle` 要求透明通道逐像素完全一致；`smart` 允许部分透明通道每像素最多
64/255 的变化，完全透明像素保持透明，原不透明像素保持 alpha≥251，同时必须通过画质检查。
这里的 SSIM 是覆盖整张图片、包含边缘的 8×8 块均值，并非 scikit-image 的滑动窗口实现，
不同实现的分数不能直接比较。分数不能替代对文字、渐变和产品细节的人工检查。

PNG 先做无损优化，整理调色板并选择 1/2/4/8 位索引；`smart` 通过 libimagequant 尝试不同
颜色数与抖动强度。全彩图片尝试 256/192/128 色，已有调色板的图片还会尝试更少颜色。
候选必须通过上述画质和透明度门槛。安装 `oxipng`、`pngquant` 后还会尝试其优化结果。
GIF 有 `gifsicle` 时尝试无损优化，逐帧验证像素、时长、循环设置；
帧合并或任何差异都会回退原文件。静态 WebP 尝试无损和有损重编码，保留 WebP 格式。
动态 PNG/WebP 直接复制，避免丢失动画。CMYK JPEG 等非 RGB/灰度 JPEG 也保留原文件。

可选工具在 macOS 上安装：

```bash
brew install oxipng pngquant gifsicle
```

没有可选工具也能运行。`smart` 的有损候选转换有效 ICC 配置到 sRGB，保留 EXIF 方向，
去掉其他非显示元数据；无效配置保留。`reference` / `gentle` 则保留 ICC 和 JPEG EXIF。
文件系统时间戳及部分非显示元数据不会保留。文件未变小时直接复制原文件。
避免反复压缩已有的有损图片，优先从原图生成需要的版本。

## 对附件的实际分析

用户提供的两份附件均为 **179,637 字节、1920×1920**，SHA-256 完全相同：
`e9073a91f7a4f28cef4f04d8f0bcb06e9908b34b63363b69cab1fb6c34c232eb`。
因此，两份附件本身没有“压缩前后”的差异。以下原图来自此前下载的对应商品图片：
`20251021/28a3a3bf918e4e71afaffd8fc22e8412.jpg`。

| 文件 | 字节数 | 相对原图减少 |
| --- | ---: | ---: |
| 此前下载的原图 | 1,358,397 | — |
| 两份相同的附件 | 179,637 | 86.78% |
| 早期 Pillow 版本 reference 模式实测 | 216,127 | 84.09% |

附件的 JPEG 量化表与标准 quality=65 完全一致，使用渐进式 JPEG 和 4:4:4 采样。
本脚本复用了这些可确认的参数，并增加画质检查。不同编码器、预处理或中间重编码可能
产生不同体积，仅凭最终文件无法断定原工具采用的完整算法，也不保证逐字节复现。

早期版本对 269 张图片批量实测全部成功，23,608,475 字节降为 16,679,376 字节，减少
29.35%。新版另做了 10 张不同原图的网页/本地对照，详情见分析报告，压缩率取决于图片内容。

自行比较两张图片：

```bash
scripts/image_compress/.venv/bin/python scripts/image_compress/compare.py \
  /path/to/before.jpg /path/to/after.jpg
```

该命令输出 JSON：文件大小、尺寸、SHA-256、渐进式编码、采样方式、匹配的标准 JPEG
quality，以及同尺寸静态图片的块 SSIM 和 PSNR。画质指标按有效 ICC 配置先转换到 sRGB，
不进行 EXIF 旋转；用于比较同一原图的压缩结果。

运行测试：

```bash
scripts/image_compress/.venv/bin/python -m unittest discover \
  -s scripts/image_compress -p 'test_*.py' -v
```

仓库内另可运行浏览器兼容测试（只用于开发，便携工具运行不需要 Node.js）：

```bash
node --test scripts/image_compress/test_gui_browser.mjs
```

测试会按 ES2015 严格解析脚本，并禁用上述新版 API，验证文件选择、提交、进度、结果和错误提示。
