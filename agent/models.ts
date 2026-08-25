import { ChatOpenAI } from "@langchain/openai";

// Cheap/fast model for extraction, stronger model for reasoning/pricing.
// Swap model names for whatever key you're given (OpenAI or Gemini).
export const extractionModel = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
export const reasoningModel = new ChatOpenAI({ model: "gpt-4o", temperature: 0.2 });
