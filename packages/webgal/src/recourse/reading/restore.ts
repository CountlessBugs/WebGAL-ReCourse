// SPDX-License-Identifier: MPL-2.0
import cloneDeep from 'lodash/cloneDeep';
import { WebGAL } from '@/Core/WebGAL';
import { IStageState } from '@/Core/Modules/stage/stageInterface';
import { stageStateManager } from '@/Core/Modules/stage/stageStateManager';
import { ISaveScene } from '@/store/userDataInterface';
import { sceneFetcher } from '@/Core/controller/scene/sceneFetcher';
import { sceneParser } from '@/Core/parser/sceneParser';
import { stopAllPerform } from '@/Core/controller/gamePlay/stopAllPerform';
import { assertReadingRestore, reportReadingError, setReadingRestorePending } from './runtime';

let restoreGeneration = 0;

/** A guided snapshot is applied only after its matching scene has finished loading. */
export function restoreReadingSnapshot(stage: IStageState, savedScene: ISaveScene, complete: () => void,
                                       refetch = true): void {
  try { assertReadingRestore(stage.reading); }
  catch (error) { reportReadingError(error); return; }
  const generation = ++restoreGeneration;
  const previousWrite = WebGAL.sceneManager.sceneWritePromise;
  setReadingRestorePending(true);
  WebGAL.sceneManager.lockSceneWrite = true;
  stopAllPerform();
  const fetched = refetch ? sceneFetcher(savedScene.sceneUrl) : Promise.resolve(null);
  const settled = Promise.resolve(previousWrite).catch(() => {}).then(() => {
    // Native scene writers release their lock in finally; retain ours until this snapshot is complete.
    if (generation === restoreGeneration) WebGAL.sceneManager.lockSceneWrite = true;
  });
  const loading = Promise.allSettled([fetched, settled]).then(([raw]) => {
    if (raw.status === 'rejected') throw raw.reason;
    return raw.value;
  });
  const pending = loading.then((raw) => {
    if (generation !== restoreGeneration) return;
    if (raw !== null) WebGAL.sceneManager.sceneData.currentScene = sceneParser(raw, savedScene.sceneName, savedScene.sceneUrl);
    WebGAL.sceneManager.settledScenes.add(savedScene.sceneUrl);
    WebGAL.sceneManager.sceneData.currentSentenceId = savedScene.currentSentenceId;
    WebGAL.sceneManager.sceneData.sceneStack = cloneDeep(savedScene.sceneStack);
    WebGAL.sceneManager.sceneData.currentLocals = cloneDeep(savedScene.currentLocals ?? {});
    const state = cloneDeep(stage);
    state.isRead = true;
    stageStateManager.replaceCalculationStageState(state);
    complete();
    stageStateManager.notify();
  }).catch((error) => {
    if (generation === restoreGeneration) reportReadingError(error);
  }).finally(() => {
    if (generation === restoreGeneration) {
      setReadingRestorePending(false);
      WebGAL.sceneManager.lockSceneWrite = false;
      WebGAL.sceneManager.sceneWritePromise = null;
    }
  });
  WebGAL.sceneManager.sceneWritePromise = pending;
}
