# Apache 转发配置文档

## 正则匹配-转发配置

```apache
ProxyPassMatch ^/perbankWebTest/xdid/(._)$ http://197.68.17.30:8080/xdid/$1
ProxyPassReverse ^/perbankWebTest/xdid/(._)$ http://197.68.17.30:8080/xdid/$1

ProxyPassMatch ^/perbankWeb/perbank/(._)$ http://197.68.19.58:8811/perbank/$1
ProxyPassReverse ^/perbankWeb/perbank/(._)$ http://197.68.19.58:8811/perbank/$1
```

## 前缀匹配-转发配置

```apache
ProxyPass /perbankWeb/perbankAPi http://197.68.19.58:8811/perbankAPi
ProxyPassReverse /perbankWeb/perbankAPi http://197.68.19.58:8811/perbankApi

ProxyPass /perbank http://197.68.19.58:8811/perbank
ProxyPassReverse /perbank http://197.68.19.58:8811/perbank
```

## 重启命令

```bash
/usr/local/apache2/bin/httpd -k restart
/home/mbapache/apache2/bin/httpd -k restart
/home/webapache/apache2/bin/httpd -f /home/webapache/apache2/conf/httpd.conf -k restart
```

## 查看已经加载的模块

```bash
apachectl -M
apachectl -M | grep rewrite
```