
**在 macOS 的 Safari调试安卓手机**
你再次遇到 `zsh: command not found: brew`，说明 **Homebrew 仍未安装** 或 **未正确配置到你的 shell 环境中**。

别担心，下面我将一步步带你 **完整安装 Homebrew 并验证成功**，适用于 **Intel 或 Apple Silicon（M1/M2/M3）Mac**。

---

### ✅ 第一步：确认你的 Mac 芯片类型

打开 **终端（Terminal）**，运行：
```bash
arch
```

- 如果输出 `i386` 或 `x86_64` → 你是 **Intel 芯片**
- 如果输出 `arm64` → 你是 **Apple Silicon（M1/M2/M3）**

> 记住结果，后面会用到。

---

### ✅ 第二步：安装 Homebrew

在终端中**复制粘贴以下命令并回车**：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> 🔐 系统可能会提示你输入密码（输入时不会显示字符，正常输入后按回车即可）

安装过程会自动下载并安装 Homebrew，可能需要几分钟。

---

### ✅ 第三步：根据芯片类型配置环境变量（关键！）

#### ▶ 如果你是 **Apple Silicon（M1/M2/M3）**（`arch` 输出 `arm64`）：
安装完成后，**必须**运行以下两行命令，否则 `brew` 命令仍找不到：

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

#### ▶ 如果你是 **Intel 芯片**（`arch` 输出 `x86_64`）：
通常不需要额外配置，但如果你之后仍报错，可以运行：
```bash
echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
```

---

### ✅ 第四步：验证是否安装成功

运行：
```bash
brew --version
```

✅ 成功时会输出类似：
```
Homebrew 4.2.15
```

如果还是报 `command not found`，请重启终端（完全关闭 Terminal 再打开），再试一次。

---

### ✅ 第五步：现在你可以安装 ADB 了！

```bash
brew install android-platform-tools
```

然后测试：
```bash
adb devices
```

手机上会弹出“允许 USB 调试” → 点 **允许**  
再次运行 `adb devices`，应看到设备序列号。

---

### ❓如果 curl 失败或网络问题？

在国内可能因网络问题无法下载。可改用国内镜像（如清华源）安装 Homebrew，方法如下：

```bash
# 替换为清华镜像安装脚本
/bin/bash -c "$(curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/install.git/raw/HEAD/install.sh)"
```

安装完后还需设置镜像源（可选但推荐）：
```bash
# 设置 brew 核心仓库镜像
git -C "$(brew --repo)" remote set-url origin https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git

# 设置 Core 镜像（公式）
git -C "$(brew --repo homebrew/core)" remote set-url origin https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git

# 重新生成环境
brew update
```

---

### 💡 小贴士：
- 所有通过 `brew` 安装的命令都会自动加入 PATH，无需手动配置（只要第三步做了）
- 如果你用的是 **iTerm2** 而不是系统 Terminal，也请重启 iTerm2

---

现在再试试：
```bash
brew --version
```

如果成功，恭喜你！接下来就可以愉快地用 `adb` 和 `chrome://inspect` 调试 Android 了 🎉

如果仍有问题，请告诉我：
- 你的 macOS 版本（点击左上角  > 关于本机）
- 芯片类型（Intel 还是 Apple Silicon）
- 执行 `echo $PATH` 的输出

我会继续帮你解决！