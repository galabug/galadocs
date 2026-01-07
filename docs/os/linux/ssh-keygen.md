# SSH 密钥生成与服务器免密登录配置

## 生成 SSH 密钥

```bash
ssh-keygen -t rsa
```

### 说明
- 该命令会在 `~/.ssh/` 目录下生成默认的 RSA 类型密钥对（`id_rsa` 为私钥，`id_rsa.pub` 为公钥）。


## 复制当前服务器的公钥到目标服务器

```bash
ssh-copy-id -i ~/.ssh/id_rsa.pub 用户名@ip
```

### 说明
- 该命令会将当前服务器的公钥复制到目标服务器的 `~/.ssh/authorized_keys` 文件中。
- 需要输入目标服务器对应用户名的密码。

---

## 使用 SSH 登录目标服务器

```bash
ssh pmbt@197.68.21.155
```

---

## 没有 `ssh-copy-id` 命令时的手动配置

### 步骤 1：查看当前服务器的公钥

```bash
cat ~/.ssh/id_rsa.pub
```

- 复制输出的公钥内容。

---

### 步骤 2：将公钥追加到目标服务器的 `authorized_keys` 文件

```bash
echo '公钥' >> ~/.ssh/authorized_keys
```

- 替换 `'公钥'` 为实际复制的公钥内容。
- 该命令需在目标服务器上执行。