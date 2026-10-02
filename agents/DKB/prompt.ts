import { DK24_SYSTEM_PROMPT } from "./intro";
import { getGroqReply as getGroqReplyClient } from "../../ai/groqClient";
import { buildDynamicContextPrompt } from "../../ai/promptBuilder";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export async function getGroqReply(
  conversationMessages: ConversationMessage[],
  groqApiKey: string | undefined,
  groqModel: string,
  userPrompt: string,
  liveSearchContext?: string | null,
): Promise<string> {
  const dynamicContext = await buildDynamicContextPrompt(userPrompt);
  const extraContext = liveSearchContext ? `\n\n${liveSearchContext}` : "";
  const systemPrompt = `${DK24_SYSTEM_PROMPT}\n\n${dynamicContext}${extraContext}`;

  return getGroqReplyClient(conversationMessages, groqApiKey, groqModel, systemPrompt);
}
