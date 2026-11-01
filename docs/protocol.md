# コントローラーとプラグインの約束事（protocol 1）

line-bot-playground のコントローラーは、各 bot のサーバーに組み込んだ「代理送信プラグイン」をこの HTTP API で操作します。プラグインは bot の言語ごとに実装し、この約束事に合わせます。

- Node（TypeScript）の実装例: [qk-jenga-line-bot `src/playground/`](https://github.com/fezzlk/qk-jenga-line-bot/tree/main/src/playground)

## 有効化と認証

- 有効にするのは、`PLAYGROUND_ENABLED=true` と `PLAYGROUND_TOKEN` の両方がそろったときだけです。無効のときはエンドポイントを公開せず、bot の LINE 送信の動きも変えません
- すべてのリクエストに `Authorization: Bearer <PLAYGROUND_TOKEN>` を付けます。プラグインは、タイミング攻撃に強い方法で照合します。違っていたら 401 を返します
- 代理送信と架空ユーザーの追加ができるのは、`PLAYGROUND_ALLOWED_GROUPS`（カンマ区切りのグループ ID）に入っているグループだけです。それ以外のグループには 403 を返します

## 架空のユーザー

- グループごとに作ります。ID は `Uplayground` で始まる 33 文字です
- bot がプロフィールを取得すると（`getProfile`、`getGroupMemberProfile` など）、プラグインはこの名前を返します
- 永続化してください（Cloud Run のようにインスタンスが入れ替わる環境があるため）

## 架空ユーザーとして送ったときの動き（`POST /send`）

1. 架空ユーザーが操作したときに LINE が送るのと同じ形の webhook イベントを作り、bot の普段のイベント処理に直接渡して終わるまで待つ。返信トークンは `playground:` で始まる値にする
2. その返信トークンへの返信を、LINE には送らずに捕まえる
3. グループに push する。中身は、代理表示（例: `🧪Bさん: 参加する`）と、捕まえた返信。push 1 回に入るメッセージは 5 個までなので、それを超えるときだけ分ける
4. push する返信からは `quickReply` を外す。グループで押すと、本物のユーザーが押したことになるため
5. bot が、架空ユーザーの送った画像を取りに来たら（`getMessageContent`）、リクエストで受け取った画像を返す

push は、LINE の月ごとの無料メッセージ数を、グループの人数分消費します（返信は消費しません）。自分と bot だけのテスト用グループなら、操作 1 回につき 1 通です。

## 会話の記録

コントローラーで架空ユーザーにボタンを押させるために、プラグインは許可されたグループの会話を記録します。「参加する」のように本物のユーザーへの返信に付いたボタンも、ここから押せます。

- 本物のユーザーの操作（`kind: "real"`）
- 架空ユーザーの操作（`kind: "fictional"`）
- bot が返した、ボタンを含むメッセージの全文（`kind: "bot"`）

あわせて、bot に届いた本物の webhook から、グループ ID・グループ名・本物のメンバーの ID を覚えます。これは、許可されていないグループでも行います。グループ一覧に出して、ID を確かめられるようにするためです。

## エンドポイント（すべて `/playground` の下）

| メソッドとパス | 内容 | 応答 |
|---|---|---|
| `GET /info` | プラグインの情報 | `{ protocol: 1, bot: string }` |
| `GET /groups` | 覚えたグループと、許可されたグループ | `{ groups: [{ groupId, name, realUserIds, lastSeenAt, allowed }] }` |
| `GET /groups/:groupId/users` | 架空ユーザーの一覧 | `{ users: [{ userId, groupId, name }] }` |
| `POST /groups/:groupId/users` | 架空ユーザーを追加する。本文は `{ name }` | `{ userId, groupId, name }` |
| `PATCH /groups/:groupId/users/:userId` | 架空ユーザーの名前を変える。本文は `{ name }` | `{ userId, groupId, name }` |
| `GET /groups/:groupId/messages?limit=N` | 会話の記録の新しいものから N 件を、古い順に並べたもの。N は 1〜100 で、既定は 30 | `{ messages: [entry] }` |
| `POST /send` | 架空ユーザーとして送る。本文は `{ groupId, userId, action }` | `{ replies: [LINE message], pushes: number }` |

`action` は次のいずれかです。

```jsonc
{ "type": "text", "text": "参加" }
{ "type": "image", "base64": "<画像のバイト列を base64 にしたもの>" }
{ "type": "postback", "data": "a=join&r=…", "displayText": "参加する", "params": { "date": "2026-11-01" } }
{ "type": "memberJoined" }
```

会話の記録の `entry` は次のいずれかです。

```jsonc
{ "at": 0, "kind": "real", "userId": "U…", "text": "問題作成開始" }
{ "at": 0, "kind": "fictional", "userId": "Uplayground…", "name": "Bさん", "text": "参加する" }
{ "at": 0, "kind": "bot", "replyTo": "U…", "messages": [ /* LINE message objects */ ] }
```

エラーのときは `{ "error": string }` を返します。ステータスは、入力が不正なら 400、認証に失敗したら 401、許可されていないグループなら 403、存在しない架空ユーザーなら 404 です。
