import { describe, it, expect, beforeEach } from "vitest";
import { wrapResponse, errorResponse } from "../toolHelpers.js";
import { EventManager } from "../EventManager.js";

describe("toolHelpers", () => {
  let em: EventManager;

  beforeEach(() => {
    em = new EventManager();
  });

  describe("wrapResponse", () => {
    it("returns result without urgentEvents when queue is empty", () => {
      const wrapped = wrapResponse({ foo: "bar" }, em);
      expect(wrapped).toEqual({ result: { foo: "bar" } });
      expect(wrapped).not.toHaveProperty("urgentEvents");
    });

    it("includes urgentEvents when urgent events exist", () => {
      em.push({ tick: 1, type: "death", data: {}, summary: "died" });
      em.push({ tick: 2, type: "chat", data: { msg: "hello" }, summary: "hello" });

      const wrapped = wrapResponse({ data: 42 }, em);
      expect(wrapped.result).toEqual({ data: 42 });
      expect(wrapped.urgentEvents).toBeDefined();
      expect(wrapped.urgentEvents).toHaveLength(2);
    });

    it("does not include low/normal priority events in urgentEvents", () => {
      em.push({ tick: 1, type: "sunrise", data: {}, summary: "sunrise" });
      em.push({ tick: 2, type: "player_joined", data: {}, summary: "joined" });

      const wrapped = wrapResponse("test", em);
      expect(wrapped).not.toHaveProperty("urgentEvents");
    });

    it("drains urgent events so subsequent calls have none", () => {
      em.push({ tick: 1, type: "death", data: {}, summary: "died" });

      wrapResponse("first", em);
      const second = wrapResponse("second", em);
      expect(second).not.toHaveProperty("urgentEvents");
    });
  });

  describe("errorResponse", () => {
    it("returns success:false with error message", () => {
      const response = errorResponse("something broke", em);
      expect(response.result).toEqual({
        success: false,
        error: "something broke",
      });
    });

    it("includes urgentEvents if present", () => {
      em.push({ tick: 1, type: "death", data: {}, summary: "died" });
      const response = errorResponse("fail", em);
      expect(response.urgentEvents).toBeDefined();
      expect(response.urgentEvents).toHaveLength(1);
    });

    it("omits urgentEvents when none present", () => {
      const response = errorResponse("fail", em);
      expect(response).not.toHaveProperty("urgentEvents");
    });
  });
});
