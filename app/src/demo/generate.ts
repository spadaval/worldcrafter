/**
 * Drives generation in the demo for screenshots, as the writer would:
 * `?demo&generate=request` presses Generate next and leaves the request
 * slip open; `?demo&generate=send` (with `&stall`, caught mid-stream) also
 * presses Send. Loaded only with `?demo&generate`.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function find(selector: string): Promise<HTMLElement> {
  for (let i = 0; i < 200; i++) {
    const found = document.querySelector<HTMLElement>(selector);
    if (found && !found.matches("[aria-disabled=true]")) return found;
    await wait(25);
  }
  throw new Error(`the demo has no ${selector}`);
}

export async function driveGeneration(mode: string): Promise<void> {
  await find(".prose");
  (await find(".masthead .button-primary")).click();
  const send = await find(".request-slip .context-viewer-send");
  if (mode === "send") send.click();
}
