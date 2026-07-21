import { GameEvent } from "./types.js";
import { EventManager } from "./EventManager.js";

/**
 * Wraps a tool's result with any urgent piggybacked events.
 *
 * Every tool response passes through this so the LLM always sees
 * critical events (damage, chat, death) even if it didn't call get_events.
 */
export function wrapResponse<T>(
  result: T,
  eventManager: EventManager
): { result: T; urgentEvents?: GameEvent[] } {
  const urgent = eventManager.drainUrgent();
  if (urgent.length > 0) {
    return { result, urgentEvents: urgent };
  }
  return { result };
}

/**
 * Builds an MCP tool result from a wrapped response, emitting both the
 * legacy JSON text block and structuredContent (MCP spec 2025-06-18+).
 * Clients that understand structured output get typed data without
 * re-parsing JSON out of the text; older clients keep working unchanged.
 */
export function toolResult(wrapped: {
  result: unknown;
  urgentEvents?: GameEvent[];
}): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: { [key: string]: unknown };
} {
  return {
    content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
    structuredContent: wrapped as unknown as { [key: string]: unknown },
  };
}

/**
 * Standard error response for tools.
 */
export function errorResponse(
  error: string,
  eventManager: EventManager
): { result: { success: false; error: string }; urgentEvents?: GameEvent[] } {
  return wrapResponse({ success: false as const, error }, eventManager);
}
