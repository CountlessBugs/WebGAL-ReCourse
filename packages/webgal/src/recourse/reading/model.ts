// SPDX-License-Identifier: MPL-2.0
/** Deterministic reading state. The compiler, never script flags, classifies page events. */
export interface ReadingPage { file_id: string; original_page: number }
export interface ReadingFile {
  file_id: string; original_name: string; format: 'pdf' | 'txt'; page_count: number;
  source_sha256: string; text_sha256: string;
}
export interface ReadingPlan {
  version: 1; run_id: number; reading_plan_id: string; script_revision: string;
  main_pages: ReadingPage[]; reference_files: ReadingFile[]; speaker: string;
}
export type ReadingAction = 'main_next' | 'local_next' | 'excursion_next' | 'jump' | 'return';
export interface ReadingNode {
  id: string; scene: string; line: number; call_path: { scene: string; line: number }[];
  scope_path: string[]; action: ReadingAction | null; has_return?: boolean;
}
export interface ReadingAnalysis {
  version: 1; reading_plan_id: string; script_revision: string; nodes: ReadingNode[];
  branches: { id: string; entry: string; merge: string; parent: string | null }[];
}
interface Excursion { base_page: ReadingPage | null }
interface ScopeSnapshot {
  display_page: ReadingPage | null; local_index: number; excursion: Excursion | null;
}
export interface ReadingState extends ScopeSnapshot {
  version: 1; run_id: number; reading_plan_id: string; script_revision: string;
  main_index: number; scope_stack: { id: string; saved: ScopeSnapshot }[];
  event_cursor: { event_id: string; kind: 'next' | 'jump' | 'return' | null; scene: string; line: number } | null;
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function createReadingState(plan: ReadingPlan): ReadingState {
  return {
    version: 1, run_id: plan.run_id, reading_plan_id: plan.reading_plan_id, script_revision: plan.script_revision,
    main_index: 0, local_index: 0, display_page: null, scope_stack: [], excursion: null, event_cursor: null,
  };
}

export function assertReadingIdentity(plan: ReadingPlan | null, state: ReadingState | null | undefined): void {
  if (!plan && !state) return;
  if (!plan || !state || state.version !== 1 || state.run_id !== plan.run_id ||
      state.reading_plan_id !== plan.reading_plan_id || state.script_revision !== plan.script_revision)
    throw new Error('reading.version_mismatch');
  if (!Number.isInteger(state.main_index) || state.main_index < 0 || state.main_index > plan.main_pages.length ||
      !Number.isInteger(state.local_index) || state.local_index < 0 || state.local_index > plan.main_pages.length ||
      !Array.isArray(state.scope_stack)) throw new Error('reading.state_invalid');
  const snapshot = (value: ScopeSnapshot) => {
    if (!value || !Number.isInteger(value.local_index) || value.local_index < 0 || value.local_index > plan.main_pages.length ||
        !('display_page' in value) || !('excursion' in value)) throw new Error('reading.state_invalid');
    if (value.display_page !== null) assertPage(plan, value.display_page);
    if (value.excursion !== null) {
      if (!value.excursion || !('base_page' in value.excursion)) throw new Error('reading.state_invalid');
      if (value.excursion.base_page !== null) assertPage(plan, value.excursion.base_page);
    }
  };
  snapshot(state);
  for (const scope of state.scope_stack) {
    if (!scope || typeof scope.id !== 'string' || !scope.id) throw new Error('reading.state_invalid');
    snapshot(scope.saved);
  }
  const cursor = state.event_cursor;
  if (cursor !== null && (!cursor || typeof cursor.event_id !== 'string' || !cursor.event_id ||
      typeof cursor.scene !== 'string' || !Number.isInteger(cursor.line) || cursor.line < 0 ||
      ![null, 'next', 'jump', 'return'].includes(cursor.kind))) throw new Error('reading.state_invalid');
}

export function assertPage(plan: ReadingPlan, page: ReadingPage): void {
  const file = page && plan.reference_files.find((item) => item.file_id === page.file_id);
  if (!file || !Number.isInteger(page.original_page) || page.original_page < 1 || page.original_page > file.page_count ||
      (file.format === 'txt' && page.original_page !== 1)) throw new Error('reading.page_out_of_range');
}

/** Reconcile scopes before the actual merge statement, including nested call contexts. */
export function enterReadingNode(previous: ReadingState, node: ReadingNode): ReadingState {
  const state = copy(previous);
  let common = 0;
  while (common < state.scope_stack.length && state.scope_stack[common].id === node.scope_path[common]) common++;
  while (state.scope_stack.length > common) {
    const saved = state.scope_stack.pop()!.saved;
    state.display_page = saved.display_page;
    state.local_index = saved.local_index;
    state.excursion = saved.excursion;
  }
  for (const id of node.scope_path.slice(common)) {
    state.scope_stack.push({ id, saved: copy({
      display_page: state.display_page, local_index: state.local_index, excursion: state.excursion,
    }) });
    state.excursion = null;
  }
  state.event_cursor = { event_id: node.id, kind: null, scene: node.scene, line: node.line };
  return state;
}

/** One event never changes another scope's progress or creates a nested jump-return stack. */
export function applyReadingEvent(previous: ReadingState, plan: ReadingPlan, node: ReadingNode,
                                  target?: ReadingPage): ReadingState {
  assertReadingIdentity(plan, previous);
  const state = enterReadingNode(previous, node);
  switch (node.action) {
    case 'main_next':
    case 'local_next': {
      const main = node.action === 'main_next';
      if (main !== (state.scope_stack.length === 0)) throw new Error('reading.scope_invalid');
      const index = main ? state.main_index : state.local_index;
      if (index >= plan.main_pages.length) throw new Error('reading.page_out_of_range');
      state.display_page = copy(plan.main_pages[index]);
      state.local_index = index + 1;
      if (main) state.main_index = index + 1;
      state.excursion = null;
      break;
    }
    case 'excursion_next':
      if (!state.excursion || !state.display_page) throw new Error('reading.return_unpaired');
      state.display_page = { ...state.display_page, original_page: state.display_page.original_page + 1 };
      assertPage(plan, state.display_page);
      break;
    case 'jump':
      if (!target) throw new Error('reading.page_out_of_range');
      assertPage(plan, target);
      if (!state.excursion) state.excursion = { base_page: copy(state.display_page) };
      state.display_page = copy(target);
      break;
    case 'return':
      if (!state.excursion) throw new Error('reading.return_unpaired');
      state.display_page = state.excursion.base_page;
      state.excursion = null;
      break;
    default: throw new Error('reading.event_invalid');
  }
  state.event_cursor!.kind = node.action === 'jump' ? 'jump' : node.action === 'return' ? 'return' : 'next';
  return state;
}

/** Native sceneStack stores the caller's instruction before its cursor is incremented. */
export function readingNodeId(scene: string, line: number, callPath: { scene: string; line: number }[]): string {
  return [...callPath, { scene, line }].map((item) => `${item.scene}:${item.line}`).join('>');
}
