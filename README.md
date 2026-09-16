# 雅思词汇

一个面向雅思备考的 AI 词汇学习工具。输入一个单词，即可查看听说读写场景分析、释义、搭配、例句和近义词辨析，并把值得复习的词汇整理成 Anki 卡片。

## 功能

- 听力、口语、阅读、写作四项使用分析
- 中英文释义、词性和高频搭配
- 雅思口语与写作 7/8/9 分例句
- 基础词识别与更高级表达建议
- 查询历史、生词本和重点词汇
- 一键导出 Anki `.apkg` 文件
- 内置模型设置与连接测试
- macOS 独立桌面窗口，浏览器兼容模式

## 快速开始

### 环境要求

- macOS
- Node.js 22 或更高版本
- 一个兼容 OpenAI Chat Completions 格式的模型接口

### 安装

```bash
git clone https://github.com/cct2277256745-source/ielts-vocab.git
cd ielts-vocab
npm install --registry=https://registry.npmjs.org
```

如果 Electron 下载较慢，可以使用国内镜像：

```bash
npm run install:cn
```

### 启动桌面应用

```bash
npm start
```

应用会打开独立的 macOS 窗口，不需要手动启动本地网页服务，也不会自动打开浏览器。

## 配置模型

首次启动时，应用会在 Electron 用户数据目录中创建配置文件。打开“模型设置”，填写以下内容：

| 配置项 | 说明 |
| --- | --- |
| API Key | 模型服务商提供的访问密钥 |
| 模型名称 | 要调用的模型名称 |
| 接口地址 | OpenAI Chat Completions 兼容接口的根地址 |

填写后点击“测试模型连接”，连接成功再保存设置。默认接口地址为 `https://api.deepseek.com`，默认模型为 `deepseek-v4-flash`；使用其他兼容服务时，可替换为对应的模型名称和接口地址。

桌面版配置位置为 Electron 的用户数据目录 `.env`。API Key 只保存在当前设备，不会写入前端源码、打包资源或仓库文件。

## 使用流程

1. 启动应用并完成模型设置。
2. 在学习台输入英文单词并查询。
3. 将需要复习的单词加入生词本或标记为重点词汇。
4. 在生词本中导出 Anki `.apkg` 文件。

## 浏览器兼容模式

项目保留本地浏览器入口，适合调试或不使用 Electron 的场景：

```bash
npm run start:web
```

然后访问 <http://localhost:5179>。浏览器模式使用项目目录中的 `.env` 配置，功能与桌面模式保持一致。

## 开发与打包

直接启动 Electron 开发模式：

```bash
npm run start:dev
```

生成 macOS 应用和磁盘映像：

```bash
npm run dist
```

构建产物会写入 `dist/`。打包后的应用不需要额外安装 Node.js，首次使用仍需在“模型设置”中填写可用的模型接口配置。

## 项目结构

```text
main.js                    Electron 主进程与桌面 IPC
preload.js                 安全桥接接口
index.html                 页面与交互逻辑
core.js                    查询、配置、Anki 导出共享业务层
server.js                  浏览器兼容服务
scripts/start-desktop.js   自动构建并启动桌面应用
icon.icns                  macOS 应用图标
```

## 数据与隐私

- 查询内容会发送到用户在模型设置中填写的 AI 服务。
- 查询历史、生词本和重点词汇保存在当前浏览器本地存储中。
- Anki 文件在本地生成，不会自动上传。
- `.env` 仅用于本机配置，公开使用时请勿将真实 API Key 写入源码或提交到仓库。

## 常见问题

**查询提示未配置 API Key**

打开“模型设置”，填写 API Key、模型名称和接口地址，先测试连接，再保存设置。

**直接双击 `index.html` 无法查询**

请使用 `npm start` 启动桌面应用，或运行 `npm run start:web` 后访问本地地址。直接打开 HTML 文件不会连接后端。

**模型连接失败**

检查网络、API Key、模型名称和接口地址；接口地址应填写服务商的根地址，应用会自动请求 `/chat/completions`。
