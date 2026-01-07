# 文件删除命令文档

## 删除指定文件（Linux/Unix 系统）

```bash
find . -name "*.web.js" -type f -print -exec rm -r {} \;
```

### 说明
- `find .`：从当前目录开始查找。
- `-name "*.web.js"`：匹配所有以 `.web.js` 结尾的文件。
- `-type f`：仅查找文件（不包括目录）。
- `-print`：打印匹配的文件名。
- `-exec rm -r {} \;`：对每个匹配的文件执行 `rm -r` 命令进行删除。

---

## 删除指定文件（Windows 系统 - CMD）

```cmd
del /a /f /q /s "D:\00code\PerMobileFive\dist\*.web.js"
```

### 说明
- `del`：删除文件命令。
- `/a`：按属性筛选文件（可选）。
- `/f`：强制删除只读文件。
- `/q`：静默模式（不提示确认）。
- `/s`：删除所有子目录中的匹配文件。
- `"D:\00code\PerMobileFive\dist\*.web.js"`：指定要删除的文件路径和模式。