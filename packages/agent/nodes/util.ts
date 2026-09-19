import type { BaseMessage } from "@langchain/core/messages";
import { contentToText } from "../llm";
import { LLM_HISTORY_WINDOW } from "../config";
import type { TraceEvent } from "../types";

export function msgText(m: BaseMessage | undefined): string {
  return m ? contentToText(m.content) : "";
}

export function lastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].getType() === "human") return msgText(messages[i]);
  return "";
}

export function toChat(messages: BaseMessage[], n = LLM_HISTORY_WINDOW): { role: "user" | "assistant"; content: string }[] {
  return messages.slice(-n).map((m) => ({ role: m.getType() === "human" ? "user" : "assistant", content: msgText(m) }));
}

export function ev(node: string, extra: Partial<TraceEvent> = {}): TraceEvent {
  return { node, ts: new Date().toISOString(), ...extra };
}
