import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  MAX_OUTPUT_TOKENS,
  MAX_REPAIR_ERRORS,
  OPENAI_MODEL,
  REASONING_EFFORT,
  REQUEST_TIMEOUT_MS,
} from "../config";
import { buildRepairPrompt, buildUserPrompt, SYSTEM_PROMPT, type PromptInput } from "./prompt";
import { ScenarioWireSchema, type Genre, type Scenario } from "./schema";
import { validateScenario, type ValidationContext } from "./validator";

// ---- Minimal client surface so tests can pass a fake ----

export interface ClientOptions {
  apiKey: string;
  dangerouslyAllowBrowser: true;
  timeout: number;
  maxRetries: number;
}

export interface InputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ParseRequestBody {
  model: string;
  input: InputMessage[];
  text: { format: ReturnType<typeof zodTextFormat<typeof ScenarioWireSchema>> };
  reasoning?: { effort: "low" | "medium" | "high" };
  max_output_tokens: number;
  store: false;
}

export interface ParsedResponseLike {
  status?: string | null;
  output_parsed: unknown;
  output_text?: string;
  output?: unknown[];
}

export interface OpenAILike {
  responses: {
    parse(body: ParseRequestBody, options?: { signal?: AbortSignal }): Promise<ParsedResponseLike>;
  };
  /** Used only to check the key after a connection error (not an LLM request). */
  models?: {
    list(options?: { signal?: AbortSignal }): PromiseLike<unknown>;
  };
}

export type ClientFactory = (options: ClientOptions) => OpenAILike;

// ---- Outcomes ----

export type FailureKind = "rejected" | "timeout" | "network" | "refusal" | "incomplete" | "cancelled";

export const FAILURE_REASONS = {
  timeout: "Request timed out",
  network: "Couldn't reach OpenAI",
  refusal: "The model declined the request",
  incomplete: "The response was incomplete",
  invalid: "The generated scenario was invalid",
} as const;

export type PipelineOutcome =
  | { kind: "rejected" }
  | { kind: "ready"; scenario: Scenario; source: "generated" | "default"; notice: string | null };

export type PipelinePhase = "generating" | "repairing";

export interface PipelineParams {
  apiKey: string;
  genre: Genre;
  prompt: Omit<PromptInput, "genre">;
  validation: Omit<ValidationContext, "requestedGenre">;
  defaultScenario: Scenario;
  clientFactory: ClientFactory;
  signal: AbortSignal;
  onProgress?: (phase: PipelinePhase) => void;
  /** Development diagnostics. Never receives the API key. */
  warn?: (message: string, details?: unknown) => void;
}

export function fallbackNotice(reason: string): string {
  return `${reason} \u2014 using the built-in scenario.`;
}

type RequestResult = { ok: true; parsed: unknown; raw: string } | { ok: false; failure: FailureKind };

function hasRefusal(response: ParsedResponseLike): boolean {
  return (response.output ?? []).some((item) => {
    if (typeof item !== "object" || item === null) return false;
    const content = (item as { content?: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some((c) => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "refusal")
    );
  });
}

export function classifyError(error: unknown, signal: AbortSignal): FailureKind {
  if (signal.aborted || error instanceof APIUserAbortError) return "cancelled";
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return "rejected";
  if (error instanceof APIError) return "network";
  if (error instanceof SyntaxError) return "incomplete";
  if (error instanceof Error && (error.name === "ZodError" || error.name === "$ZodError")) return "incomplete";
  return "network";
}

async function sendRequest(client: OpenAILike, input: InputMessage[], signal: AbortSignal): Promise<RequestResult> {
  const body: ParseRequestBody = {
    model: OPENAI_MODEL,
    input,
    text: { format: zodTextFormat(ScenarioWireSchema, "scenario") },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
  };
  if (REASONING_EFFORT !== null) body.reasoning = { effort: REASONING_EFFORT };
  try {
    const response = await client.responses.parse(body, { signal });
    if (signal.aborted) return { ok: false, failure: "cancelled" };
    if (hasRefusal(response)) return { ok: false, failure: "refusal" };
    if (response.status && response.status !== "completed") return { ok: false, failure: "incomplete" };
    const parsed = response.output_parsed;
    if (parsed === null || parsed === undefined) return { ok: false, failure: "incomplete" };
    const raw = response.output_text && response.output_text.length > 0 ? response.output_text : JSON.stringify(parsed);
    return { ok: true, parsed, raw };
  } catch (error) {
    const failure = classifyError(error, signal);
    if (failure === "network" && error instanceof APIConnectionError && !(error instanceof APIConnectionTimeoutError)) {
      return { ok: false, failure: await checkKeyAfterConnectionError(client, signal) };
    }
    return { ok: false, failure };
  }
}

/**
 * Browsers hide some 401 responses from /v1/responses behind a CORS error, so a rejected key can
 * look like a connection failure. /v1/models answers 401 with CORS headers, which tells them apart.
 */
async function checkKeyAfterConnectionError(client: OpenAILike, signal: AbortSignal): Promise<FailureKind> {
  if (!client.models) return "network";
  try {
    await client.models.list({ signal });
    return signal.aborted ? "cancelled" : "network";
  } catch (error) {
    const kind = classifyError(error, signal);
    return kind === "rejected" || kind === "cancelled" ? kind : "network";
  }
}

/** Section 9 pipeline: one generation request, at most one repair, then fall back. */
export async function runScenarioPipeline(params: PipelineParams): Promise<PipelineOutcome> {
  const { genre, signal, warn } = params;
  const fallback = (reason: string | null): PipelineOutcome => ({
    kind: "ready",
    scenario: params.defaultScenario,
    source: "default",
    notice: reason === null ? null : fallbackNotice(reason),
  });
  const validation: ValidationContext = { ...params.validation, requestedGenre: genre };

  const client = params.clientFactory({
    apiKey: params.apiKey,
    dangerouslyAllowBrowser: true,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });
  const userPrompt = buildUserPrompt({ ...params.prompt, genre });
  const baseMessages: InputMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  params.onProgress?.("generating");
  const first = await sendRequest(client, baseMessages, signal);
  if (!first.ok) {
    warn?.(`Scenario generation failed: ${first.failure}`);
    if (first.failure === "rejected") return { kind: "rejected" };
    if (first.failure === "cancelled") return fallback(null);
    return fallback(FAILURE_REASONS[first.failure]);
  }

  const firstCheck = validateScenario(first.parsed, validation);
  if (firstCheck.ok) return { kind: "ready", scenario: firstCheck.scenario, source: "generated", notice: null };
  warn?.("Generated scenario failed validation; sending one repair request.", firstCheck.errors);

  if (signal.aborted) return fallback(null);
  params.onProgress?.("repairing");
  const repair = await sendRequest(
    client,
    [
      ...baseMessages,
      { role: "assistant", content: first.raw },
      { role: "user", content: buildRepairPrompt(firstCheck.errors.slice(0, MAX_REPAIR_ERRORS)) },
    ],
    signal,
  );
  if (!repair.ok) {
    warn?.(`Repair request failed: ${repair.failure}`);
    return fallback(repair.failure === "cancelled" ? null : FAILURE_REASONS.invalid);
  }
  const repairCheck = validateScenario(repair.parsed, validation);
  if (repairCheck.ok) return { kind: "ready", scenario: repairCheck.scenario, source: "generated", notice: null };
  warn?.("Repaired scenario is still invalid; using the built-in scenario.", repairCheck.errors);
  return fallback(FAILURE_REASONS.invalid);
}
