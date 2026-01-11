## https://zhuanlan.zhihu.com/p/21030210489

### 1.Ollama 下载安装

Ollama 是一个轻量级的本地AI模型运行框架，可在本地运行各种开源大语言模型（如Llama、Mistral等）

- 浏览器输入网址：https://ollama.com/

- 安装之后，Ollama已经运行了，它是CMD命令工具，我们可以在命令行输入ollama来验证，是否安装成功

```
ollama

```

- 安装DeepSeek-r1模型 还是在刚才的Ollama网站，选择Model模块，选择deepseek-r1这个模型

- 模型默认下载到c盘，更改一下模型的下载位置
- 修改环境变量
  - 系统变量
    - OLLAMA_MODELS E:\ai\OLLAMA
  - 用户变量
    - OLLAMA_HOST：0.0.0.0
    - OLLAMA_ORIGINS: \*
  - 都设置好后，就保存，然后重启ollama

### 2.chatBox下载安装
