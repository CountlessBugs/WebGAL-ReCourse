# WebGAL-ReCourse

ReCourse 的公开定制引擎，基于 WebGAL 4.6.6（`15173bc21339a65da34b78463fca8a304e4d503a`）。修改沿用 MPL-2.0，许可证见 `LICENSE`；上游项目为 OpenWebGAL/WebGAL。当前分发版本为 `4.6.6-recourse.3`。

## 定制范围

- 系统默认字体及按需加载，保留已有 ReCourse 字体设置身份。
- 默认简体中文，课程自动进入不播放标题音乐/点击音效，不自动请求全屏。
- 读档异步场景就绪后通知舞台订阅者。
- 独立原生设置预览，不挂载游戏 App，不初始化 Live2D 或演出注册模块。
- 提供稳定导出 `WebGAL`、`parseCourseScene`、`recourseRuntime`，主入口固定为 `assets/recourse.js`。
- 带读模式由宿主在进入剧本前调用 `configureGuidedReading({plan, analysis, fileBaseUrl})`，只接收已授权且身份一致的固定阅读计划和共享编译器分析表；未配置时保留原执行语义。
- 原生支持 `readingOrder`、`readingNext`、`readingJump`、`readingReturn`。一次推进最多一个页面事件及紧邻的一条有效台词；页面空栏快照与台词快照分开回想，回溯不重放翻页。
- 阅读状态随原生存档及回想恢复；核验 Run、计划、脚本身份，异步场景恢复期间阻止推进。作用域合流恢复外层页面，连续跳转只有一个返回基点。
- PDF.js `6.4.299` 在面板中显示指定物理原页及文字选择层，本地打包 worker、CMap、标准字体与解码资源，不使用外部 CDN；TXT 原文全文作为默认单页滚动，资料操作不推进剧情。其依赖树由锁文件固定。
- 带读角色固定右侧单槽、位置参数忽略；允许不同角色依次登场，立绘沿用通用项目素材授权。共享编译器继续拒绝无法静态证明的旁路指令。`getReadingContext()` 提供当前原页问答定位，初始主进度为零。

主入口和 HTML 必须复核缓存，禁止按固定 URL 永久缓存；Vite 带内容哈希的依赖文件可使用长期缓存。宿主设置 `window.recoursePreviewOrigin` 和 `window.recourseTextboxStyle` 后加载主入口，即进入预览；其他情况下进入游戏。预览只接受指定父窗口、精确来源的设置消息。

## 构建与分发

使用 Node.js 22.13+ 或 24+、Corepack 提供的 Yarn 1.22.22 和 Python 3：

```sh
corepack yarn install --frozen-lockfile --non-interactive
corepack yarn build
corepack yarn workspace webgal-parser test run
node --test scripts/reading.test.cjs scripts/recourse.test.cjs
python scripts/package_recourse.py
```

打包要求工作树已提交，生成 `WebGAL-ReCourse-4.6.6-recourse.3-web.zip`、对应源码归档及 SHA-256 文件。运行时包含来源提交、公开源码链接、MPL 许可证、入口与所有 JavaScript 模块（含 PDF worker `.mjs`）、PDF 渲染数据资源及其许可证的摘要和分发版本。只打包明确的引擎构建目录，不包含部署凭据或用户资料。

真实浏览器验证：先启动 `corepack yarn workspace webgal-engine dev --host 127.0.0.1 --port 3099`，再运行 `node scripts/reading.browser.cjs`。验证环境需提供 Playwright 与 Edge；可用 `RECOURSE_PLAYWRIGHT_MODULE` 指定已安装的 Playwright 模块、`RECOURSE_BROWSER_CHANNEL` 指定浏览器，`RECOURSE_ENGINE_URL` 指定开发服务。默认无需向产品添加测试浏览器依赖。测试用合成 PDF/TXT 和可信分析 fixture，不调用模型；`RECOURSE_SCREENSHOT` 可指定临时截图位置，媒体不入库。

修改通过 PR 审核；不得直接修改 main 或自行合并。首次集成可在本地安装经过同一校验的 ZIP；公共下载地址只有在对应源码和发布附件就绪后才能使用。发布固定 tag，上传构建包和源码归档；不能只上传编译文件，不能让旧 tag 指向不同源码。

带读角色规则：不提供专属立绘名单，脚本可切换角色与项目已授权立绘；changeFigure 将所有位置和 ID 映射到右侧单槽，任一时刻最多一名在场。ReadingPlan 不再包含 figure_names，speaker 只用于业务端绑定问答人设。配套 Public API 1.23.0、Backend-Agent 1.15.0、共享包 1.25.0，须同步部署。
