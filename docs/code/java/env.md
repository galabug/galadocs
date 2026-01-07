# openJDK 下载 - 访问 Adoptium（由 Eclipse 基金会管理）的网站

目前推荐获取高质量 OpenJDK 发行版的地方：
https://adoptium.net/

# 环境变量配置

JAVA_HOME
D:\develop\java\jdk\jdk-21.0.4.7
D:\develop\java\jdk\jdk-17.0.3.1
D:\develop\java\jdk\jdk-11.0.13

path
%JAVA_HOME%\bin

11+
CLASSPATH
.;%JAVA_HOME%\bin

8-
CLASSPATH
.;%JAVA_HOME%\lib\dt.jar;%JAVA_HOME%\lib\tools.jar

%JAVA_HOME%\lib\dt.jar 是 Java 开发工具包中的 Swing 和 AWT 工具类。
%JAVA_HOME%\lib\tools.jar 包含了编译器和其他工具类。
