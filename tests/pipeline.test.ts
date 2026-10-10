import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";
import { describe, expect, it } from "vitest";
import {
  FAILURE_REASONS,
  fallbackNotice,
  runScenarioPipeline,
  type ClientOptions,
  type OpenAILike,
  type ParseRequestBody,
  type ParsedResponseLike,
  type PipelineParams,
} from "../src/scenario/pipeline";
import type { Scenario } from "../src/scenario/schema";
import { ANCHORS, FIXTURES, validScenario } from "./fixtures";

type Step = ParsedResponseLike | Error | ((signal: AbortSignal | undefined) => Promise<ParsedResponseLike>);

function completed(parsed: unknown): ParsedResponseLike {
  return { status: "completed", output_parsed: parsed, output_text: JSON.stringify(parsed), output: [] };
}

function apiError(status: number): APIError {
  return APIError.generate(status, { error: { message: "nope" } }, "nope", new Headers());
}

function fakeClient(steps: Step[], modelsStep?: Error | "ok") {
  const calls: { body: ParseRequestBody; signal?: AbortSignal }[] = [];
  const options: ClientOptions[] = [];
  let modelsCalls = 0;
  const factory = (opts: ClientOptions): OpenAILike => {
    options.push(opts);
    const client: OpenAILike = {
      responses: {
        parse: async (body, requestOptions) => {
          calls.push({ body, signal: requestOptions?.signal });
          const step = steps.shift();
          if (!step) throw new Error("unexpected extra request");
          if (step instanceof Error) throw step;
          if (typeof step === "function") return step(requestOptions?.signal);
          return step;
        },
      },
    };
    if (modelsStep) {
      client.models = {
        list: async () => {
          modelsCalls++;
          if (modelsStep instanceof Error) throw modelsStep;
          return {};
        },
      };
    }
    return client;
  };
  return { factory, calls, options, modelsCalls: () => modelsCalls };
}

const DEFAULT: Scenario = { ...validScenario(), scenario_title: "Built-in" };

function params(factory: PipelineParams["clientFactory"], overrides: Partial<PipelineParams> = {}): PipelineParams {
  return {
    apiKey: "sk-test-key",
    genre: "ESCAPE",
    prompt: { anchors: ANCHORS, fixtures: FIXTURES, npcDescriptions: ["a", "b", "c", "d", "e", "f", "g"] },
    validation: { anchors: ANCHORS, fixtures: FIXTURES, npcVariantCount: 7 },
    defaultScenario: DEFAULT,
    clientFactory: factory,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function invalidScenario(): Scenario {
  return { ...validScenario(), genre: "HEIST" };
}

describe("loading pipeline", () => {
  it("starts a valid first response with no repair", async () => {
    const fake = fakeClient([completed(validScenario())]);
    const outcome = await runScenarioPipeline(params(fake.factory));
    expect(outcome).toMatchObject({ kind: "ready", source: "generated", notice: null });
    expect(fake.calls).toHaveLength(1);
  });

  it("creates the client with maxRetries 0 and sends store: false", async () => {
    const fake = fakeClient([completed(validScenario())]);
    await runScenarioPipeline(params(fake.factory));
    expect(fake.options[0]).toMatchObject({ apiKey: "sk-test-key", maxRetries: 0, dangerouslyAllowBrowser: true });
    expect(fake.calls[0]!.body.store).toBe(false);
    expect(fake.calls[0]!.body.text.format.type).toBe("json_schema");
    expect(fake.calls[0]!.signal).toBeDefined();
  });

  it("never puts the API key in prompt content", async () => {
    const fake = fakeClient([completed(validScenario())]);
    await runScenarioPipeline(params(fake.factory));
    expect(JSON.stringify(fake.calls[0]!.body.input)).not.toContain("sk-test-key");
  });

  const failures: [string, Step, string][] = [
    ["timeout", new APIConnectionTimeoutError(), FAILURE_REASONS.timeout],
    ["network error", new APIConnectionError({ message: "offline" }), FAILURE_REASONS.network],
    ["429", apiError(429), FAILURE_REASONS.network],
    ["500", apiError(500), FAILURE_REASONS.network],
    ["400", apiError(400), FAILURE_REASONS.network],
    [
      "refusal",
      { status: "completed", output_parsed: null, output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] },
      FAILURE_REASONS.refusal,
    ],
    ["incomplete", { status: "incomplete", output_parsed: null, output: [] }, FAILURE_REASONS.incomplete],
    ["unparseable output", new SyntaxError("Unexpected end of JSON input"), FAILURE_REASONS.incomplete],
  ];
  for (const [name, step, reason] of failures) {
    it(`falls back with no repair on ${name}`, async () => {
      const fake = fakeClient([step]);
      const outcome = await runScenarioPipeline(params(fake.factory));
      expect(outcome).toEqual({ kind: "ready", scenario: DEFAULT, source: "default", notice: fallbackNotice(reason) });
      expect(fake.calls).toHaveLength(1);
    });
  }

  it("returns to the key form on 401 and 403", async () => {
    for (const status of [401, 403]) {
      const fake = fakeClient([apiError(status)]);
      expect(await runScenarioPipeline(params(fake.factory))).toEqual({ kind: "rejected" });
      expect(fake.calls).toHaveLength(1);
    }
  });

  it("detects a rejected key hidden behind a browser CORS error", async () => {
    const fake = fakeClient([new APIConnectionError({ message: "Failed to fetch" })], apiError(401));
    expect(await runScenarioPipeline(params(fake.factory))).toEqual({ kind: "rejected" });
    expect(fake.modelsCalls()).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });

  it("keeps a real connection error as a network failure when the key checks out", async () => {
    const fake = fakeClient([new APIConnectionError({ message: "Failed to fetch" })], "ok");
    const outcome = await runScenarioPipeline(params(fake.factory));
    expect(outcome).toMatchObject({ kind: "ready", source: "default", notice: fallbackNotice(FAILURE_REASONS.network) });
  });

  it("sends exactly one repair with the original prompt, previous JSON, and errors", async () => {
    const bad = invalidScenario();
    const fake = fakeClient([completed(bad), completed(validScenario())]);
    const phases: string[] = [];
    const outcome = await runScenarioPipeline(params(fake.factory, { onProgress: (p) => phases.push(p) }));
    expect(outcome).toMatchObject({ kind: "ready", source: "generated", notice: null });
    expect(fake.calls).toHaveLength(2);
    expect(phases).toEqual(["generating", "repairing"]);
    const [first, second] = [fake.calls[0]!.body.input, fake.calls[1]!.body.input];
    expect(second).toHaveLength(4);
    expect(second[0]).toEqual(first[0]);
    expect(second[1]).toEqual(first[1]);
    expect(second[2]).toEqual({ role: "assistant", content: JSON.stringify(bad) });
    expect(second[3]!.role).toBe("user");
    expect(second[3]!.content).toContain('genre must be "ESCAPE"');
    expect(fake.calls[1]!.body.store).toBe(false);
  });

  it("falls back when the repaired response is still invalid", async () => {
    const fake = fakeClient([completed(invalidScenario()), completed(invalidScenario())]);
    const outcome = await runScenarioPipeline(params(fake.factory));
    expect(outcome).toMatchObject({ kind: "ready", source: "default", notice: fallbackNotice(FAILURE_REASONS.invalid) });
    expect(fake.calls).toHaveLength(2);
  });

  it("falls back when the repair request fails", async () => {
    for (const failure of [apiError(500), new APIConnectionTimeoutError(), apiError(401)]) {
      const fake = fakeClient([completed(invalidScenario()), failure]);
      const outcome = await runScenarioPipeline(params(fake.factory));
      expect(outcome).toMatchObject({ kind: "ready", source: "default", notice: fallbackNotice(FAILURE_REASONS.invalid) });
      expect(fake.calls).toHaveLength(2);
    }
  });

  it("falls back with no notice when cancelled during generation", async () => {
    const controller = new AbortController();
    const hang = (signal: AbortSignal | undefined) =>
      new Promise<ParsedResponseLike>((_, reject) => signal?.addEventListener("abort", () => reject(new APIUserAbortError())));
    const fake = fakeClient([hang]);
    const pending = runScenarioPipeline(params(fake.factory, { signal: controller.signal }));
    controller.abort();
    expect(await pending).toEqual({ kind: "ready", scenario: DEFAULT, source: "default", notice: null });
  });

  it("ignores a late response after cancelling", async () => {
    const controller = new AbortController();
    const late = async () => {
      controller.abort();
      return completed(validScenario());
    };
    const fake = fakeClient([late]);
    const outcome = await runScenarioPipeline(params(fake.factory, { signal: controller.signal }));
    expect(outcome).toMatchObject({ source: "default", notice: null });
  });

  it("falls back with no notice when cancelled during the repair", async () => {
    const controller = new AbortController();
    const hang = (signal: AbortSignal | undefined) =>
      new Promise<ParsedResponseLike>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new APIUserAbortError()));
        queueMicrotask(() => controller.abort());
      });
    const fake = fakeClient([completed(invalidScenario()), hang]);
    const outcome = await runScenarioPipeline(params(fake.factory, { signal: controller.signal }));
    expect(outcome).toEqual({ kind: "ready", scenario: DEFAULT, source: "default", notice: null });
    expect(fake.calls).toHaveLength(2);
  });
});
