## 修改微信存储位置 - 失败修改不成功
### 用符号链接（Symbolic Link）“重定向”路径（高级用户慎用）
⚠️ 风险提示：如果外接 SSD 未挂载时启动微信，会导致数据丢失或微信异常！

- 操作步骤：
- 先完整备份当前微信数据（按上一节方法）

**查看原文件夹：**

```
du -sh ~/Library/Containers/com.tencent.xinWeChat 

```
**将数据移动到外接 SSD**：

```
mv ~/Library/Containers/com.tencent.xinWeChat /Volumes/ssd/
```
**删除原目录**：

```
rm -rf ~/Library/Containers/com.tencent.xinWeChat
```

**创建符号链接**：

```
ln -s /Volumes/ssd/com.tencent.xinWeChat ~/Library/Containers/com.tencent.xinWeChat
```


用 Finder 手动删除（最简单有效）
打开 访达（Finder）
按下 Cmd + Shift + G，输入：
Text
编辑
~/Library/Containers/
找到 com.tencent.xinWeChat 文件夹
右键 → 移到废纸篓
输入密码（如果提示）

