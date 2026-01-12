```
extension.vsix/
├── extension/                   # 扩展的实际内容（即上述开发目录中需包含的文件）
│   ├── package.json
│   ├── README.md
│   ├── LICENSE
│   ├── media/
│   │   └── icon.png
│   └── dist/                    # 若使用构建工具（如 webpack），可能输出到 dist 而非 src
│       └── extension.js
│
├── extension.vsixmanifest       # 自动生成：VSIX 元数据（来自 package.json）
└── [Content_Types].xml          # ZIP 标准文件，描述 MIME 类型
```
