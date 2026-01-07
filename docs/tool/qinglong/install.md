安装青龙

✅ 1. 查看正在运行的容器
  docker ps

  --------------
  CONTAINER ID   IMAGE                    COMMAND                   CREATED          STATUS          PORTS                                         NAMES
04bb82d21bd0   whyour/qinglong:2.11.3   "./docker/docker-ent…"   30 minutes ago   Up 30 minutes   0.0.0.0:5700->5700/tcp, [::]:5700->5700/tcp   qinglong

✅ 2. 停止并删除容器
docker stop qinglong
docker rm qinglong

  或者强制删除：
  docker rm -f qinglong

✅ 3. 查看所有青龙相关的镜像
docker images | grep qinglong

---------------------------
whyour/qinglong   latest    843e870bdd2b   2 weeks ago    571MB
whyour/qinglong   2.18.3    fd26193b712f   3 months ago   559MB
whyour/qinglong   2.11.3    5ed4e98834d5   3 years ago    799MB

✅ 4. 删除镜像
docker rmi whyour/qinglong:latest
docker rmi whyour/qinglong:2.11.3

  如果提示有多个 Tag 引用了同一个镜像 ID，可以加上 -f 强制删除：
  docker rmi -f chinnkarahoi/jd_qinglong:latest


- whyour/qinglong:2.11.3
- whyour/qinglong:2.18.3 

cd /Users/zhulijian/apps/docker

docker run -d \
  -p 5700:5700 \
  -v $(pwd)/ql/data:/ql/data \
  -v $(pwd)/ql/config:/ql/config \
  -v $(pwd)/ql/log:/ql/log \
  -v $(pwd)/ql/db:/ql/db \
  --name qinglong \
  --hostname qinglong \
  --restart unless-stopped \
  whyour/qinglong:2.18.3


# 新建数据文件夹

    mkdir qinglong
    cd qinglong

# 下载 docker-compose.yml 文件

    wget https://raw.githubusercontent.com/whyour/qinglong/develop/docker-compose.yml

# 启动

    docker-compose up -d

拉库命令：

国内鸡

    ql repo https://ghproxy.com/github.com/galabug/jd_scripts-1.git "jd*|jx*|getJDCookie" "activity|backUp" "^jd[^_]|USER|utils|function"
    ql repo https://ghproxy.com/github.com/utterliar1/jd_scripts.git "jd*|jx*|getJDCookie" "activity|backUp" "^jd[^_]|USER|utils|function"

    https://github.com/utterliar1/jd_scripts.git

国外鸡

    ql repo https://github.com/galabug/jd_scripts-1.git "jd*|jx*|getJDCookie" "activity|backUp" "^jd[^_]|USER|utils|function"
    ql repo https://github.com/utterliar1/jd_scripts.git "jd*|jx*|getJDCookie" "activity|backUp" "^jd[^_]|USER|utils|function"

1.出现这种错误：
Cannot find module 'xxxx'
依赖不完整，解决方法：

    docker exec -it qinglong(容器名称) bash
    cd /ql/scripts/
    pnpm install 'xxxx'
    npm install 'xxxx'

这两个安装命令都可以用 2.出现这种错误：
Cannot find module './xxxx'
那就很有是拉库命令不完整，请检查或复制完整的拉库命令。
部分需要的依赖：自行安装

    "npm install -g npm"
    "pip3 install requests"
    "pip3 install pytz"
    "npm install -g download"
    "pnpm install jsdom"
    "apk add --no-cache build-base g++ cairo-dev pango-dev giflib-dev && cd scripts && npm install canvas png-js md5 date-fns axios crypto-js tslib ts-md5 @types/node --build-from-source"

腾讯云教程

    https://66ccff.work/teach/jd.html

    jd_token:github 的 token PAT by 2021-10-27
    xxxxx

    qingloing
    邮箱 SMTP 授权码
    xxxxx
    xxx/xxx

#查看 Linux 系统版本的命令,此命令也适用于所有的 Linux 发行版。

    cat /etc/issue
