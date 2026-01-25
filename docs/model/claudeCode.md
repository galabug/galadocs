# Claude Code

## Claude Code 超详细完整指南（2025）

- https://zhuanlan.zhihu.com/p/1971872808159141982

## win10 查找wsl里ubuntu系统的实际安装目录

Get-AppxPackage -Name "_Ubuntu_"

InstallLocation : C:\Program Files\WindowsApps\CanonicalGroupLimited.Ubuntu_2404.1.68.0_x64\*\*79rhkp1fndgsc

## claude code，解决地域限制问。(Claude Code might not be available in your country. Check supported countries )

- 1.搜索claude.json文件。

搜索所有可能的 Claude 配置文件/目录

find ~ -name "_claude_" -type f -name "\*.json" 2>/dev/null

- 2.打开claude.json文件。

open -a "TextEdit" ~/.claude.json

- 3.编辑claude.json文件

增加配置 "hasCompletedOnboarding": true,

# 参考 https://zhuanlan.zhihu.com/p/1994176170636378644

## 安装 claude-code

npm install -g @anthropic-ai/claude-code

claude --version

## 返回 版本号

# 修改环境变量，详见下方的【问题】

- win
  set ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
  set ANTHROPIC_AUTH_TOKEN=sk-你的DeepSeekKey

- linux
  在 ~/.bashrc 增加配置
  export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
  export ANTHROPIC_AUTH_TOKEN="sk-你的DeepSeekKey"
  export ANTHROPIC_MODEL="deepseek-chat"
  export ANTHROPIC_SMALL_FAST_MODEL="deepseek-chat"

或者直接输入

echo 'export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"' >> ~/.bashrc
echo 'export ANTHROPIC_AUTH_TOKEN="sk-30046c19e04649fc832820a27ca22cce"' >> ~/.bashrc
echo 'export ANTHROPIC_MODEL="deepseek-chat"' >> ~/.bashrc
echo 'export ANTHROPIC_SMALL_FAST_MODEL="deepseek-chat"' >> ~/.bashrc

source ~/.bashrc
验证配置：

# 验证变量是否被正确读取

echo $env:ANTHROPIC_BASE_URL
echo $env:ANTHROPIC_AUTH_TOKEN
