import { execFile } from "child_process";

const SOUND = "/System/Library/Sounds/Tink.aiff";

export function playClick(): void {
  execFile("afplay", [SOUND], () => {});
}
