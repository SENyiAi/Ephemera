# Ephemera Manager

VS Code 扩展，用于管理 Ephemera EVO 云实例。

## 功能

- 创建和删除实例
- 查看实例状态和详情
- 电源控制：启动、关机、重启
- 重装系统和续费
- 远程执行命令
- SSH 终端连接
- 复制 IP 和密码
- 自动刷新实例列表

## 安装

从源码安装：

```bash
cd ephemera-vscode
npm install
npm run compile
```

按 F5 启动调试。

## 使用

### 设置凭据

Ctrl+Shift+P 输入 "Ephemera: 设置 API 凭据"，输入 Client ID 和 Secret。

从 https://app.alice.ws 获取凭据。

### 创建实例

点击侧边栏加号按钮，选择套餐和操作系统，输入使用时长。

### 管理实例

右键实例进行操作：查看详情、SSH连接、电源控制、续费、重装、执行命令、删除等。

## 配置

在设置中搜索 "ephemera" 进行配置。

主要设置：
- `ephemera.apiBaseUrl`: API 地址
- `ephemera.autoRefreshInterval`: 自动刷新间隔秒数
- `ephemera.showStatusBar`: 显示状态栏
- `ephemera.defaultOS`: 默认操作系统 ID
- `ephemera.defaultPlan`: 默认套餐 ID
- `ephemera.defaultTime`: 默认使用时长

## 套餐

- Micro: 2C/4G/60G
- Standard: 4C/8G/120G  
- Pro: 8C/16G/200G
- Ultra: 16C/32G/300G
- GPU-Ultra: 8C/32G/1T + RTX A4000

## 操作系统

Debian, Ubuntu, CentOS, AlmaLinux, Alpine

## 开发

```bash
npm install
npm run compile
```

按 F5 调试。打包：`npm run package`

## 链接

- [GitHub](https://github.com/SENyiAi/Ephemera)
- [API 文档](https://api.aliceinit.io)
