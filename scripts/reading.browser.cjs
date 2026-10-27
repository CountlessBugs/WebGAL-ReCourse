// SPDX-License-Identifier: MPL-2.0
/** Run against the engine Vite dev server; Playwright is a validation tool, not a runtime dependency. */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RECOURSE_PLAYWRIGHT_MODULE || 'playwright');
function pdfDocument(count) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let page = 1; page <= count; page++) {
    const id = objects.length;
    kids.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = `BT /F1 24 Tf 72 700 Td (ORIGINAL PAGE ${page}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Count ${count} /Kids [${kids.join(' ')}] >>`;
  let data = '%PDF-1.4\n'; const offsets = [0];
  for (let id = 1; id < objects.length; id++) { offsets.push(data.length); data += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = data.length;
  data += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(data + `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
(async () => {
  const browser = await chromium.launch({ channel: process.env.RECOURSE_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/reading/files/a', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfDocument(20) }));
    await page.route('**/reading/files/b', (route) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8',
      body: Array.from({ length: 150 }, (_, index) => `原文第 ${index + 1} 行 <script>不执行</script>`).join('\n') }));
    await page.goto(process.env.RECOURSE_ENGINE_URL || 'http://127.0.0.1:3099/');
    await page.locator('.html-body__title-enter').click();
    await page.evaluate(async () => {
      const [main, stage, play, store, gui, backlog, save, load] = await Promise.all([
        import('/src/main.tsx'), import('/src/Core/Modules/stage/stageStateManager.ts'),
        import('/src/Core/controller/gamePlay/nextSentence.ts'), import('/src/store/store.ts'), import('/src/store/GUIReducer.ts'),
        import('/src/Core/controller/storage/jumpFromBacklog.ts'), import('/src/Core/controller/storage/saveGame.ts'),
        import('/src/Core/controller/storage/loadGame.ts'),
      ]);
      window.readingTest = { main, stage, play, store, gui, backlog, save, load };
    });
    await page.waitForFunction(() => window.readingTest.main.WebGAL.gameplay.pixiStage !== null);
    const rawScene = await page.evaluate(() => {
      const { main, stage, store, gui } = window.readingTest;
      const order = [{ file_id: 'a', page_range: [2, 3] }, { file_id: 'b', page_range: [1, 1] }];
      const raw = [`readingOrder:${JSON.stringify(order)};`, 'changeFigure:stand.webp -left -next;', 'readingNext:;', '老师:第一张原页的陪伴台词;',
        'readingJump:a -page=10;', 'readingNext:;', 'readingReturn:;', 'readingNext:;', 'readingNext:;', '老师:文本原文已展示;'].join('\n');
      const plan = { version: 1, run_id: 42, reading_plan_id: 'plan', script_revision: 'script', speaker: '老师', figure_names: ['stand.webp'],
        main_pages: [{ file_id: 'a', original_page: 2 }, { file_id: 'a', original_page: 3 }, { file_id: 'b', original_page: 1 }],
        reference_files: [{ file_id: 'a', original_name: '原始 PDF', format: 'pdf', page_count: 20 },
          { file_id: 'b', original_name: '原始 TXT', format: 'txt', page_count: 1 }] };
      const actions = [null, null, 'main_next', null, 'jump', 'excursion_next', 'return', 'main_next', 'main_next', null];
      main.WebGAL.sceneManager.sceneData.currentScene = main.parseCourseScene(raw, '/start.txt');
      main.WebGAL.sceneManager.sceneData.currentSentenceId = 0;
      main.WebGAL.sceneManager.sceneData.sceneStack = [];
      main.WebGAL.backlogManager.makeBacklogEmpty();
      stage.stageStateManager.replaceAllStageState(stage.initState);
      main.configureGuidedReading({ plan, fileBaseUrl: '/reading/files/', analysis: { version: 1, reading_plan_id: 'plan', script_revision: 'script',
        nodes: actions.map((action, line) => ({ id: `start.txt:${line}`, scene: 'start.txt', line, action, call_path: [], scope_path: [] })), branches: [] } });
      for (const component of ['showTitle', 'showStarter', 'isShowLogo', 'showBacklog', 'showMenuPanel'])
        store.webgalStore.dispatch(gui.setVisibility({ component, visibility: false }));
      store.webgalStore.dispatch(gui.setVisibility({ component: 'showTextBox', visibility: true }));
      return raw;
    });
    await page.route('**/start.txt', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: rawScene }));
    const advance = () => page.evaluate(() => { window.readingTest.play.forward(); window.readingTest.play.commitForward(); });
    const current = () => page.evaluate(() => ({ ...window.readingTest.stage.stageStateManager.getViewStageState().reading,
      text: window.readingTest.stage.stageStateManager.getViewStageState().showText }));
    await advance();
    await page.locator('[data-recourse-reading-ready="true"]').waitFor();
    assert.equal(await page.locator('[data-recourse-reading-panel] canvas').count(), 1);
    assert.match(await page.locator('[data-recourse-reading-panel]').textContent(), /ORIGINAL PAGE 2/);
    assert.deepEqual(await page.evaluate(() => {
      const stage = window.readingTest.stage.stageStateManager.getViewStageState();
      return { right: stage.figNameRight.split('/').pop(), left: stage.figNameLeft, center: stage.figName, free: stage.freeFigure.length };
    }), { right: 'stand.webp', left: '', center: '', free: 0 });
    const saved = await page.evaluate(() => {
      const { main, save } = window.readingTest;
      const history = main.WebGAL.backlogManager.getBacklog();
      if (history.length !== 2 || history[0].currentStageState.showText !== '' || history[1].currentStageState.showText === '')
        throw new Error('页面与台词快照未分离');
      return save.generateCurrentStageData(0, false);
    });
    const cursor = (await current()).event_cursor.event_id;
    await page.getByRole('button', { name: '放大资料', exact: true }).click();
    await page.locator('[data-recourse-reading-ready="true"]').waitFor();
    await page.locator('[data-recourse-reading-panel]').focus();
    await page.keyboard.press('Space');
    await page.locator('[data-recourse-reading-panel]').hover(); await page.mouse.wheel(0, 500);
    assert.equal((await current()).event_cursor.event_id, cursor);
    await page.evaluate(() => window.readingTest.backlog.jumpFromBacklog(0));
    await page.waitForFunction(() => !window.readingTest.main.WebGAL.sceneManager.lockSceneWrite);
    assert.equal((await current()).text, '');
    await advance(); assert.match((await current()).text, /第一张/);
    await advance(); assert.equal((await current()).display_page.original_page, 10);
    await advance(); assert.equal((await current()).display_page.original_page, 11); assert.equal((await current()).main_index, 1);
    await advance(); assert.equal((await current()).display_page.original_page, 2);
    await advance(); assert.equal((await current()).main_index, 2); assert.equal((await current()).text, '');
    await advance(); await page.locator('[data-recourse-reading-ready="true"]').waitFor();
    assert.equal((await current()).main_index, 3);
    assert.equal(await page.locator('[data-recourse-reading-panel] pre').count(), 1);
    assert.match(await page.locator('[data-recourse-reading-panel] pre').textContent(), /原文第 150 行 <script>/);
    assert.equal(await page.locator('[data-recourse-reading-panel] script').count(), 0);
    assert.equal(await page.locator('[data-recourse-reading-panel] pre').evaluate((element) => element.parentElement.scrollHeight > element.parentElement.clientHeight), true);
    if (process.env.RECOURSE_SCREENSHOT) await page.screenshot({ path: process.env.RECOURSE_SCREENSHOT.replace(/\.png$/, '-txt.png') });
    await page.evaluate((snapshot) => window.readingTest.load.loadGameFromStageData(snapshot), saved);
    await page.waitForFunction(() => !window.readingTest.main.WebGAL.sceneManager.lockSceneWrite);
    await page.locator('[data-recourse-reading-ready="true"]').waitFor();
    assert.equal((await current()).main_index, 1); assert.equal((await current()).display_page.original_page, 2);
    if (process.env.RECOURSE_SCREENSHOT) await page.screenshot({ path: process.env.RECOURSE_SCREENSHOT.replace(/\.png$/, '-page.png') });
    await page.evaluate(() => window.readingTest.store.webgalStore.dispatch(window.readingTest.gui.setVisibility({ component: 'showBacklog', visibility: true })));
    await page.locator('[id^="backlog_item_"]').getByText('原始 PDF · 原件第 2 页', { exact: true }).waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#backlog_item_1')).opacity === '1');
    if (process.env.RECOURSE_SCREENSHOT) await page.screenshot({ path: process.env.RECOURSE_SCREENSHOT });
    await page.locator('#backlog_item_1 [class*="backlog_item_button_element"]').first().click();
    await page.waitForFunction(() => !window.readingTest.main.WebGAL.sceneManager.lockSceneWrite);
    assert.equal((await current()).text, '');
    await page.evaluate(() => {
      const { main, stage } = window.readingTest;
      const raw = ['readingOrder:[{"file_id":"a","page_range":[2,3]}];', 'readingNext:;', '老师:主线当前页;',
        'choose:查看旁支:A|另一旁支:B;', 'label:A;', 'readingNext:;', 'readingJump:a -page=10;', '老师:旁支原页;',
        'jumpLabel:merge;', 'label:B;', 'readingJump:a -page=12;', '老师:另一旁支;', 'label:merge;', '老师:合流主线;', 'readingNext:;'].join('\n');
      const actions = [null, 'main_next', null, null, null, 'local_next', 'jump', null, null, null, 'jump', null, null, null, 'main_next'];
      const plan = { version: 1, run_id: 42, reading_plan_id: 'plan', script_revision: 'branch-script', speaker: '老师', figure_names: [],
        main_pages: [{ file_id: 'a', original_page: 2 }, { file_id: 'a', original_page: 3 }],
        reference_files: [{ file_id: 'a', original_name: '原始 PDF', format: 'pdf', page_count: 20 }] };
      main.WebGAL.sceneManager.sceneData.currentScene = main.parseCourseScene(raw, '/branch.txt');
      main.WebGAL.sceneManager.sceneData.currentSentenceId = 0;
      stage.stageStateManager.replaceAllStageState(stage.initState);
      main.WebGAL.backlogManager.makeBacklogEmpty();
      main.configureGuidedReading({ plan, fileBaseUrl: '/reading/files/', analysis: { version: 1, reading_plan_id: 'plan', script_revision: 'branch-script',
        nodes: actions.map((action, line) => ({ id: `branch.txt:${line}`, scene: 'branch.txt', line, action, call_path: [],
          scope_path: line >= 3 && line < 12 ? ['branch'] : [] })), branches: [{ id: 'branch', entry: 'branch.txt:3', merge: 'branch.txt:12', parent: null }] } });
    });
    await advance(); await advance();
    await page.getByText('查看旁支', { exact: true }).click();
    assert.equal((await current()).display_page.original_page, 3); assert.equal((await current()).main_index, 1);
    await advance(); assert.equal((await current()).display_page.original_page, 10);
    await advance(); assert.equal((await current()).display_page.original_page, 2); assert.equal((await current()).scope_stack.length, 0);
    assert.match((await current()).text, /合流主线/);
    await advance(); assert.equal((await current()).main_index, 2);
    await page.evaluate(() => {
      const { main, stage } = window.readingTest;
      const raw = 'readingOrder:[{"file_id":"a","page_range":[2,2]}];\nreadingJump:a -page=10;\nreadingReturn:;\nreadingNext:;';
      main.WebGAL.sceneManager.sceneData.currentScene = main.parseCourseScene(raw, '/empty.txt');
      main.WebGAL.sceneManager.sceneData.currentSentenceId = 0;
      stage.stageStateManager.replaceAllStageState(stage.initState);
      main.configureGuidedReading({ fileBaseUrl: '/reading/files/', plan: { version: 1, run_id: 42, reading_plan_id: 'empty', script_revision: 'empty',
        speaker: '老师', figure_names: [], main_pages: [{ file_id: 'a', original_page: 2 }],
        reference_files: [{ file_id: 'a', original_name: '原始 PDF', format: 'pdf', page_count: 20 }] },
      analysis: { version: 1, reading_plan_id: 'empty', script_revision: 'empty', branches: [],
        nodes: [null, 'jump', 'return', 'main_next'].map((action, line) => ({ id: `empty.txt:${line}`, scene: 'empty.txt', line, action,
          call_path: [], scope_path: [] })) } });
    });
    await advance(); await page.locator('[data-recourse-reading-ready="true"]').waitFor();
    await advance();
    assert.equal((await current()).display_page, null);
    assert.equal(await page.locator('[data-recourse-reading-panel] canvas, [data-recourse-reading-panel] pre').count(), 0);
    assert.equal(await page.locator('[data-recourse-reading-panel]').getAttribute('data-recourse-reading-ready'), 'false');
    await advance(); await page.locator('[data-recourse-reading-ready="true"]').waitFor();
    assert.equal((await current()).display_page.original_page, 2);
    for (const mode of ['auto', 'fast']) {
      await page.evaluate(async (mode) => {
        const { main, stage, store, gui } = window.readingTest;
        const auto = await import('/src/Core/controller/gamePlay/autoPlay.ts');
        const fast = await import('/src/Core/controller/gamePlay/fastSkip.ts');
        auto.stopAuto(); fast.stopFast(); main.WebGAL.gameplay.performController.removeAllPerform();
        const raw = ['readingOrder:[{"file_id":"a","page_range":[2,4]}];', 'readingNext:;', 'readingNext:;',
          'readingNext:;', '老师:定时推进完成;', 'choose:停留:hold;', 'label:hold;', '老师:测试结束;'].join('\n');
        main.WebGAL.sceneManager.sceneData.currentScene = main.parseCourseScene(raw, '/timed.txt');
        main.WebGAL.sceneManager.sceneData.currentSentenceId = 0;
        main.WebGAL.sceneManager.sceneData.sceneStack = [];
        stage.stageStateManager.replaceAllStageState(stage.initState);
        main.WebGAL.backlogManager.makeBacklogEmpty();
        for (const component of ['showBacklog', 'showChoose', 'showMenuPanel'])
          store.webgalStore.dispatch(gui.setVisibility({ component, visibility: false }));
        main.configureGuidedReading({ fileBaseUrl: '/reading/files/', plan: { version: 1, run_id: 42,
          reading_plan_id: mode, script_revision: mode, speaker: '老师', figure_names: [],
          main_pages: [2, 3, 4].map((original_page) => ({ file_id: 'a', original_page })),
          reference_files: [{ file_id: 'a', original_name: '原始 PDF', format: 'pdf', page_count: 20 }] },
        analysis: { version: 1, reading_plan_id: mode, script_revision: mode, branches: [],
          nodes: Array.from({ length: 8 }, (_, line) => ({ id: `timed.txt:${line}`, scene: 'timed.txt', line,
            action: line >= 1 && line <= 3 ? 'main_next' : null, call_path: [], scope_path: [] })) } });
        window.readingTest.timed = { auto, fast };
        if (mode === 'auto') auto.switchAuto(); else fast.startFast(true);
      }, mode);
      await page.waitForFunction(() => window.readingTest.stage.stageStateManager.getViewStageState().reading?.main_index === 3);
      await page.evaluate(() => {
        window.readingTest.timed.auto.stopAuto(); window.readingTest.timed.fast.stopFast();
      });
      const history = await page.evaluate(() => window.readingTest.main.WebGAL.backlogManager.getBacklog().map((entry) => ({
        kind: entry.currentStageState.reading.event_cursor.kind, page: entry.currentStageState.reading.display_page.original_page,
        text: entry.currentStageState.showText,
      })));
      assert.deepEqual(history.filter((entry) => entry.kind === 'next').map((entry) => entry.page), [2, 3, 4], mode);
      assert.ok(history.filter((entry) => entry.kind === 'next').every((entry) => entry.text === ''), mode);
      assert.equal((await current()).display_page.original_page, 4, mode);
    }
    assert.deepEqual(errors, []);
    process.stdout.write('PASS: PDF 原始物理页、TXT 单页滚动、事件隔离、独立回想与空栏回溯、章外跳转返回、保存恢复、原生分支合流、真实自动与快进定时推进。\n');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
