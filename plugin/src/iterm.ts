import streamDeck from "@elgato/streamdeck";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";

function runAppleScript(script: string): Promise<void> {
  const tmpFile = join(tmpdir(), `sd-claude-${Date.now()}.scpt`);
  writeFileSync(tmpFile, script, "utf-8");

  return new Promise((resolve) => {
    execFile("osascript", [tmpFile], (err, _stdout, stderr) => {
      try { unlinkSync(tmpFile); } catch {}
      if (err) {
        streamDeck.logger.error(`AppleScript error: ${err.message} ${stderr}`);
      }
      resolve();
    });
  });
}

export async function focusItermTab(tty: string, cwd: string): Promise<void> {
  const escapedTty = tty.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const home = process.env.HOME ?? "/Users/daemonic";
  const tilded = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const escapedCwd = tilded.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // Primary: match by tty (unique per session). Fallback: match by cwd in tab title.
  const script = `
tell application "iTerm2"
  activate
  set targetTTY to "${escapedTty}"
  set targetCwd to "${escapedCwd}"
  set delim to (character id 160) & (character id 8212) & (character id 160)

  -- First pass: exact tty match
  if targetTTY is not "" then
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is targetTTY then
            select t
            return
          end if
        end repeat
      end repeat
    end repeat
  end if

  -- Fallback: match by cwd in tab title
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        set tabName to name of s
        if tabName contains "Claude Code" then
          set AppleScript's text item delimiters to delim
          try
            set tabPath to text item 2 of tabName
            set AppleScript's text item delimiters to ""
            if targetCwd starts with tabPath then
              select t
              return
            end if
          on error
            set AppleScript's text item delimiters to ""
          end try
        end if
      end repeat
    end repeat
  end repeat
end tell
`;
  await runAppleScript(script);
}

export async function createItermSession(model: string, effort?: string, permMode?: string): Promise<void> {
  const escaped = model.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const effortFlag = effort ? ` --effort ${effort}` : "";
  const permFlag = permMode ? ` --permission-mode ${permMode}` : "";
  const script = `
tell application "iTerm2"
  activate
  tell current window
    create tab with default profile
    tell current session of current tab
      write text "claude --model ${escaped}${effortFlag}${permFlag}"
    end tell
  end tell
end tell
`;
  await runAppleScript(script);
}

export async function sendToItermSession(tty: string, text: string): Promise<void> {
  const escapedTty = tty.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${escapedTty}" then
          tell s to write text "${escapedText}"
          return
        end if
      end repeat
    end repeat
  end repeat
end tell
`;
  await runAppleScript(script);
}

export async function closeItermSession(tty: string): Promise<void> {
  const escapedTty = tty.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${escapedTty}" then
          tell s to close
          return
        end if
      end repeat
    end repeat
  end repeat
end tell
`;
  await runAppleScript(script);
}
