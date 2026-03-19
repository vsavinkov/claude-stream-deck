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
  getPermIndex, setPermIndex, getPermCount,
  getPermLabels, getPermMode, getModelId, getEffortLevel,
} from "../dial-state.js";

@action({ UUID: "com.vsavinkov.claude.perm-dial" })
export class PermDialAction extends SingletonAction {
  override onWillAppear(_ev: WillAppearEvent): void {
    this.updateAllFeedback();
  }

  override onDialRotate(ev: DialRotateEvent): void {
    const prev = getPermIndex();
    const count = getPermCount();
    setPermIndex(Math.max(0, Math.min(count - 1,
      prev + (ev.payload.ticks > 0 ? 1 : -1))));
    if (getPermIndex() === prev) playClick();
    this.updateAllFeedback();
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    await createItermSession(getModelId(), getEffortLevel(), getPermMode());
  }

  updateAllFeedback(): void {
    const labels = getPermLabels();
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
