import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  KeyUpEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { renderButton, ButtonData, AgentStatus } from "../renderers/button-svg.js";
import { focusItermTab, createItermSession, closeItermSession, sendToItermSession } from "../iterm.js";
import { bridgeClient } from "../bridge-client.js";
import { getModelId, getEffortLevel, getPermMode } from "../dial-state.js";

type KeySettings = JsonObject & {
  slotIndex?: number;
};

const LONG_PRESS_MS = 1000;
const DOUBLE_CLICK_MS = 400;

@action({ UUID: "com.vsavinkov.claude.agent-key" })
export class AgentKeyAction extends SingletonAction<KeySettings> {
  private pressTimers = new Map<string, number>();
  private lastTapTime = new Map<string, number>();
  private tapTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  override onWillAppear(ev: WillAppearEvent<KeySettings>): void {
    this.renderAction(ev.action, ev.payload.settings);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<KeySettings>): void {
    this.renderAction(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
    this.pressTimers.set(ev.action.id, Date.now());
  }

  override async onKeyUp(ev: KeyUpEvent<KeySettings>): Promise<void> {
    const downTime = this.pressTimers.get(ev.action.id) ?? Date.now();
    this.pressTimers.delete(ev.action.id);
    const duration = Date.now() - downTime;
    const now = Date.now();

    const slotIndex = (ev.payload.settings.slotIndex as number) ?? 0;
    const session = bridgeClient.getSessionBySlot(slotIndex);

    if (session) {
      if (duration >= LONG_PRESS_MS) {
        // Long press — kill session
        this.cancelPendingTap(ev.action.id);
        await closeItermSession(session.tty);
      } else {
        // Short press — check for double click
        const lastTap = this.lastTapTime.get(ev.action.id) ?? 0;
        this.lastTapTime.set(ev.action.id, now);

        if (now - lastTap < DOUBLE_CLICK_MS) {
          // Double click — compact session
          this.cancelPendingTap(ev.action.id);
          this.lastTapTime.delete(ev.action.id);
          await sendToItermSession(session.tty, "/compact");
        } else {
          // Delay single click to distinguish from double
          const timeout = setTimeout(async () => {
            this.tapTimeouts.delete(ev.action.id);
            await focusItermTab(session.tty, session.cwd);
          }, DOUBLE_CLICK_MS);
          this.tapTimeouts.set(ev.action.id, timeout);
        }
      }
    } else {
      if (duration < LONG_PRESS_MS) {
        // Short press on empty — create new session
        bridgeClient.reserveSlot(slotIndex);
        await createItermSession(getModelId(), getEffortLevel(), getPermMode());
      }
    }
  }

  private cancelPendingTap(actionId: string): void {
    const timeout = this.tapTimeouts.get(actionId);
    if (timeout) {
      clearTimeout(timeout);
      this.tapTimeouts.delete(actionId);
    }
  }

  private renderAction(act: { setImage: (svg: string) => Promise<void>; getSettings: <T extends JsonObject>() => Promise<T> }, settings: KeySettings): void {
    const slotIndex = (settings.slotIndex as number) ?? 0;
    const session = bridgeClient.getSessionBySlot(slotIndex);
    if (session) {
      const data: ButtonData = {
        name: session.name,
        slotIndex,
        status: session.status as AgentStatus,
        contextPct: session.contextPct,
        costUsd: session.costUsd,
        model: session.model,
      };
      act.setImage(`data:image/svg+xml,${encodeURIComponent(renderButton(data))}`);
    } else {
      act.setImage("");
    }
  }

  renderAll(): void {
    for (const act of this.actions) {
      act.getSettings<KeySettings>().then((settings) => {
        this.renderAction(act, settings);
      });
    }
  }
}
