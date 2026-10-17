import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Result } from "neverthrow";
import { buildRequest, send } from "./client";
import { SseParser } from "./sse";
import type {
  BackendProfile,
  Completion,
  LlmError,
  StreamDelta,
} from "./types";

type Handler = (req: Request, body: unknown) => Response | Promise<Response>;

let handler: Handler = () => new Response("no handler", { status: 500 });
const received: { path: string; headers: Headers; body: unknown }[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body: unknown = await req.json();
    received.push({
      path: new URL(req.url).pathname,
      headers: req.headers,
      body,
    });
    return handler(req, body);
  },
});
afterAll(() => server.stop(true));
beforeEach(() => {
  received.length = 0;
});

const profile: BackendProfile = {
  name: "local",
  kind: "llamacpp",
  baseUrl: `http://localhost:${server.port}/v1/`,
  model: "qwen",
  sampler: { temperature: 0.8, min_p: 0.05, n_probs: 3 },
};

const encoder = new TextEncoder();

/** Streams `pieces` verbatim, so tests control where chunk boundaries fall. */
function sse(pieces: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const piece of pieces) {
          controller.enqueue(encoder.encode(piece));
          await Bun.sleep(2);
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

const chatChunk = (content: string, extra: object = {}) =>
  `data: ${JSON.stringify({ model: "qwen", choices: [{ index: 0, delta: { content }, ...extra }] })}\n\n`;

function expectErr(
  result: Result<Completion, LlmError>,
  kind: LlmError["kind"],
): LlmError {
  expect(result.isErr()).toBe(true);
  const error = result._unsafeUnwrapErr();
  expect(error.kind).toBe(kind);
  return error;
}

describe("request assembly", () => {
  test("sampler fields reach the request body unchanged", async () => {
    handler = () =>
      Response.json({
        choices: [{ index: 0, text: "x", finish_reason: "stop" }],
      });
    const sampler = {
      top_k: 40,
      typical_p: 0.9,
      repeat_penalty: 1.1,
      mirostat: 2,
      mirostat_tau: 5,
      mirostat_eta: 0.1,
      dry_multiplier: 0.8,
      dry_sequence_breakers: ["\n", ":"],
      xtc_probability: 0.5,
      xtc_threshold: 0.1,
      samplers: ["dry", "top_k", "min_p", "temperature"],
      grammar: 'root ::= "yes" | "no"',
      some_future_key: { nested: [1, null, "two"] },
      temperature: 1.3,
    };
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "Once upon" },
      { stream: false, sampler: { ...sampler, min_p: undefined } },
    );
    const result = await send(profile, request);
    expect(result.isOk()).toBe(true);

    expect(received[0]?.path).toBe("/v1/completions");
    expect(received[0]?.body).toEqual(request.body);
    expect(received[0]?.body).toEqual({
      ...sampler,
      min_p: 0.05,
      n_probs: 3,
      model: "qwen",
      prompt: "Once upon",
      stream: false,
    });
  });

  test("api key and OpenRouter headers are sent but not stored in the request", async () => {
    handler = () =>
      Response.json({
        choices: [
          { index: 0, message: { content: "hi" }, finish_reason: "stop" },
        ],
      });
    const router: BackendProfile = {
      ...profile,
      kind: "openrouter",
      apiKey: "sk-test",
    };
    const request = buildRequest(
      router,
      { kind: "chat", messages: [{ role: "user", content: "hello" }] },
      { stream: false },
    );
    expect(JSON.stringify(request)).not.toContain("sk-test");
    await send(router, request);
    expect(received[0]?.headers.get("authorization")).toBe("Bearer sk-test");
    expect(received[0]?.headers.get("x-title")).toBe("WorldCrafter");
  });
});

describe("non-streaming", () => {
  test("chat returns message content, logprobs and finish reason", async () => {
    handler = () =>
      Response.json({
        model: "qwen-7b",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "The end." },
            finish_reason: "stop",
            logprobs: {
              content: [
                {
                  token: "The",
                  logprob: -0.1,
                  top_logprobs: [
                    { token: "The", logprob: -0.1 },
                    { token: "A", logprob: -2.5 },
                  ],
                },
              ],
            },
          },
        ],
      });
    const request = buildRequest(
      profile,
      { kind: "chat", messages: [{ role: "user", content: "End it." }] },
      { stream: false, sampler: { logprobs: true, top_logprobs: 2 } },
    );
    const result = await send(profile, request);
    expect(received[0]?.path).toBe("/v1/chat/completions");
    expect(result._unsafeUnwrap()).toEqual({
      text: "The end.",
      model: "qwen-7b",
      finishReason: "stop",
      logprobs: [
        {
          token: "The",
          logprob: -0.1,
          top: [
            { token: "The", logprob: -0.1 },
            { token: "A", logprob: -2.5 },
          ],
        },
      ],
    });
  });

  test("completions returns text and legacy OpenAI logprobs", async () => {
    handler = () =>
      Response.json({
        choices: [
          {
            index: 0,
            text: " a time",
            finish_reason: "length",
            logprobs: {
              tokens: [" a", " time"],
              token_logprobs: [-0.2, -0.3],
              top_logprobs: [{ " a": -0.2, " the": -1.9 }, { " time": -0.3 }],
            },
          },
        ],
      });
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "Once upon" },
      { stream: false },
    );
    const completion = (await send(profile, request))._unsafeUnwrap();
    expect(completion.text).toBe(" a time");
    expect(completion.finishReason).toBe("length");
    expect(completion.logprobs).toEqual([
      {
        token: " a",
        logprob: -0.2,
        top: [
          { token: " a", logprob: -0.2 },
          { token: " the", logprob: -1.9 },
        ],
      },
      {
        token: " time",
        logprob: -0.3,
        top: [{ token: " time", logprob: -0.3 }],
      },
    ]);
  });

  test("llama.cpp post-sampling probabilities are kept as probs", async () => {
    handler = () =>
      Response.json({
        choices: [
          {
            index: 0,
            text: "x",
            finish_reason: "stop",
            logprobs: {
              content: [
                {
                  token: "x",
                  prob: 0.7,
                  top_probs: [{ token: "y", prob: 0.2 }],
                },
              ],
            },
          },
        ],
      });
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "" },
      { stream: false },
    );
    const completion = (await send(profile, request))._unsafeUnwrap();
    expect(completion.logprobs).toEqual([
      { token: "x", prob: 0.7, top: [{ token: "y", prob: 0.2 }] },
    ]);
  });

  test("absent logprobs are null", async () => {
    handler = () =>
      Response.json({
        choices: [{ index: 0, text: "x", finish_reason: "stop" }],
      });
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "" },
      { stream: false },
    );
    expect((await send(profile, request))._unsafeUnwrap().logprobs).toBeNull();
  });
});

describe("streaming", () => {
  test("deltas are assembled in order across split SSE lines", async () => {
    const body = [
      ": keep-alive comment\n\n",
      chatChunk("Once"),
      chatChunk(" upon"),
      chatChunk(" a", { finish_reason: null }),
      chatChunk(" time", { finish_reason: "stop" }),
      "data: [DONE]\n\n",
    ].join("");
    // Split mid-line, mid-"data:" field and between \r and \n.
    const crlf = body.replaceAll("\n", "\r\n");
    const pieces: string[] = [];
    for (let i = 0; i < crlf.length; i += 7) pieces.push(crlf.slice(i, i + 7));
    handler = () => sse(pieces);

    const deltas: StreamDelta[] = [];
    const request = buildRequest(
      profile,
      { kind: "chat", messages: [{ role: "user", content: "go" }] },
      { stream: true },
    );
    const result = await send(profile, request, {
      onDelta: (d) => deltas.push(d),
    });
    expect(deltas.map((d) => d.text)).toEqual(["Once", " upon", " a", " time"]);
    expect(result._unsafeUnwrap()).toEqual({
      text: "Once upon a time",
      logprobs: null,
      finishReason: "stop",
      model: "qwen",
    });
  });

  test("streamed completions capture per-chunk logprobs", async () => {
    const chunk = (text: string, logprob: number, finish: string | null) =>
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            text,
            finish_reason: finish,
            logprobs: {
              content: [
                {
                  token: text,
                  logprob,
                  top_logprobs: [{ token: text, logprob }],
                },
              ],
            },
          },
        ],
      })}\n\n`;
    handler = () =>
      sse([
        chunk("It", -0.5, null),
        chunk(" was", -0.25, "stop"),
        "data: [DONE]\n\n",
      ]);
    const deltas: StreamDelta[] = [];
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "" },
      { stream: true },
    );
    const completion = (
      await send(profile, request, { onDelta: (d) => deltas.push(d) })
    )._unsafeUnwrap();
    expect(completion.text).toBe("It was");
    expect(completion.logprobs?.map((t) => [t.token, t.logprob])).toEqual([
      ["It", -0.5],
      [" was", -0.25],
    ]);
    expect(deltas[1]?.logprobs[0]?.top).toEqual([
      { token: " was", logprob: -0.25 },
    ]);
  });

  test("cancelling mid-stream aborts and yields an abort error", async () => {
    let serverSawCancel = false;
    handler = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(chatChunk("first")));
          },
          cancel() {
            serverSawCancel = true;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    const controller = new AbortController();
    const deltas: string[] = [];
    const request = buildRequest(
      profile,
      { kind: "chat", messages: [{ role: "user", content: "go" }] },
      { stream: true },
    );
    const result = await send(profile, request, {
      signal: controller.signal,
      onDelta: (d) => {
        deltas.push(d.text);
        controller.abort();
      },
    });
    expect(deltas).toEqual(["first"]);
    expectErr(result, "aborted");
    await Bun.sleep(20);
    expect(serverSawCancel).toBe(true);
  });

  test("an event that is not JSON is a malformed error", async () => {
    handler = () => sse([chatChunk("ok"), "data: {not json\n\n"]);
    const request = buildRequest(
      profile,
      { kind: "chat", messages: [] },
      { stream: true },
    );
    expectErr(await send(profile, request), "malformed");
  });

  test("a stream that ends without finishing is a malformed error", async () => {
    handler = () => sse([chatChunk("partial")]);
    const request = buildRequest(
      profile,
      { kind: "chat", messages: [] },
      { stream: true },
    );
    expectErr(await send(profile, request), "malformed");
  });

  test("an error event mid-stream is a server error", async () => {
    handler = () =>
      sse([
        chatChunk("ok"),
        `data: ${JSON.stringify({ error: { message: "context full" } })}\n\n`,
      ]);
    const request = buildRequest(
      profile,
      { kind: "chat", messages: [] },
      { stream: true },
    );
    const error = expectErr(await send(profile, request), "server");
    expect(error.message).toContain("context full");
  });
});

describe("failures", () => {
  test.each([
    400, 503,
  ])("HTTP %d returns an error with the body message", async (status) => {
    handler = () =>
      Response.json({ error: { message: `bad thing ${status}` } }, { status });
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "" },
      { stream: true },
    );
    const error = expectErr(await send(profile, request), "http");
    expect(error).toMatchObject({ status });
    expect(error.message).toContain(`bad thing ${status}`);
  });

  test("a plain-text error body is used as the message", async () => {
    handler = () => new Response("model not loaded", { status: 500 });
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "" },
      { stream: false },
    );
    const error = expectErr(await send(profile, request), "http");
    expect(error.message).toContain("model not loaded");
  });

  test("connection refused returns a network error", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = closed.port;
    await closed.stop(true);
    const request = buildRequest(
      { ...profile, baseUrl: `http://localhost:${port}/v1` },
      { kind: "chat", messages: [] },
      { stream: true },
    );
    const error = expectErr(await send(profile, request), "network");
    expect(error.url).toBe(`http://localhost:${port}/v1/chat/completions`);
  });

  test("aborting before the response arrives yields an abort error", async () => {
    handler = async () => {
      await Bun.sleep(200);
      return Response.json({});
    };
    const request = buildRequest(
      profile,
      { kind: "completion", prompt: "" },
      { stream: false },
    );
    const result = await send(profile, request, {
      signal: AbortSignal.timeout(20),
    });
    expectErr(result, "aborted");
  });
});

describe("SSE parser", () => {
  test("a CRLF split across chunks is one line ending, not two", () => {
    const parser = new SseParser();
    expect(parser.push("data: a\r")).toEqual([]);
    expect(parser.push("\ndata: b\r\n\r\n")).toEqual(["a\nb"]);
  });

  test("joins multi-line data and flushes an unterminated final event", () => {
    const parser = new SseParser();
    expect(parser.push("event: x\ndata: a\nda")).toEqual([]);
    expect(parser.push("ta: b\n\ndata:c")).toEqual(["a\nb"]);
    expect(parser.end()).toEqual(["c"]);
  });
});
