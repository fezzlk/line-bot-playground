import type { LineMessage, PlaygroundAction } from "../../shared/types.ts";

// Turns the LINE message objects a bot sent into something the UI can show:
// text lines, images, and the tappable actions (buttons, quick replies).
// Pure functions so they can be tested without a browser.

export interface LineAction {
  type: string;
  label?: string;
  data?: string;
  text?: string;
  displayText?: string;
  uri?: string;
  mode?: string;
  richMenuAliasId?: string;
  [key: string]: unknown;
}

export interface Tappable {
  label: string;
  action: LineAction;
}

export interface RenderedMessage {
  texts: string[];
  images: string[];
  buttons: Tappable[];
  quickReplies: Tappable[];
  /** True when the display is a simplification and the raw JSON is worth a look. */
  lossy: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function toTappable(action: unknown, fallbackLabel?: string): Tappable | null {
  if (!isObject(action) || typeof action.type !== "string") return null;
  const a = action as LineAction;
  return { label: str(a.label) ?? fallbackLabel ?? str(a.text) ?? a.type, action: a };
}

/** Walks a flex container collecting texts, images and every component with an action. */
function walkFlex(node: unknown, out: RenderedMessage): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walkFlex(n, out));
    return;
  }
  if (!isObject(node)) return;
  const type = node.type;
  if (type === "text") {
    const spans = Array.isArray(node.contents)
      ? node.contents.map((s) => (isObject(s) ? (str(s.text) ?? "") : "")).join("")
      : "";
    const text = str(node.text) ?? spans;
    if (text) out.texts.push(text);
  } else if (type === "image") {
    const url = str(node.url);
    if (url) out.images.push(url);
  }
  if (node.action) {
    const label = type === "text" ? str(node.text) : undefined;
    const tappable = toTappable(node.action, label);
    if (tappable) out.buttons.push(tappable);
  }
  for (const key of ["header", "hero", "body", "footer", "contents"]) {
    if (key === "contents" && type === "text") continue;
    walkFlex(node[key], out);
  }
}

export function renderMessage(message: LineMessage): RenderedMessage {
  const out: RenderedMessage = { texts: [], images: [], buttons: [], quickReplies: [], lossy: false };
  const m = message as Record<string, unknown>;

  switch (message.type) {
    case "text":
    case "textV2": {
      const text = str(m.text);
      if (text) out.texts.push(text);
      break;
    }
    case "image": {
      const url = str(m.previewImageUrl) ?? str(m.originalContentUrl);
      if (url) out.images.push(url);
      break;
    }
    case "sticker":
      out.texts.push(`［スタンプ ${String(m.packageId)}/${String(m.stickerId)}］`);
      break;
    case "template": {
      const t = isObject(m.template) ? m.template : {};
      const columns = Array.isArray(t.columns) ? t.columns : [t];
      for (const column of columns) {
        if (!isObject(column)) continue;
        const title = str(column.title);
        if (title) out.texts.push(title);
        const text = str(column.text);
        if (text) out.texts.push(text);
        const image = str(column.thumbnailImageUrl) ?? str(column.imageUrl);
        if (image) out.images.push(image);
        const actions = Array.isArray(column.actions) ? column.actions : column.action ? [column.action] : [];
        for (const action of actions) {
          const tappable = toTappable(action);
          if (tappable) out.buttons.push(tappable);
        }
      }
      if (out.texts.length === 0) out.texts.push(str(m.altText) ?? "");
      out.lossy = t.type === "carousel" || t.type === "image_carousel";
      break;
    }
    case "flex":
      walkFlex(m.contents, out);
      if (out.texts.length === 0) out.texts.push(str(m.altText) ?? "");
      out.lossy = true;
      break;
    default:
      out.texts.push(`［${message.type} メッセージ］`);
      out.lossy = true;
  }

  const items = isObject(m.quickReply) && Array.isArray(m.quickReply.items) ? m.quickReply.items : [];
  for (const item of items) {
    const tappable = isObject(item) ? toTappable(item.action) : null;
    if (tappable) out.quickReplies.push(tappable);
  }
  return out;
}

export type ActionOutcome =
  | { kind: "send"; action: PlaygroundAction }
  | { kind: "open"; url: string }
  | { kind: "needsInput"; prompt: string; complete: (value: string) => PlaygroundAction }
  | { kind: "unsupported"; reason: string };

/** What tapping a LINE action does, as the user who tapped it. */
export function actionOutcome(action: LineAction): ActionOutcome {
  switch (action.type) {
    case "postback":
      return {
        kind: "send",
        action: {
          type: "postback",
          data: action.data ?? "",
          displayText: str(action.displayText) ?? str(action.text),
        },
      };
    case "message":
      return { kind: "send", action: { type: "text", text: action.text ?? action.label ?? "" } };
    case "uri":
      return action.uri ? { kind: "open", url: action.uri } : { kind: "unsupported", reason: "URI がありません" };
    case "datetimepicker": {
      const mode = action.mode === "date" || action.mode === "time" ? action.mode : "datetime";
      const example = { date: "2026-11-01", time: "12:00", datetime: "2026-11-01T12:00" }[mode];
      return {
        kind: "needsInput",
        prompt: `${mode} を入力（例: ${example}）`,
        complete: (value) => ({ type: "postback", data: action.data ?? "", params: { [mode]: value } }),
      };
    }
    case "richmenuswitch":
      return {
        kind: "send",
        action: {
          type: "postback",
          data: action.data ?? "",
          params: { newRichMenuAliasId: action.richMenuAliasId ?? "", status: "SUCCESS" },
        },
      };
    default:
      return { kind: "unsupported", reason: `${action.type} アクションは未対応です` };
  }
}
