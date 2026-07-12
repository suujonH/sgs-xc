# SGS Web 脚本工作区

`E:\ds-sgs\src` 是插件、Framework 和油猴脚本的唯一源码工作区，也是原 `sgs-xc` Git 仓库迁移后的根目录。

## 项目

| 目录 | 职责 | 发布文件 |
| --- | --- | --- |
| `downloader` | document-start 油猴下载器 | `dist/download.mjs` |
| `framework` | Core、公开手册与 Framework 契约 | `dist/core.mjs`、`dist/manual` |
| `card-tracker` | 无 UI 牌局模型、采集适配器与记牌器插件 | `dist/plugin/card-tracker.mjs` |
| `auto-rewards` | 自动领奖插件 | `dist/plugin/auto-rewards.mjs` |
| `debug-tools` | 开发调试插件与示例 | `dist/plugin/automation.mjs` |
| `blocker` | 广告、特效与弹窗屏蔽插件 | `dist/plugin/blocker.mjs` |
| `plugin-catalog` | 官方插件源 | `dist/plugin/index.json` |

每个项目可以在自己的 `src`、`scripts`、`test`、`docs` 等目录内工程化拆分。根构建器使用 esbuild 合并模块，再用 Terser 压缩和变量混淆；每个插件和油猴脚本最终只生成一个 JavaScript 文件。Game Model runtime 会在构建时嵌入 `card-tracker.mjs`，浏览器不再额外下载 `card-tracker-runtime.js`。

## 构建与发布

```powershell
cd E:\ds-sgs\src
npm install
npm run build
npm run check
npm run publish:check
npm run deploy
```

`publish:check` 只读取配置目标的当前文件列表，不改变远端。`deploy` 先重新构建，再通过 SSH 原子镜像，并从配置的公开地址下载每个 JavaScript 核对 SHA-256。

首次使用时复制 `build/deploy.config.example.json` 为 `build/deploy.config.local.json`，填写本机 SSH 与服务器信息。本地配置已由 `.gitignore` 排除；也可以通过 `SGS_DEPLOY_CONFIG` 指向工作区外的配置文件。仓库不会保存真实 SSH 别名、远端目录、远端属主或 ACL 路径。

公开文件名继续使用 `.mjs`，以保持现有安装与更新 URL；它们仍是普通的单文件 JavaScript，不要求浏览器模块加载。
