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
 * Standard error response for tools.
 */
export function errorResponse(
  error: string,
  eventManager: EventManager
): { result: { success: false; error: string }; urgentEvents?: GameEvent[] } {
  return wrapResponse({ success: false as const, error }, eventManager);
}
