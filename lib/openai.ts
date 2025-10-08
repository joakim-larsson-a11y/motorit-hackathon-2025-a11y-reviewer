import OpenAI from "openai";

const globalForOpenAi = globalThis as unknown as {
  openai: OpenAI | undefined;
};

export const openai =
  globalForOpenAi.openai ??
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

if (process.env.NODE_ENV !== "production") {
  globalForOpenAi.openai = openai;
}

export default openai;
