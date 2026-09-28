- 设置 npm 镜像源

```bash
    npm config set registry http://devops.hzbtest:38081/repository/hzbank-npm-group-public
```

- 设置 阿里 镜像源

```bash
  npm config set registry https://registry.npmmirror.com
```

- 安装指定 镜像源

```bash
  npm i --registry=http://devops.hzbtest:38081/repository/hzbank-npm-group-public --no-audit
  npm i --registry=https://registry.npmmirror.com --no-audit
```

- 打印详细日志
  npm install --verbose
  npm install --loglevel verbose
  npm config set loglevel verbose
