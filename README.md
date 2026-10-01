# dsh-glass-skin

DSH（DeepSeek Harness）Web UI 的**页面级玻璃皮肤**：会话画布与侧栏变成半透明玻璃，底下垫一层重模糊的冷灰蓝背景。
装上之后右下角会多一个圆钮，那就是它的控制台。

| 开启皮肤 | 关闭皮肤（原版对照） |
| :---: | :---: |
| ![浅色](glass-light.png) | ![浅色原版](stock-light.png) |
| ![深色](glass-dark.png) | ![深色原版](stock-dark.png) |

## 安装

```sh
dsh plugin --profile <profile> add github:Lenandy/dsh-glass-skin   # 从 GitHub（不必先发布）
dsh plugin --profile <profile> add dsh-glass-skin                  # 从 npm（发布后）
dsh plugin --profile <profile> add -w /path/to/dsh-glass-skin      # 本机仓库（开发）
```

- **`<profile>` 必须填对，填错会完全没有反应**——bundle 层根本不会被组合，重启多少次都没用。桌面版用的是 `desktop`。
- 装完**重启 DSH**：新 bundle 要重新组合 loader 树，刷新页面不够。
- 回滚：`dsh plugin --profile <profile> remove dsh-glass-skin`

> 在 DSH 桌面版 `0.2.0-rc.2`（Electron 44 / Chrome 152）上实测。

<details>
<summary>怎么查 profile 名 / 装完怎么确认</summary>

```powershell
Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
  ForEach-Object { [regex]::Match([string]$_.CommandLine, 'profiles\\(\S+)').Groups[1].Value }
```

- 用本机路径安装时 **`-w` 是必需的**：profile 目录自带 `pnpm-workspace.yaml`，pnpm 会把它当成 workspace 根，裸 `add` 会报 `ERR_PNPM_ADDING_TO_ROOT`。
- **确认装上了**：重启后右下角出现圆钮，控制台标题里能读到版本号。
- ⚠️ 别拿 `http://127.0.0.1:<port>/plugins/dsh-glass-skin/client.js` 当证据——桌面版不走这条 HTTP 路由，
  **所有**包（含官方包）都是 404，它证明不了任何事。
- 页面上的**插件管理 → 添加插件**接受同一套 spec（包名、Git 地址、tarball、绝对本地路径），和 `dsh plugin` 共用同一套包操作。

</details>

## 特性

- **真玻璃，不是贴图**——给四个「外观面」令牌加 alpha 通道，再铺一层重模糊背景；卡片、气泡、输入框保持实心，所以文字始终清晰。
- **控制台**——右下角圆钮，纯鼠标操作，不需要 DevTools。
- **明暗各自独立**——浓度和遮罩按配色分开保存：同一组数值在浅色下是死白，在深色下却是层次。
- **三个预设**——通透 / 标准 / 厚重，一键设好，不用自己试。
- **壁纸三种来源**——图片直链 · **搜索引擎结果页链接（自动取出真实图片地址）** · 本机选图。
- **自我诊断**——实时实测「叠加后不透明度」，超过 85% 就报警并告诉你往哪调。
- **随时可退**——关掉就恢复原版；皮肤**永远不改你的浅色/深色偏好**。

## 控制台

| 控件 | 作用 |
|---|---|
| **浓度** | 玻璃强弱。`100%` = 出厂（暗色叠加后约 59%、浅色约 55%），`0%` = 表面全透明 |
| **模糊** | 背景模糊半径（明暗共用）。拉到 `0` 就是清晰壁纸 |
| **遮罩** | 在背景上压一层，用来把文字对比度拉回来。**随配色变**：暗色压黑、浅色提白 |
| **通透 / 标准 / 厚重** | 一次设好浓度 + 遮罩 |
| **壁纸** | 见下一节。右侧三个图标按钮：**选图** · **用** · **清除** |
| **关闭皮肤 / 详情 / 重置** | 「详情」是完整诊断报告；「重置」恢复全部默认，与壁纸那个「清除」不是一回事 |

## 壁纸

| 你手上是什么 | 怎么做 |
|---|---|
| 图片直链、`data:` URL | 粘进输入框 → 点 **✓** |
| **搜索引擎图片结果页的链接** | 直接粘进去点 **✓**。那种链接是 HTML 页面、不是图片，插件会**自己从 `mediaurl` 参数里解出真正的图片地址**再加载（Bing / Google 图片结果都是这个参数名），成功后存的是解出来的地址 |
| 本机图片 | 点 **🖼 选图**，走文件选择器 |

图片**先探测再应用**：加载不出来就保留内置背景，**不会黑屏**，并在行下方写明原因。本地图片限 2MB（本地存储放不下更大的）。

![自定义壁纸](glass-wallpaper.png)

## 已知边界

- **不是真·亚克力。** 拖动窗口时玻璃后面的内容不会跟着动——背景是页面自己铺的一层图。真正的窗口材质需要 Electron 的
  `backgroundMaterial`，而 DSH 桌面版的窗口归主进程所有，插件层够不到。
- 玻璃面板后面若有高对比内容，文字对比度会下降；调大「遮罩」即可。

## 隐私

插件只改样式，**不采集、不上报任何数据**——所有偏好都存在你自己浏览器的 `localStorage` 里，卸载或点「重置」即清空。
唯一的外发请求是**你填的壁纸地址**：由浏览器按你自己的网络直接取那张图，没有中转、没有统计。

## 许可

[MIT](LICENSE)。
