
# 🛠 Git 分支管理指南


## 📌 1. 配置 Git 用户信息

```bash
git config --global user.email "153454219@qq.com"
git config --global user.name "galabug"
```

---

## 🔄 2. 切换分支

切换到任意非 `test` 或 `master` 的分支（例如 `dev`）：

```bash
git checkout dev
```

---

## 🗑 3. 删除本地分支

删除本地的 `test` 和 `master` 分支：

```bash
git branch -D test
git branch -D master
```

---

## 🧹 4. 清理本地残留的远程跟踪分支

### 重命名并删除远程跟踪分支 `origin/test`

```bash
git branch rd origin/test
git branch -D rd
```

### 重命名并删除远程跟踪分支 `origin/master`

```bash
git branch rd origin/master
git branch -D rd
```

---

## 🧼 5. 清理本地 Git 缓存（可选）

如果本地仍有缓存，可执行以下命令清理：

```bash
git gc --prune=now
```

---

## 🔄 6. 更新远程仓库信息

```bash
git fetch --all
```

---

## 🔁 7. 重新拉取 `master` 分支代码

```bash
git checkout master
```

---

## 🆕 8. 创建新开发分支

创建并切换到新的开发分支 `dev-func`：

```bash
git checkout -b dev-func
```
