// SPDX-License-Identifier: MPL-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function load(name, globals = {}) {
  const path = resolve(__dirname, '../packages/webgal/src/recourse', name);
  const source = readFileSync(path, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, console: { warn() {} }, URLSearchParams, ...globals });
  return exports;
}
function fonts() {
  const loads = [], registered = [], messages = [];
  const api = load('fonts.ts', {
    require: (path) => ({ default: path }),
    window: { recoursePreviewOrigin: 'https://course.example' },
    parent: { postMessage: (...message) => messages.push(message) },
    document: { fonts: { add: (font) => registered.push(font) } },
    FontFace: function (family, url) {
      this.load = () => new Promise((resolve, reject) => loads.push({ family, url, resolve, reject }));
    },
  });
  return { api, loads, registered, messages };
}
test('系统字体不下载；字体仅选择时下载且只注册加载完成的字体', async () => {
  const { api, loads, registered } = fonts();
  api.requestCourseFont(api.systemFont);
  assert.equal(loads.length, 0);
  api.requestCourseFont(api.courseFontFamilies[1]);
  api.requestCourseFont(api.courseFontFamilies[1]);
  assert.equal(loads.length, 1);
  assert.equal(registered.length, 0);
  assert.match(loads[0].url, /SourceHanSerif/);
  loads[0].resolve('serif');
  await Promise.resolve();
  assert.deepEqual(registered, ['serif']);
});
test('并发选择不串字体，失败后使用系统字体并通知预览', async () => {
  const { api, loads, registered, messages } = fonts();
  api.requestCourseFont(api.courseFontFamilies[0]);
  api.requestCourseFont(api.courseFontFamilies[2]);
  loads[1].resolve('sans');
  loads[0].reject(new Error('offline'));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(registered, ['sans']);
  assert.equal(messages[0][0].type, 'recourse:preview-error');
  assert.equal(messages[0][1], 'https://course.example');
  assert.match(api.requestCourseFont(api.courseFontFamilies[0]), /system-ui/);
  assert.equal(loads.length, 2);
});
test('已有 ReCourse 字体偏好保留，损坏或旧索引重置且不改变其他选项', () => {
  const { api } = fonts();
  for (const textboxFont of [0, 1, 2, 3]) {
    assert.equal(api.restoreCourseFont({ textboxFont, recourseFontVersion: 1 }).textboxFont, textboxFont);
    const restored = api.restoreCourseFont({ textboxFont, textSpeed: 70 });
    assert.equal(restored.textboxFont, 0);
    assert.equal(restored.textSpeed, 70);
  }
  for (const textboxFont of [undefined, -1, 1.5, '1'])
    assert.equal(api.restoreCourseFont({ textboxFont, recourseFontVersion: 1 }).textboxFont, 0);
});
test('宿主设置覆盖异步恢复，未知设置被拒绝', () => {
  const optionData = { textSpeed: 10 }, subscribers = [];
  const store = { getState: () => ({ userData: { optionData }, GUI: { fontOptions: [] } }),
    subscribe: (fn) => subscribers.push(fn),
    dispatch: ({ payload }) => { optionData[payload.key] = payload.value; subscribers.forEach((fn) => fn()); } };
  const api = load('settings.ts', {
    location: { hash: '#recourse-settings=' + encodeURIComponent(JSON.stringify({ textSpeed: 90 })) },
    require: (path) => path === '@/store/store' ? { webgalStore: store } : { systemFont: 'system', courseFontFamilies: [] },
  });
  api.installCourseSettings();
  assert.equal(optionData.textSpeed, 90);
  optionData.textSpeed = 5; subscribers.forEach((fn) => fn());
  assert.equal(optionData.textSpeed, 90);
  const invalid = load('settings.ts', { location: { hash: '#recourse-settings=%7B%22unknown%22%3A1%7D' }, require: () => ({}) });
  assert.throws(() => invalid.installCourseSettings(), /无效选项/);
});
