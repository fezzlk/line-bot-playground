import { createHmac } from "node:crypto";

/** The `x-line-signature` value LINE sends: base64(HMAC-SHA256(channelSecret, body)). */
export function signBody(channelSecret: string, body: string): string {
  return createHmac("sha256", channelSecret).update(body).digest("base64");
}
