import { BotContext, AgentResult } from "./core/BotHandler";
import { createAgent } from "./core/createAgent";
import { handleMessage } from "./PARAG/handler";
import { PARAG_HELP_TEXT } from "./PARAG/intro";

// botId 3: MAHORAGA (formerly PARAG)
const ParagAgent = createAgent({
  botId: 3,
  name: "MAHORAGA",
  handleMessage: (ctx: BotContext): Promise<AgentResult> =>
    handleMessage(
      ctx.session,
      ctx.prompt,
      ctx.groqApiKey,
      ctx.groqModel,
      ctx.isAdmin,
    ),
  getHelpText: () => PARAG_HELP_TEXT,
});

export default ParagAgent;
