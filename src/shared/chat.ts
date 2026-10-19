import { z } from "zod";
import type { ErrorCode } from "./report";

// The Coaching Chat contract. The browser sends the whole conversation each
// turn because the Worker keeps nothing (ADR-0001).

export const MAX_CHAT_TURNS = 30;

export const chatTurnSchema = z.object({
  role: z.enum(["user", "model"]),
  text: z.string().min(1),
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

// History is completed exchanges: user, model, user, model…
export const chatHistorySchema = z
  .array(chatTurnSchema)
  .refine((turns) => turns.length % 2 === 0 && turns.every((t, i) => t.role === (i % 2 === 0 ? "user" : "model")), {
    message: "History must be whole exchanges: user then model",
  });

export function userTurns(history: ChatTurn[]): number {
  return history.filter((t) => t.role === "user").length;
}

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "done" };
