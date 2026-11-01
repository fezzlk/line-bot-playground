# line-bot-playground

LINE アカウントが 1 つしかなくても、グループで使う LINE bot の「複数人の流れ」（参加表明・手番の交代・別の人の回答など）を確かめるための、ローカル用の Web ツールです。架空のユーザーを何人でも作り、画面から 1 人ずつ切り替えて bot に話しかけられます。

```
[ブラウザ（Mac / 同じ Wi-Fi のスマホ）]
      │ 操作・表示（SSE で即時更新）
[playground サーバー :8787] ── 署名付き webhook ──▶ [bot の /callback]
      ▲                                                  │
      └──── モックの LINE API（検証モードの bot だけ）◀────┘
```

## 2 つのモード

| モード | bot 側の準備 | 見えるもの |
|---|---|---|
| `mock`（検証） | LINE API の送り先を playground に向ける | 全員分の返信・push。Quick Reply やボタンを押し返せる |
| `production`（本番） | なし | bot が webhook に何を返したか（200 / 401 など）だけ |

LINE の webhook は、チャネルシークレットによる署名（`x-line-signature`）だけで正当性を判定します。playground は同じ方法で署名するので、bot からは本物の LINE から届いたイベントと区別できません。

本番モードでは、架空のユーザーへの返信を LINE が拒否します（返信トークンが架空のため）。返信まで確かめるときは、bot をローカルで動かして検証モードを使ってください。

## 起動

```sh
cp bots.example.yaml bots.local.yaml   # bot を登録する（git 管理外）
docker compose up
```

- 画面: http://localhost:5173
- スマホからは、同じ Wi-Fi で `http://<Mac の IP または名前>.local:5173` を開く
- モック LINE API: http://localhost:8787（コンテナ内の bot からは `http://host.docker.internal:8787`）

docker を使わない場合は `npm install && npm run dev` で起動できます。ソースを変更すると、サーバーも画面もその場で反映されます。

## bot を検証モードにつなぐ

bot がモックを呼ぶように、LINE API のベース URL を変えられるようにします。公式 SDK はどれも設定で変えられます。

- Node（`@line/bot-sdk`）: `new messagingApi.MessagingApiClient({ channelAccessToken, baseURL })`。画像の取得は `MessagingApiBlobClient` にも同じ `baseURL` を渡します
- Python（`line-bot-sdk` v3）: `Configuration(access_token=..., host="http://host.docker.internal:8787")`

あわせて、bot 側を次のように設定します。
- チャネルアクセストークン: `bots.local.yaml` の `mockAccessToken` と同じ値にする。モックはこのトークンで、どの bot からの呼び出しかを見分けます
- チャネルシークレット: `bots.local.yaml` の `channelSecret` と同じ値にする

## 画面の使い方

1. 上のメニューで bot とトークを選ぶ。「…」から新しいグループ・トークルーム・1:1 トークを作れます
2. 下に並ぶユーザーのうち、操作したい人をタップする。選択中の人をもう一度タップすると名前を変えられ、「＋」でユーザーを追加できます
3. テキストや画像を送る。bot の返信に付いた Quick Reply やボタンを押すと、選択中のユーザーが押したことになります
4. 「…」メニューから、`join`（bot をグループに追加）、`memberJoined`、`follow` のイベントも送れます

モックで対応している LINE API は次のとおりです。

| API | 内容 |
|---|---|
| 返信 | `POST /v2/bot/message/reply` |
| 送信 | `POST /v2/bot/message/push`、`POST /v2/bot/message/multicast` |
| プロフィール | `GET /v2/bot/profile/{userId}`、`GET /v2/bot/group/{groupId}/member/{userId}`、`GET /v2/bot/room/{roomId}/member/{userId}` |
| 画像の取得 | `GET /v2/bot/message/{messageId}/content` |

ローディング表示（`POST /v2/bot/chat/loading/start`）は、受け付けるだけで何も起こりません。ほかの API は 200 と空の応答を返し、画面に「未対応の LINE API」と表示します。

## テストデータについて

playground が作る ID には、すべて `playground` が入ります（ユーザーは `Uplayground…`、グループは `Cplayground…`）。bot が本番のデータベースに書き込んだ場合でも、テストのデータを見つけて消しやすくしてあります。

playground の状態はメモリにだけ置きます。サーバーを再起動するか「すべてリセット」を押すと、最初からになります。

## シークレットの扱い

- `bots.local.yaml` は `.gitignore` に入っています。コミットしないでください
- ファイルに直接書きたくない場合は、`channelSecretEnv` に環境変数の名前を書けます
- チャネルシークレットは画面には送りません
- このツールはローカル専用です。8787 番と 5173 番のポートをインターネットに公開しないでください

## 開発

```sh
npm test          # vitest
npm run typecheck
```
