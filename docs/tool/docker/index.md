
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


cd /Users/zhulijian/Downloads/docker

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



docker run -d \
  -p 5700:5700 \
  -v $(pwd)/ql/data:/ql/data \
  -v $(pwd)/ql/config:/ql/config \
  -v $(pwd)/ql/log:/ql/log \
  -v $(pwd)/ql/db:/ql/db \
  --name qinglong \
  --hostname qinglong \
  --restart unless-stopped \
  whyour/qinglong:2.11.3

