import { describe, expect, it } from "vitest";
import { actionOutcome, renderMessage } from "../web/src/lineMessages.ts";

describe("renderMessage", () => {
  it("shows text with quick reply postbacks (the qk-jenga shape)", () => {
    const r = renderMessage({
      type: "text",
      text: "参加者を募集中",
      quickReply: {
        items: [
          { type: "action", action: { type: "postback", label: "参加する", data: "a=join", displayText: "参加する" } },
          { type: "action", action: { type: "postback", label: "締め切る", data: "a=close", displayText: "締め切る" } },
        ],
      },
    });
    expect(r.texts).toEqual(["参加者を募集中"]);
    expect(r.quickReplies.map((q) => q.label)).toEqual(["参加する", "締め切る"]);
    expect(r.lossy).toBe(false);
  });

  it("collects buttons from templates and flex", () => {
    const template = renderMessage({
      type: "template",
      altText: "確認",
      template: { type: "confirm", text: "よいですか？", actions: [{ type: "message", label: "はい", text: "はい" }] },
    });
    expect(template.texts).toEqual(["よいですか？"]);
    expect(template.buttons.map((b) => b.label)).toEqual(["はい"]);

    const flex = renderMessage({
      type: "flex",
      altText: "結果",
      contents: {
        type: "bubble",
        hero: { type: "image", url: "https://example.com/a.png" },
        body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "1位 Aさん" }] },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [{ type: "button", action: { type: "postback", label: "もう一回", data: "again" } }],
        },
      },
    });
    expect(flex.texts).toEqual(["1位 Aさん"]);
    expect(flex.images).toEqual(["https://example.com/a.png"]);
    expect(flex.buttons.map((b) => b.label)).toEqual(["もう一回"]);
    expect(flex.lossy).toBe(true);
  });
});

describe("actionOutcome", () => {
  it("maps actions to what the tapping user sends", () => {
    expect(actionOutcome({ type: "postback", data: "a=1", displayText: "押した" })).toEqual({
      kind: "send",
      action: { type: "postback", data: "a=1", displayText: "押した" },
    });
    expect(actionOutcome({ type: "message", label: "はい", text: "はい" })).toEqual({
      kind: "send",
      action: { type: "text", text: "はい" },
    });
    expect(actionOutcome({ type: "uri", uri: "https://example.com" })).toEqual({ kind: "open", url: "https://example.com" });
    const picker = actionOutcome({ type: "datetimepicker", data: "d", mode: "date" });
    expect(picker.kind === "needsInput" && picker.complete("2026-11-01")).toEqual({
      type: "postback",
      data: "d",
      params: { date: "2026-11-01" },
    });
    expect(actionOutcome({ type: "camera" }).kind).toBe("unsupported");
  });
});
