// SPDX-License-Identifier: MPL-2.0
import { WebGAL } from '@/Core/WebGAL';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { createNonePerform } from '@/Core/Modules/perform/performInterface';
import { ISentence } from '@/Core/controller/scene/sceneInterface';
import { getNumberArgByKey } from '@/Core/util/getSentenceArg';
import { applyReadingEvent, assertReadingIdentity, createReadingState, enterReadingNode,
  readingNodeId, ReadingAnalysis, ReadingNode, ReadingPlan, ReadingState } from './model';

export interface ReadingConfiguration { plan: ReadingPlan; analysis: ReadingAnalysis; fileBaseUrl: string }
let configuration: ReadingConfiguration | null = null;
let nodes = new Map<string, ReadingNode>();
let readingRestorePending = false;
export const isReadingRestorePending = () => readingRestorePending;
export const setReadingRestorePending = (value: boolean) => { readingRestorePending = value; };

/** Called by the authorized host before starting a course, never by a scene script. */
export function configureGuidedReading(value: ReadingConfiguration): void {
  const { plan, analysis } = value;
  if (plan.version !== 1 || analysis.version !== 1 || !Number.isSafeInteger(plan.run_id) || plan.run_id < 1 ||
      plan.reading_plan_id !== analysis.reading_plan_id || plan.script_revision !== analysis.script_revision ||
      !plan.main_pages.length || new Set(analysis.nodes.map((node) => node.id)).size !== analysis.nodes.length)
    throw new Error('reading.plan_invalid');
  const base = new URL(value.fileBaseUrl, location.href);
  if (base.origin !== location.origin || base.search || base.hash || !base.pathname.endsWith('/'))
    throw new Error('reading.resource_invalid');
  configuration = JSON.parse(JSON.stringify({ ...value, fileBaseUrl: base.href }));
  nodes = new Map(configuration!.analysis.nodes.map((node) => [node.id, node]));
  stageStateManager.setStageAndCommit('reading', createReadingState(plan));
}

export const getReadingConfiguration = () => configuration;
export const isGuidedReading = () => configuration !== null;
export const isReadingEvent = (script: ISentence) =>
  ['readingNext', 'readingJump', 'readingReturn'].includes(script.commandRaw);

function filename(url: string): string { return decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()!); }

/** Scope restoration also runs on non-page statements at branch merge locations. */
export function beforeReadingSentence(): ReadingNode | null {
  if (!configuration) return null;
  const data = WebGAL.sceneManager.sceneData;
  const id = readingNodeId(filename(data.currentScene.sceneUrl), data.currentSentenceId,
    data.sceneStack.map((frame) => ({ scene: filename(frame.sceneUrl), line: frame.continueLine })));
  const node = nodes.get(id);
  if (!node) throw new Error('reading.position_invalid');
  const state = stageStateManager.getCalculationStageState().reading ?? createReadingState(configuration.plan);
  assertReadingIdentity(configuration.plan, state);
  stageStateManager.setStage('reading', enterReadingNode(state, node));
  return node;
}

/** Reading commands are state changes, not replayable performances. */
export function readingCommand(script: ISentence) {
  if (!configuration) throw new Error('reading.plan_missing');
  const { plan } = configuration;
  if (script.commandRaw === 'readingOrder') {
    const order = JSON.parse(script.content) as { file_id: string; page_range: number[] }[];
    const pages = order.flatMap((range) => Array.from({ length: range.page_range[1] - range.page_range[0] + 1 },
      (_, index) => ({ file_id: range.file_id, original_page: range.page_range[0] + index })));
    if (JSON.stringify(pages) !== JSON.stringify(plan.main_pages)) throw new Error('reading.plan_invalid');
    return createNonePerform({ blockingAuto: false });
  }
  const state = stageStateManager.getCalculationStageState().reading;
  if (!state?.event_cursor) throw new Error('reading.position_invalid');
  const node = nodes.get(state.event_cursor.event_id);
  if (!node) throw new Error('reading.position_invalid');
  const expected = script.commandRaw === 'readingNext' ? ['main_next', 'local_next', 'excursion_next']
    : script.commandRaw === 'readingJump' ? ['jump'] : script.commandRaw === 'readingReturn' ? ['return'] : [];
  if (!node.action || !expected.includes(node.action)) throw new Error('reading.event_invalid');
  const target = script.commandRaw === 'readingJump' ? {
    file_id: script.content, original_page: getNumberArgByKey(script, 'page')!,
  } : undefined;
  stageStateManager.setStage('reading', applyReadingEvent(state, plan, node, target));
  WebGAL.gameplay.performController.unmountPerform('vocal-play', true);
  for (const key of ['showText', 'showName', 'vocal', 'playVocal', 'currentConcatDialogPrev'] as const)
    stageStateManager.setStage(key, '');
  stageStateManager.setStage('currentDialogSegments', []);
  stageStateManager.setStage('isDialogNotend', false);
  stageStateManager.setStage('currentDialogKey', `reading:${node.id}`);
  return createNonePerform({ blockingAuto: false });
}

export function assertReadingRestore(state: ReadingState | null | undefined): void {
  assertReadingIdentity(configuration?.plan ?? null, state);
  if (state?.event_cursor) {
    const node = nodes.get(state.event_cursor.event_id);
    if (!node || node.scene !== state.event_cursor.scene || node.line !== state.event_cursor.line ||
        JSON.stringify(node.scope_path) !== JSON.stringify(state.scope_stack.map((scope) => scope.id)))
      throw new Error('reading.position_invalid');
    const expected = node.action === 'jump' ? 'jump' : node.action === 'return' ? 'return' : node.action ? 'next' : null;
    // A conditionally skipped page statement has a position but no executed page action.
    if (state.event_cursor.kind !== null && state.event_cursor.kind !== expected) throw new Error('reading.state_invalid');
  } else if (state && (state.main_index !== 0 || state.scope_stack.length || state.display_page !== null)) {
    throw new Error('reading.position_invalid');
  }
}

export function getReadingContext() {
  const state = stageStateManager.getCalculationStageState().reading;
  if (!state?.display_page || !state.event_cursor) return null;
  return { run_id: state.run_id, reading_plan_id: state.reading_plan_id, script_revision: state.script_revision,
    event_id: state.event_cursor.event_id, ...state.display_page };
}

export function reportReadingError(error: unknown): void {
  const code = error instanceof Error ? error.message : 'reading.unavailable';
  window.dispatchEvent(new CustomEvent('recourse:reading-error', { detail: { code } }));
}
