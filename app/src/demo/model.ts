/**
 * The demo world's model: a canned OpenAI-compatible server, so generation
 * can be seen without a real one (`?demo`). It answers any chat request to
 * `DEMO_PROFILE` with the same continuation, streamed a few words at a time.
 * With `stall`, it stops half-way and never finishes, so a screenshot can
 * catch the segment mid-stream. Only the demo loads this module.
 */
import type { BackendProfile, Fetch } from "~/llm/types";

export const DEMO_PROFILE: BackendProfile = {
  name: "demo",
  label: "Demo model",
  kind: "generic",
  // Never fetched: .invalid can't resolve.
  baseUrl: "https://demo-model.invalid/v1",
  model: "demo-canned",
  sampler: { temperature: 0.8, max_tokens: 400 },
};

const CONTINUATION = [
  "The light swung across the iron and caught on the seal, a ring of salt-white metal no wider than a coin. Ardelia did not look at it. She had looked at it every night for three hundred years, in the only dream she still had.",
  "",
  "“Then you know what happens if it opens,” Kesh said.",
  "",
  "“I know what happened the last time.” She took her hand from the door. The cold stayed in it.",
].join("\n");

const encoder = new TextEncoder();

const event = (data: unknown) =>
  encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

export function demoFetch(options: { stall: boolean }): Fetch {
  return async (url, init) => {
    if (!url.startsWith(DEMO_PROFILE.baseUrl)) {
      return new Response("The demo model only answers the demo profile.", {
        status: 404,
      });
    }
    const words = CONTINUATION.match(/\S+\s*|\s+/g) ?? [];
    const until = options.stall ? Math.floor(words.length / 2) : words.length;
    const signal = init.signal;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const wait = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        for (let i = 0; i < until; i += 2) {
          if (signal?.aborted) return controller.close();
          const content = words.slice(i, i + 2).join("");
          controller.enqueue(
            event({
              model: DEMO_PROFILE.model,
              choices: [{ index: 0, delta: { content } }],
            }),
          );
          await wait(45);
        }
        if (options.stall) {
          // Stays open until the writer stops it.
          signal?.addEventListener("abort", () => controller.close());
          return;
        }
        controller.enqueue(
          event({
            model: DEMO_PROFILE.model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
}
