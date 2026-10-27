// SPDX-License-Identifier: MPL-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const copy = (value) => JSON.parse(JSON.stringify(value));
function load(name, imports = {}, globals = {}) {
  const source = readFileSync(resolve(__dirname, '../packages/webgal/src', name), 'utf8');
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { exports, URL, Error, location: { href: 'https://course.test/game/', origin: 'https://course.test' },
    require: (key) => { if (!(key in imports)) throw new Error(`Unexpected import ${key}`); return imports[key]; }, ...globals });
  return exports;
}
const model = load('recourse/reading/model.ts');
const { commandType } = load('Core/controller/scene/sceneInterface.ts');
const plan = { version: 1, run_id: 42, reading_plan_id: 'plan', script_revision: 'revision', speaker: '老师',
  main_pages: [{ file_id: 'a', original_page: 2 }, { file_id: 'a', original_page: 3 }, { file_id: 'b', original_page: 1 }],
  reference_files: [{ file_id: 'a', original_name: 'PDF', format: 'pdf', page_count: 20 },
    { file_id: 'b', original_name: 'TXT', format: 'txt', page_count: 1 }] };
const node = (action, scope_path = [], line = 0) => ({ action, scope_path, line, scene: 'start.txt', id: `start.txt:${line}`, call_path: [] });
const next = (state, action = 'main_next', scopes = []) => model.applyReadingEvent(state, plan, node(action, scopes));
test('主进度从零开始，按多资料原页序推进，TXT 全文只占默认一页', () => {
  let state = model.createReadingState(plan);
  assert.equal(state.main_index, 0); assert.equal(state.display_page, null);
  for (const page of plan.main_pages) { state = next(state); assert.deepEqual(copy(state.display_page), page); }
  assert.equal(state.main_index, 3);
  assert.throws(() => next(state), /out_of_range/);
  assert.throws(() => model.assertPage(plan, { file_id: 'b', original_page: 2 }), /out_of_range/);
});
test('章外跳转、连续跳转与跳转下一页不计主进度，返回保存的主页面', () => {
  let state = next(model.createReadingState(plan));
  state = model.applyReadingEvent(state, plan, node('jump'), { file_id: 'a', original_page: 10 });
  state = next(state, 'excursion_next');
  state = model.applyReadingEvent(state, plan, node('jump'), { file_id: 'a', original_page: 18 });
  assert.equal(state.main_index, 1);
  state = model.applyReadingEvent(state, plan, node('return'));
  assert.deepEqual(copy(state.display_page), plan.main_pages[0]);
  assert.equal(state.excursion, null);
  state = next(state); assert.equal(state.display_page.original_page, 3);
});
test('无未闭合返回时下一页恢复主进度；嵌套分支合流恢复外层页面与跳转基点', () => {
  let state = next(model.createReadingState(plan));
  state = model.applyReadingEvent(state, plan, node('jump'), { file_id: 'a', original_page: 10 });
  state = next(state, 'local_next', ['outer']);
  state = model.applyReadingEvent(state, plan, node('jump', ['outer']), { file_id: 'a', original_page: 15 });
  state = next(state, 'local_next', ['outer', 'inner']);
  assert.equal(state.main_index, 1);
  state = model.enterReadingNode(state, node(null, ['outer']));
  assert.equal(state.display_page.original_page, 15);
  state = model.enterReadingNode(state, node(null));
  assert.equal(state.display_page.original_page, 10);
  state = model.applyReadingEvent(state, plan, node('return'));
  assert.equal(state.display_page.original_page, 2);
  state = model.applyReadingEvent(state, plan, node('jump'), { file_id: 'a', original_page: 19 });
  state = next(state); assert.equal(state.main_index, 2); assert.equal(state.display_page.original_page, 3);
});
test('读档拒绝身份不匹配、越界页面与损坏作用域快照', () => {
  const state = next(model.createReadingState(plan));
  for (const invalid of [{ ...state, script_revision: 'old' }, { ...state, main_index: 99 },
    { ...state, display_page: { file_id: 'bad', original_page: 1 } },
    { ...state, scope_stack: [{ id: 'bad', saved: {} }] }])
    assert.throws(() => model.assertReadingIdentity(plan, invalid), /reading\./);
  model.assertReadingIdentity(null, undefined);
});
function engine(scripts, actions, guided = true) {
  let stage = { reading: null, showText: '旧台词', showName: '旧角色', vocal: 'voice', playVocal: 'voice', PerformList: [] };
  const history = [], errors = [], reads = [];
  const sceneData = { currentSentenceId: 0, currentScene: { sceneName: 'start', sceneUrl: '/start.txt', sentenceList: scripts }, sceneStack: [], currentLocals: {} };
  const WebGAL = { sceneManager: { sceneData, settledScenes: new Set() },
    gameplay: { performController: { unmountPerform() {}, hasPendingBlockingStateCalculationPerform: () => false } },
    readHistoryManager: { checkIsRead: () => reads.push(sceneData.currentSentenceId) },
    backlogManager: { saveCurrentStateToBacklog: () => history.push({ stage: copy(stage), cursor: sceneData.currentSentenceId }) } };
  const stageStateManager = { getCalculationStageState: () => stage, setStage: (key, value) => stage[key] = value,
    setStageAndCommit: (key, value) => stage[key] = value, replaceCalculationStageState: (value) => stage = copy(value), notify() {} };
  const args = { getNumberArgByKey: (script, key) => script.args.find((arg) => arg.key === key)?.value,
    getBooleanArgByKey: (script, key) => script.args.find((arg) => arg.key === key)?.value,
    getStringArgByKey: (script, key) => script.args.find((arg) => arg.key === key)?.value };
  const runtime = load('recourse/reading/runtime.ts', { '@/Core/WebGAL': { WebGAL },
    '@/Core/Modules/stage/stageStateManager': { stageStateManager }, '@/Core/Modules/perform/performInterface': { createNonePerform: () => ({}) },
    '@/Core/util/getSentenceArg': args, './model': model },
  { window: { dispatchEvent: (event) => errors.push(event.detail.code) }, CustomEvent: function (_type, options) { this.detail = options.detail; } });
  const analysis = { version: 1, reading_plan_id: plan.reading_plan_id, script_revision: plan.script_revision,
    nodes: scripts.map((_script, index) => node(actions[index], [], index)), branches: [] };
  if (guided) runtime.configureGuidedReading({ plan, analysis, fileBaseUrl: '/reading/files/' });
  const imports = { '@/Core/controller/scene/sceneInterface': { commandType }, './runScript': { runScript: (script) => {
    if (script.commandRaw.startsWith('reading')) runtime.readingCommand(script);
    else if (script.command === commandType.say) stage.showText = script.content;
  } }, '../../util/logger': { logger: { warn() {}, debug() {}, error() {} } }, '../scene/returnFromScene': { returnFromScene() {} },
  '@/store/store': { webgalStore: { getState: () => ({ userData: { globalGameVar: {} } }) } },
  '@/Core/gameScripts/setVar': { getValueFromStateElseKey: (value) => value }, '@/Core/controller/gamePlay/strIf': { strIf: (value) => value === 'true' },
  'lodash/cloneDeep': { default: copy }, '@/Core/WebGAL': { WebGAL }, '@/Core/util/getSentenceArg': args,
  '@/Core/Modules/stage/stageStateManager': { stageStateManager }, '@/Core/gameScripts/label/jumpToLabel': { jumpToLabel: () => false },
  '@/Core/util/prefetcher/progressPrefetcher': { prefetchCurrentSceneByProgress() {} }, '@/Core/constants': { WEBGAL_NONE: 'none' },
  '@/recourse/reading/runtime': runtime };
  const executor = load('Core/controller/gamePlay/scriptExecutor.ts', imports);
  return { ...executor, runtime, WebGAL, stageStateManager, get stage() { return stage; }, history, reads, errors };
}
const sentence = (commandRaw, content = '', args = []) => ({ commandRaw, command: commandType[commandRaw], content, args });

function figureEngine(guided = true) {
  const figureStateKeyByPosition = { center: 'figName', left: 'figNameLeft', right: 'figNameRight',
    left13: 'figNameLeft13', right13: 'figNameRight13', left14: 'figNameLeft14', right14: 'figNameRight14' };
  const stage = { ...Object.fromEntries(Object.values(figureStateKeyByPosition).map((key) => [key, ''])),
    freeFigure: [], live2dMotion: [], animationSettings: [] };
  const transforms = [];
  const stageStateManager = { getCalculationStageState: () => stage, setStage: (key, value) => stage[key] = value,
    removeEffectByTargetId() {}, removeAnimationSettingsByTarget() {}, updateAnimationSettings() {},
    setLive2dMotion() {}, setLive2dExpression() {}, setLive2dBlink() {}, setLive2dFocus() {}, setFigureMetaData() {},
    setFreeFigureByKey: (value) => {
      stage.freeFigure = [...stage.freeFigure.filter((item) => item.key !== value.key), value];
    } };
  const arg = (script, key) => script.args.find((item) => item.key === key)?.value ?? null;
  const change = load('Core/gameScripts/changeFigure.ts', {
    'lodash/cloneDeep': { default: copy }, 'lodash/isEqual': { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    '@/Core/util/getSentenceArg': { getBooleanArgByKey: arg, getNumberArgByKey: arg, getStringArgByKey: arg,
      getFigurePositionFromArgs: (script) => Object.keys(figureStateKeyByPosition).find((key) => arg(script, key)) ?? '' },
    '@/Core/Modules/stage/stageInterface': { figureStateKeyByPosition, normalizeFigureBounds: (value) => value },
    '@/Core/controller/stage/pixi/animations/generateTransformAnimationObj': {
      generateTransformAnimationObj: (_key, frame) => { transforms.push(copy(frame)); return [{}]; } },
    '@/Core/controller/stage/pixi/animations/timeline': { generateTimelineObj() {} },
    '@/Core/util/logger': { logger: { error() {} } },
    '@/Core/Modules/animationFunctions': { applyAnimationEndState() {}, getAnimateDuration: () => 0 },
    '@/Core/WebGAL': { WebGAL: { gameplay: { performController: { unmountPerform() {} } }, animationManager: { addAnimation() {} } } },
    '@/Core/live2DCore': { baseBlinkParam: {}, baseFocusParam: {} },
    '../constants': { DEFAULT_FIG_IN_DURATION: 300, DEFAULT_FIG_OUT_DURATION: 300, WEBGAL_NONE: 'none' },
    '@/Core/Modules/stage/stageStateManager': { stageStateManager },
    './parseTransformFrame': { parseTransformFrame: JSON.parse }, './figureAssociatedAnimation': { setFigureAssociatedAnimation() {} },
    '@/recourse/reading/runtime': { getReadingConfiguration: () => guided ? { plan } : null },
  }).changeFigure;
  return { stage, transforms, change, figureStateKeyByPosition };
}

test('不同角色立绘依次替换右侧单槽，位置和自由 ID 不引入额外在场角色', () => {
  const { stage, transforms, change, figureStateKeyByPosition } = figureEngine();
  stage.figNameLeft = 'previous-left.webp'; stage.figName = 'previous-center.webp';
  stage.freeFigure = [{ key: 'previous', name: 'previous-free.webp' }];
  for (const [name, position, id] of [['teacher.webp', 'left', 'teacher'], ['student.webp', 'center', 'student']]) {
    change(sentence('changeFigure', name, [{ key: position, value: true }, { key: 'id', value: id },
      { key: 'transform', value: JSON.stringify({ position: { x: 123, y: 456 }, scale: { x: 1.2, y: 1.2 } }) }]));
    assert.equal(stage.figNameRight, name);
    assert.deepEqual(Object.values(figureStateKeyByPosition).map((key) => stage[key]).filter(Boolean), [name]);
    assert.equal(stage.freeFigure.length, 0);
    assert.equal(transforms.at(-1).position, undefined);
    assert.deepEqual(transforms.at(-1).scale, { x: 1.2, y: 1.2 });
  }
  for (const [content, args] of [['none', []], ['', []], ['teacher.webp', [{ key: 'clear', value: true }]]]) {
    change(sentence('changeFigure', 'student.webp'));
    change(sentence('changeFigure', content, args));
    assert.equal(Object.values(figureStateKeyByPosition).some((key) => stage[key]), false);
    assert.equal(stage.freeFigure.length, 0);
  }
});

test('普通模式保持位置槽、自由立绘及变换原有语义', () => {
  const { stage, transforms, change } = figureEngine(false);
  change(sentence('changeFigure', 'teacher.webp', [{ key: 'left', value: true }]));
  change(sentence('changeFigure', 'student.webp', [{ key: 'right', value: true }, { key: 'id', value: 'student' },
    { key: 'transform', value: '{"position":{"x":123,"y":456}}' }]));
  assert.equal(stage.figNameLeft, 'teacher.webp');
  assert.deepEqual(copy(stage.freeFigure), [{ key: 'student', name: 'student.webp', basePosition: 'right' }]);
  assert.deepEqual(transforms.at(-1).position, { x: 123, y: 456 });
});

test('一次推进至多一个页面加相邻台词；页面空栏快照和台词快照独立', () => {
  const e = engine([sentence('readingNext'), sentence('say', '原页陪伴'), sentence('readingNext')], ['main_next', null, 'main_next']);
  e.scriptExecutor();
  assert.equal(e.history.length, 2); assert.equal(e.history[0].stage.showText, '');
  assert.equal(e.history[0].stage.showName, ''); assert.equal(e.history[0].stage.vocal, '');
  assert.equal(e.history[0].stage.reading.event_cursor.kind, 'next'); assert.equal(e.history[0].cursor, 1);
  assert.equal(e.history[1].stage.showText, '原页陪伴'); assert.equal(e.history[1].stage.reading.event_cursor.kind, null);
  assert.equal(e.stage.reading.main_index, 1);
  e.stageStateManager.replaceCalculationStageState(e.history[0].stage);
  e.WebGAL.sceneManager.sceneData.currentSentenceId = e.history[0].cursor;
  assert.equal(e.stage.showText, ''); e.scriptExecutor();
  assert.equal(e.stage.showText, '原页陪伴'); assert.equal(e.stage.reading.main_index, 1);
});
test('连续页面分次推进；条件台词无效时不扫描至下一页面', () => {
  const e = engine([sentence('readingNext'), sentence('say', '跳过', [{ key: 'when', value: 'false' }]), sentence('readingNext')], ['main_next', null, 'main_next']);
  e.scriptExecutor(); assert.equal(e.stage.reading.main_index, 1); assert.equal(e.stage.showText, '');
  assert.equal(e.WebGAL.sceneManager.sceneData.currentSentenceId, 2);
  e.scriptExecutor(); assert.equal(e.stage.reading.main_index, 2);
  const consecutive = engine([sentence('readingNext'), sentence('readingNext')], ['main_next', 'main_next']);
  consecutive.scriptExecutor(); assert.equal(consecutive.stage.reading.main_index, 1);
  const skipped = engine([sentence('readingNext'), sentence('say', '', [{ key: 'when', value: 'false' }])], ['main_next', null]);
  skipped.scriptExecutor(); skipped.runtime.assertReadingRestore(skipped.stage.reading);
});
test('带读台词 next/notend 不穿透页面预算，普通模式保留原 next/notend 语义', () => {
  const scripts = [sentence('say', 'A', [{ key: 'next', value: true }, { key: 'notend', value: true }]), sentence('say', 'B')];
  const guided = engine(scripts, [null, null]); guided.scriptExecutor();
  assert.equal(guided.stage.showText, 'A'); assert.equal(guided.history.length, 1);
  const ordinary = engine(scripts, [null, null], false); ordinary.scriptExecutor();
  assert.equal(ordinary.stage.showText, 'B'); assert.equal(ordinary.history.length, 1);
});
test('顺序声明原 JSON 禁插值，拒绝跨源资源与未知位置', () => {
  const order = JSON.stringify([{ file_id: 'a', page_range: [2, 3] }, { file_id: 'b', page_range: [1, 1] }]);
  const e = engine([sentence('readingOrder', order, [{ key: 'next', value: true }]), sentence('readingNext')], [null, 'main_next']);
  e.scriptExecutor(); assert.equal(e.stage.reading.main_index, 1);
  assert.throws(() => e.runtime.configureGuidedReading({ plan, analysis: { version: 1, ...plan, nodes: [] }, fileBaseUrl: 'https://other.test/' }), /resource_invalid/);
  e.WebGAL.sceneManager.sceneData.currentSentenceId = 9;
  assert.throws(() => e.runtime.beforeReadingSentence(), /position_invalid/);
});
test('异步恢复阻止推进，旧请求不能覆盖新快照；错误身份不进入加载', async () => {
  const e = engine([sentence('readingNext')], ['main_next']); e.scriptExecutor();
  const pending = [];
  const restore = load('recourse/reading/restore.ts', {
    'lodash/cloneDeep': { default: copy }, '@/Core/WebGAL': { WebGAL: e.WebGAL },
    '@/Core/Modules/stage/stageStateManager': { stageStateManager: e.stageStateManager },
    '@/Core/controller/scene/sceneFetcher': { sceneFetcher: () => new Promise((resolve) => pending.push(resolve)) },
    '@/Core/parser/sceneParser': { sceneParser: (_raw, sceneName, sceneUrl) => ({ sceneName, sceneUrl }) },
    '@/Core/controller/gamePlay/stopAllPerform': { stopAllPerform() {} }, './runtime': e.runtime,
  });
  const saved = { sceneUrl: '/start.txt', sceneName: 'start', currentSentenceId: 1, sceneStack: [] };
  const first = copy(e.stage), second = { ...copy(e.stage), showText: 'new' }; let completed = 0;
  restore.restoreReadingSnapshot(first, saved, () => completed++);
  assert.equal(e.WebGAL.sceneManager.lockSceneWrite, true);
  restore.restoreReadingSnapshot(second, saved, () => completed++);
  const latest = e.WebGAL.sceneManager.sceneWritePromise;
  pending[1](''); await Promise.resolve(); await Promise.resolve();
  assert.equal(e.WebGAL.sceneManager.lockSceneWrite, true);
  pending[0](''); await latest;
  assert.equal(e.stage.showText, 'new'); assert.equal(completed, 1); assert.equal(e.WebGAL.sceneManager.lockSceneWrite, false);
  restore.restoreReadingSnapshot({ ...first, reading: { ...first.reading, run_id: 99 } }, saved, () => completed++);
  assert.equal(pending.length, 2); assert.equal(e.errors[0], 'reading.version_mismatch');
});
test('真实引擎注册表将四命令解析为独立类型，保留 JSON 和物理行号', () => {
  const source = readFileSync(resolve(__dirname, '../packages/webgal/src/Core/parser/sceneParser.ts'), 'utf8');
  const imports = {};
  for (const imported of ts.preProcessFile(source).importedFiles)
    imports[imported.fileName] = new Proxy({}, { get: () => () => {} });
  Object.assign(imports, {
    'webgal-parser': require('../packages/parser/build/cjs/index.cjs'),
    '../controller/scene/sceneInterface': { commandType },
    '../util/logger': { logger: { info() {} } },
    '@/Core/util/gameAssetsAccess/assetSetter': { assetSetter: (name) => name },
    './utils': load('Core/parser/utils.ts'),
  });
  const api = load('Core/parser/sceneParser.ts', imports);
  const json = '[{"file_id":"abc","page_range":[2,3]}]';
  const parsed = api.sceneParser(`readingOrder:${json};\n\nreadingNext:;\nreadingJump:abc -page=20;\nreadingReturn:;`, 'start', '/start.txt');
  assert.equal(parsed.sentenceList.length, 5);
  assert.equal(parsed.sentenceList[0].content, json);
  for (const [index, name] of [[0, 'readingOrder'], [2, 'readingNext'], [3, 'readingJump'], [4, 'readingReturn']]) {
    assert.equal(parsed.sentenceList[index].command, commandType[name]);
    assert.equal(parsed.sentenceList[index].startLine, index);
  }
  assert.equal(parsed.sentenceList[3].args.find((arg) => arg.key === 'page').value, 20);
});
test('恢复资源先失败时仍等待旧场景写入，不能提前解除恢复锁', async () => {
  const e = engine([sentence('readingNext')], ['main_next']); e.scriptExecutor();
  let finishOld;
  e.WebGAL.sceneManager.sceneWritePromise = new Promise((resolve) => finishOld = resolve);
  const restore = load('recourse/reading/restore.ts', { 'lodash/cloneDeep': { default: copy }, '@/Core/WebGAL': { WebGAL: e.WebGAL },
    '@/Core/Modules/stage/stageStateManager': { stageStateManager: e.stageStateManager },
    '@/Core/controller/scene/sceneFetcher': { sceneFetcher: () => Promise.reject(new Error('offline')) },
    '@/Core/parser/sceneParser': { sceneParser() {} }, '@/Core/controller/gamePlay/stopAllPerform': { stopAllPerform() {} }, './runtime': e.runtime });
  restore.restoreReadingSnapshot(copy(e.stage), { sceneUrl: '/start.txt', sceneName: 'start', currentSentenceId: 1, sceneStack: [] }, () => assert.fail('failed load applied'));
  const pending = e.WebGAL.sceneManager.sceneWritePromise;
  await Promise.resolve(); await Promise.resolve();
  assert.equal(e.runtime.isReadingRestorePending(), true); assert.equal(e.WebGAL.sceneManager.lockSceneWrite, true);
  finishOld(); await pending;
  assert.equal(e.runtime.isReadingRestorePending(), false); assert.equal(e.errors[0], 'offline');
});
test('原生自动与快进共用推进预算，恢复锁期间不推进', () => {
  const e = engine([sentence('readingNext'), sentence('readingNext'), sentence('readingNext')], ['main_next', 'main_next', 'main_next']);
  Object.assign(e.WebGAL.gameplay.performController, { discardUncommittedNonHoldPerforms() {}, clearNonHoldPerformsFromStageState() {},
    beginCollectingPerforms() {}, endCollectingPerforms() {}, hasBlockingNextPerform: () => false,
    hasUnsettledNonHoldPerform: () => false, commitPendingPerforms() {}, performList: [] });
  Object.assign(e.stageStateManager, { commit() {}, applyCommittedPixiEffects() {} });
  e.WebGAL.events = { userInteractNext: { emit() {} } }; e.WebGAL.flowchartManager = { unlockPendingCurrentScene() {} };
  const store = { getState: () => ({ GUI: { showTitle: false }, userData: { optionData: { skipAll: true } } }) };
  const nextApi = load('Core/controller/gamePlay/nextSentence.ts', { './scriptExecutor': e,
    '../../util/logger': { logger: { warn() {} } }, '@/store/store': { webgalStore: store },
    '@/Core/WebGAL': { WebGAL: e.WebGAL }, '@/Core/Modules/stage/stageStateManager': { stageStateManager: e.stageStateManager },
    '@/recourse/reading/runtime': e.runtime });
  const shared = { '@/Core/controller/gamePlay/nextSentence': nextApi, '@/Core/WebGAL': { WebGAL: e.WebGAL },
    '@/store/store': { webgalStore: store }, '@/UI/BottomControlPanel/bottomControlPanel.module.scss': { default: {} } };
  const auto = load('Core/controller/gamePlay/autoPlay.ts', shared);
  let tick;
  const fast = load('Core/controller/gamePlay/fastSkip.ts', { ...shared, './autoPlay': auto,
    '@/config': { SYSTEM_CONFIG: { fast_timeout: 10 } }, '@/Core/Modules/stage/stageStateManager': { stageStateManager: e.stageStateManager } },
  { setInterval: (callback) => { tick = callback; return 1; }, clearInterval() {} });
  auto.autoNextSentence(); assert.equal(e.stage.reading.main_index, 1);
  e.WebGAL.gameplay.fastInterval = null; fast.startFast(true); tick(); assert.equal(e.stage.reading.main_index, 2);
  e.WebGAL.sceneManager.lockSceneWrite = true;
  auto.autoNextSentence(); tick(); assert.equal(e.stage.reading.main_index, 2);
});
test('在途原生 changeScene/callScene/restoreScene 完成时不能越过正在恢复的快照', async () => {
  for (const name of ['changeScene', 'callScene', 'restoreScene']) {
    const e = engine([sentence('readingNext')], ['main_next']); e.scriptExecutor();
    let advanced = 0;
    Object.assign(e.WebGAL.gameplay.performController, { hasBlockingNextPerform: () => false, hasUnsettledNonHoldPerform: () => false,
      discardUncommittedNonHoldPerforms() {}, clearNonHoldPerformsFromStageState() {}, beginCollectingPerforms() {}, endCollectingPerforms() {}, commitPendingPerforms() {} });
    Object.assign(e.stageStateManager, { commit() {}, applyCommittedPixiEffects() {} });
    e.WebGAL.events = { userInteractNext: { emit() {} } };
    e.WebGAL.flowchartManager = { unlockPendingCurrentScene() {}, waitForCurrentSceneDialog() {} };
    e.WebGAL.sceneManager.pushFrame = () => e.WebGAL.sceneManager.sceneData.sceneStack.push({ sceneUrl: '/start.txt', continueLine: 1 });
    e.WebGAL.sceneManager.popFrame = () => e.WebGAL.sceneManager.sceneData.sceneStack.pop();
    const logger = { warn() {}, debug() {}, error() {} };
    const nextApi = load('Core/controller/gamePlay/nextSentence.ts', { './scriptExecutor': { scriptExecutor: () => advanced++ },
      '../../util/logger': { logger }, '@/store/store': { webgalStore: { getState: () => ({ GUI: { showTitle: false } }) } },
      '@/Core/WebGAL': { WebGAL: e.WebGAL }, '@/Core/Modules/stage/stageStateManager': { stageStateManager: e.stageStateManager }, '@/recourse/reading/runtime': e.runtime });
    const requests = [];
    const sceneFetcher = () => new Promise((resolve) => requests.push(resolve));
    const sceneParser = (_raw, sceneName, sceneUrl) => ({ sceneName, sceneUrl });
    const native = load(`Core/controller/scene/${name}.ts`, { './sceneFetcher': { sceneFetcher }, '../../parser/sceneParser': { sceneParser },
      '../../util/logger': { logger }, '@/Core/controller/gamePlay/nextSentence': nextApi,
      '@/Core/util/prefetcher/assetsPrefetcher': { clearPrefetchLinks() {} }, '@/Core/WebGAL': { WebGAL: e.WebGAL }, '@/Core/Modules/scene': { MAX_SCENE_STACK_DEPTH: 64 } });
    const saved = { sceneUrl: '/start.txt', sceneName: 'start', currentSentenceId: 1, sceneStack: [] };
    if (name === 'restoreScene') native[name]({ sceneUrl: '/pending.txt', sceneName: 'pending', continueLine: 1 });
    else native[name]('/pending.txt', 'pending');
    const original = e.WebGAL.sceneManager.sceneWritePromise;
    const restore = load('recourse/reading/restore.ts', { 'lodash/cloneDeep': { default: copy }, '@/Core/WebGAL': { WebGAL: e.WebGAL },
      '@/Core/Modules/stage/stageStateManager': { stageStateManager: e.stageStateManager },
      '@/Core/controller/scene/sceneFetcher': { sceneFetcher }, '@/Core/parser/sceneParser': { sceneParser },
      '@/Core/controller/gamePlay/stopAllPerform': { stopAllPerform() {} }, './runtime': e.runtime });
    restore.restoreReadingSnapshot(copy(e.stage), saved, () => {});
    const snapshot = e.WebGAL.sceneManager.sceneWritePromise;
    requests[0]('pending'); await original; await Promise.resolve();
    nextApi.nextSentence(); assert.equal(nextApi.forward(), false); assert.equal(advanced, 0, name);
    assert.equal(e.runtime.isReadingRestorePending(), true);
    requests[1]('snapshot'); await snapshot;
    assert.equal(e.WebGAL.sceneManager.sceneData.currentScene.sceneUrl, '/start.txt');
    assert.equal(e.WebGAL.sceneManager.sceneData.currentSentenceId, 1);
    assert.equal(e.WebGAL.sceneManager.lockSceneWrite, false);
    assert.equal(e.runtime.isReadingRestorePending(), false);
  }
});
