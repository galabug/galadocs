# 同版本 前缀相同,包名不同

```
{
  "version": "1.32.3",
  "bin": {
    "win": {
      "sys64": "https://vscode.cdn.azure.cn/stable/a3db5be9b5c6ba46bb7555ec5d60178ecc2eaae4/VSCodeSetup-x64-1.32.3.exe",
      "sys32": "https://vscode.cdn.azure.cn/stable/a3db5be9b5c6ba46bb7555ec5d60178ecc2eaae4/VSCodeSetup-ia32-1.32.3.exe",
      "zip64": "https://vscode.cdn.azure.cn/stable/a3db5be9b5c6ba46bb7555ec5d60178ecc2eaae4/VSCode-win32-x64-1.32.3.zip",
      "zip32": "https://vscode.cdn.azure.cn/stable/a3db5be9b5c6ba46bb7555ec5d60178ecc2eaae4/VSCode-win32-ia32-1.32.3.zip"
    },
    "mac": {
      "zip": "https://vscode.cdn.azure.cn/stable/a3db5be9b5c6ba46bb7555ec5d60178ecc2eaae4/VSCode-darwin-stable.zip"
    }
  }
}
```

使用例子
已知
https://vscode.download.prss.microsoft.com/dbazure/download/stable/6261075646f055b99068d3688932416f2346dd3b/VSCodeUserSetup-x64-1.73.1.exe

想要 zip 包 VSCode-win32-x64-1.73.1.zip
https://vscode.download.prss.microsoft.com/dbazure/download/stable/6261075646f055b99068d3688932416f2346dd3b/VSCode-win32-x64-1.73.1.zip

# windows 新建指定插件保存目录的快捷方式

新建快捷方式
右键-属性-目标改成下面
"D:\VSCode1.73.0\Code.exe" --extensions-dir "D:\VSCode1.73.0\extensions"

# vscode 运行 java

- 1.下载并运行「Java Extension Pack」
- 2.下载并运行「JDK」；
- 3.配置「Environment Variable」.

  1.Java Extension Pack 帮我们整理的六个最常用 VSCodeJava 插件。如下：
  Language Support for Java(TM) by Red Hat
  Debugger for Java
  Java Test Runner
  Maven for Java
  Project Manager for Java
  Visual Studio IntelliCode

  2.配置「Environment Variable」.

# setting.json_1.5.0+

```
{
  "vetur.format.defaultFormatter.html": "prettyhtml",
  // js格式化规则
  "vetur.format.defaultFormatter.js": "vscode-typescript",
  // emmet语法关联
  "emmet.syntaxProfiles": {
    "vue-html": "html",
    "vue": "html"
  },
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": { "source.fixAll.eslint": true },
  "eslint.validate": ["javascript", "vue", "html"],
  "eslint.format.enable": true,
  "[vue]": {
    "editor.defaultFormatter": "dbaeumer.vscode-eslint"
  },
  // 编辑器tab缩进长度
  "editor.tabSize": 2,
  // 字符串使用单引号
  "javascript.preferences.quoteStyle": "single",
  "typescript.preferences.quoteStyle": "single",
  // 控制编辑器在空白字符上显示特殊符号的方式
  "editor.renderWhitespace": "boundary",
  // 关闭-按tab键 输入空格
  // "editor.insertSpaces": false,
  //关闭-根据文件自动选择缩进tabzise类型
  "editor.detectIndentation": false,
  //插件更新提醒
  "extensions.autoUpdate": false,
  // "update.channel": "none",
  "update.enableWindowsBackgroundUpdates": false,
  "git.autofetch": true,
  "explorer.confirmDelete": false,
  "diffEditor.ignoreTrimWhitespace": false,
  "editor.fontSize": 16,
  // "window.zoomLevel": -1,
  "[javascript]": {
    "editor.defaultFormatter": "vscode.typescript-language-features"
  },
  "[html]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "javascript.updateImportsOnFileMove.enabled": "always",
  "explorer.confirmDragAndDrop": false,
  "gitlens.advanced.messages": {
    "suppressLineUncommittedWarning": true
  },
  "[jsonc]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "workbench.preferredDarkColorTheme": "Monokai",
  "editor.suggestSelection": "first",
  "vsintellicode.modify.editor.suggestSelection": "automaticallyOverrodeDefaultValue",
  "workbench.colorTheme": "Panda Syntax",
  "editor.linkedEditing": true,
  "workbench.editorAssociations": {
    "*.ipynb": "jupyter-notebook"
  },
  "editor.largeFileOptimizations": false,
  "notebook.cellToolbarLocation": {
    "default": "right",
    "jupyter-notebook": "left"
  },
  "workbench.startupEditor": "none"
}

```
