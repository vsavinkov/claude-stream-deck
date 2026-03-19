import {
  action,
  DialDownEvent,
  DialRotateEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { createItermSession } from "../iterm.js";
import { playClick } from "../click-sound.js";
import {
  getModelIndex, setModelIndex, getModelCount,
  getModelId, getModelLabels, getEffortLevel, getPermMode,
} from "../dial-state.js";

@action({ UUID: "com.vsavinkov.claude.model-dial" })
export class ModelDialAction extends SingletonAction {
  override onWillAppear(_ev: WillAppearEvent): void {
    this.updateAllFeedback();
  }

  override onDialRotate(ev: DialRotateEvent): void {
    const prev = getModelIndex();
    const count = getModelCount();
    setModelIndex(Math.max(0, Math.min(count - 1,
      prev + (ev.payload.ticks > 0 ? 1 : -1))));
    if (getModelIndex() === prev) playClick();
    this.updateAllFeedback();
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    await createItermSession(getModelId(), getEffortLevel(), getPermMode());
  }

  updateAllFeedback(): void {
    const labels = getModelLabels();
    for (const act of this.actions) {
      if (act.isDial()) {
        act.setFeedback({
          prev: labels.prev,
          current: labels.current,
          next: labels.next,
        });
      }
    }
  }
}
