import OpenAI from "openai";
import type { ClientFactory, OpenAILike } from "./pipeline";

/** Creates the real OpenAI SDK client used in the browser. */
export const createOpenAIClient: ClientFactory = (options) => new OpenAI(options) as unknown as OpenAILike;
