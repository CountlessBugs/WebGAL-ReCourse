// SPDX-License-Identifier: MPL-2.0
import { useEffect, useRef, useState } from 'react';
import { useStageState } from '@/hooks/useStageState';
import { getReadingConfiguration } from './runtime';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import styles from './reading.module.scss';

/** Authorized original documents have their own interaction surface, separate from story clicks. */
export function ReadingPanel() {
  const reading = useStageState().reading;
  const config = getReadingConfiguration();
  const surface = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [renderedKey, setRenderedKey] = useState('');
  const file = config?.plan.reference_files.find((item) => item.file_id === reading?.display_page?.file_id);
  const page = reading?.display_page?.original_page;
  const resourceKey = `${file?.file_id}:${page}:${zoom}:${size}`;

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const isolate = (event: Event) => event.stopPropagation();
    // Native bubbling stops document hotkeys as well as the full-screen story surface.
    const events = ['contextmenu', 'wheel', 'keydown', 'keyup'];
    events.forEach((name) => element.addEventListener(name, isolate));
    const report = (event: Event) => {
      setRenderedKey('');
      setError((event as CustomEvent<{ code: string }>).detail.code);
    };
    window.addEventListener('recourse:reading-error', report);
    const resize = new ResizeObserver(() => setSize(element.clientWidth));
    resize.observe(element);
    return () => {
      events.forEach((name) => element.removeEventListener(name, isolate));
      window.removeEventListener('recourse:reading-error', report);
      resize.disconnect();
    };
  }, [!!config]);

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    host.replaceChildren();
    setRenderedKey('');
    setStatus('');
    setError('');
    if (!config || !file || !page) return;
    let active = true;
    const abort = new AbortController();
    let dispose: (() => void) | undefined;
    host.scrollTop = 0;
    host.scrollLeft = 0;
    setStatus('正在加载原文…');
    setError('');
    const url = new URL(encodeURIComponent(file.file_id), config.fileBaseUrl).href;
    const render = async () => {
      if (file.format === 'txt') {
        const response = await fetch(url, { credentials: 'same-origin', signal: abort.signal });
        if (!response.ok) throw new Error('reading.resource_unavailable');
        const text = await response.text();
        if (!active) return;
        const pre = document.createElement('pre');
        pre.className = styles.text;
        pre.style.fontSize = `${24 * zoom}px`;
        pre.textContent = text;
        host.replaceChildren(pre);
      } else {
        const pdfjs = await import('pdfjs-dist');
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const worker = new URL(workerUrl, location.href);
        const resources = new URL(import.meta.env.DEV ? '../' : './pdfjs/', worker).href;
        const task = pdfjs.getDocument({ url, withCredentials: true, cMapUrl: `${resources}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${resources}standard_fonts/`, wasmUrl: `${resources}wasm/` });
        dispose = () => { void task.destroy(); };
        const pdf = await task.promise;
        const original = await pdf.getPage(page);
        if (!active) return;
        const base = original.getViewport({ scale: 1 });
        const scale = Math.max(0.1, (host.clientWidth - 40) / base.width) * zoom;
        const view = original.getViewport({ scale });
        const wrapper = document.createElement('div');
        wrapper.className = styles.pdfPage;
        wrapper.style.width = `${view.width}px`;
        wrapper.style.height = `${view.height}px`;
        wrapper.style.setProperty('--total-scale-factor', String(scale * view.userUnit));
        wrapper.style.setProperty('--scale-round-x', '1px');
        wrapper.style.setProperty('--scale-round-y', '1px');
        const canvas = document.createElement('canvas');
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(view.width * ratio);
        canvas.height = Math.floor(view.height * ratio);
        canvas.style.width = `${view.width}px`;
        canvas.style.height = `${view.height}px`;
        canvas.setAttribute('aria-label', `${file.original_name}，原件第 ${page} 页`);
        wrapper.append(canvas);
        const text = document.createElement('div');
        text.className = styles.textLayer;
        wrapper.append(text);
        const layer = new pdfjs.TextLayer({ textContentSource: original.streamTextContent(), container: text, viewport: view });
        const rendering = original.render({ canvas, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] });
        dispose = () => { layer.cancel(); rendering.cancel(); void task.destroy(); };
        await Promise.all([rendering.promise, layer.render()]);
        if (!active) return;
        host.replaceChildren(wrapper);
      }
      if (active) {
        setRenderedKey(resourceKey);
        setStatus('');
      }
    };
    void render().catch((cause) => {
      if (active) { setStatus(''); setError(cause instanceof Error ? cause.message : 'reading.resource_unavailable'); }
    });
    return () => { active = false; abort.abort(); dispose?.(); };
  }, [config, file, page, zoom, size]);

  if (!config || !reading) return null;
  return (
    <section ref={surface} className={`${styles.panel} ${expanded ? styles.expanded : ''}`} tabIndex={0}
      aria-label="课程资料原文" data-recourse-reading-panel data-recourse-reading-ready={renderedKey === resourceKey ? 'true' : 'false'}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}>
      <header className={styles.toolbar}>
        <span>{file ? `${file.original_name} · 原件第 ${page} 页` : '等待展示课程资料'}</span>
        <span>主进度 {reading.main_index} / {config.plan.main_pages.length}</span>
        <button type="button" aria-label="缩小资料" disabled={zoom <= 0.5} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}>−</button>
        <button type="button" aria-label="重置缩放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="放大资料" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + 0.25))}>+</button>
        <button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开'}</button>
      </header>
      {status && <div className={styles.status} role="status">{status}</div>}
      {error && <div className={styles.error} role="alert">资料显示失败：{error}</div>}
      <div className={styles.viewport} ref={viewport} />
    </section>
  );
}
