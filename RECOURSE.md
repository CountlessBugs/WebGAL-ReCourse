# WebGAL-ReCourse

ReCourse 的公开定制引擎，基于 WebGAL 4.6.6（`15173bc21339a65da34b78463fca8a304e4d503a`）。修改沿用 MPL-2.0，许可证见 `LICENSE`；上游项目为 OpenWebGAL/WebGAL。本版本尚不包含带读页面指令。

## 定制范围

- 系统默认字体及按需加载，保留已有 ReCourse 字体设置身份。
- 默认简体中文，课程自动进入不播放标题音乐/点击音效，不自动请求全屏。
- 读档异步场景就绪后通知舞台订阅者。
- 独立原生设置预览，不挂载游戏 App，不初始化 Live2D 或演出注册模块。
- 提供稳定导出 `WebGAL`、`parseCourseScene`、`recourseRuntime`，主入口固定为 `assets/recourse.js`。

主入口和 HTML 必须复核缓存，禁止按固定 URL 永久缓存；Vite 带内容哈希的依赖文件可使用长期缓存。宿主设置 `window.recoursePreviewOrigin` 和 `window.recourseTextboxStyle` 后加载主入口，即进入预览；其他情况下进入游戏。预览只接受指定父窗口、精确来源的设置消息。

## 构建与分发

使用 Node.js 22、Corepack 提供的 Yarn 1.22.22 和 Python 3：

```sh
corepack yarn install --frozen-lockfile --non-interactive
corepack yarn build
corepack yarn workspace webgal-parser test run
node --test scripts/recourse.test.cjs
python scripts/package_recourse.py
```

打包要求工作树已提交，生成 `WebGAL-ReCourse-4.6.6-recourse.1-web.zip`、对应源码归档及 SHA-256 文件。运行时包含来源提交、公开源码链接、MPL 许可证、原入口摘要和分发版本。只打包明确的引擎构建目录，不包含部署凭据或用户资料。

修改通过 PR 审核；不得直接修改 main 或自行合并。首次集成可在本地安装经过同一校验的 ZIP；公共下载地址只有在对应源码和发布附件就绪后才能使用。发布固定 tag，上传构建包和源码归档；不能只上传编译文件，不能让旧 tag 指向不同源码。
