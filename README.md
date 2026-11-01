# line-bot-playground

LINE アカウントが 1 つしかなくても、グループで使う LINE bot の「複数人の流れ」を、**実際の LINE アプリで**確かめるためのツールです。参加表明、手番の交代、別の人の回答などを試せます。

グループに入れる bot は 1 つだけなので、別の bot を足して代わりに話させることはできません。そこで、確かめたい bot のサーバーに「代理送信プラグイン」を組み込みます。このリポジトリのコントローラー（Web 画面）からそのプラグインに指示を出し、架空のユーザーとして bot を操作します。

```
[コントローラー（ローカル Web、このリポジトリ）]
        │ 送信指示（トークン認証）
        ▼
[bot のサーバー ＋ 代理送信プラグイン]
        │ 架空のユーザーのイベントを作り、bot の普段の処理に渡す
        │ その人への返信を捕まえ、「🧪Bさん: 参加する」と一緒にグループへ push
        ▼
[あなたの LINE アプリ（テスト用グループ）] ← ここで動作を確かめる
```

- bot からは、架空のユーザーが本当にグループで操作したのと同じに見えます。プロフィールを取得すると、架空のユーザーの名前が返ります
- 架空のユーザーの操作と、その人への bot の返信は、push でグループに表示されます。LINE アプリだけで流れを追えます
- 「参加する」のように、あなた宛ての返信に付いたボタンも、コントローラーから架空のユーザーとして押せます

プラグインの仕様（エンドポイント、送ったときの動き、push の数え方）は [docs/protocol.md](docs/protocol.md) にまとめています。

## 費用について

push は、LINE の月ごとの無料メッセージ数を、グループの人数分消費します。返信は消費しません。無料プランは月 200 通までです。

自分と bot だけのテスト用グループで使えば、架空のユーザーの操作 1 回につき 1 通で済みます。

## 準備

1. 確かめたい bot に、プラグインを組み込んで有効にする（[docs/protocol.md](docs/protocol.md)）
2. 自分と bot だけのテスト用グループを LINE で作る
3. そのグループの ID を、bot の `PLAYGROUND_ALLOWED_GROUPS` に入れる。ID は、グループで何か送ったあと、コントローラーのグループ一覧で確かめられる
4. コントローラーに bot を登録する

```sh
cp bots.example.yaml bots.local.yaml   # bot の URL とトークンを書く（git 管理外）
docker compose up
```

- 画面: http://localhost:5173
- スマホからは、同じ Wi-Fi で `http://<Mac の名前>.local:5173` を開く

トークンをファイルに直接書きたくない場合は、`tokenEnv` に環境変数の名前を書き、値を `.env`（git 管理外）に置きます。docker を使わない場合は、`npm install && npm run dev` で起動できます。どちらの方法でも、ソースを変えるとその場で反映されます。

## Cloud Run に置く場合（外出先のスマホから使う）

作者の環境では、GCP プロジェクト `line-bot-playground-fez` の Cloud Run（asia-northeast1）で動かしています。

- **認証**: Cloud Run の IAP（Google ログイン）を使います。許可した Google アカウントだけが画面を開けます。アプリに認証のコードはありません
- **設定**: `bots.local.yaml` と同じ形の YAML を Secret Manager の `bots-config` に置き、`/secrets/bots.yaml` としてマウントします。トークンは YAML に直接書きます
- **デプロイ**: main へ push すると、Cloud Build のトリガーが `cloudbuild.yaml` でビルドしてデプロイします。トリガーは 1 つだけです

設定を変えるときは、新しい版を追加してから、新しいリビジョンを作ります（マウントしたシークレットは `latest` を参照しているため）。

```sh
gcloud secrets versions add bots-config --project=line-bot-playground-fez --data-file=bots.yaml
gcloud run services update line-bot-playground --project=line-bot-playground-fez \
  --region=asia-northeast1 --update-env-vars=CONFIG_UPDATED_AT=$(date +%s)
```

アクセスできる人を追加するとき:

```sh
gcloud iap web add-iam-policy-binding --project=line-bot-playground-fez \
  --member=user:someone@example.com --role=roles/iap.httpsResourceAccessor \
  --region=asia-northeast1 --resource-type=cloud-run --service=line-bot-playground
```

## 使い方

1. 上で bot とテスト用グループを選ぶ
2. 下の「＋」で架空のユーザーを作る。使うユーザーをタップで選ぶ。選択中のユーザーをもう一度タップすると、名前を変えられる
3. テキストや画像を送るか、記録に出ている bot のボタンを押す。選択中の架空のユーザーが操作したことになる
4. 結果は LINE アプリで確かめる。自分の番は、いつもどおり LINE アプリで操作する

画面の記録は 3 秒ごとに更新されます。表示はボタンを押すための簡素なもので、LINE の見た目は再現しません。

## 対応している bot

- [qk-jenga-line-bot](https://github.com/fezzlk/qk-jenga-line-bot)（Node / TypeScript）

## シークレットの扱い

- `bots.local.yaml` と `.env` は `.gitignore` に入っています。コミットしないでください
- トークンはコントローラーのサーバーだけが持ち、画面には送りません
- ローカルで動かすときは、5173 番と 8787 番のポートをインターネットに公開しないでください。外から使うときは、上の Cloud Run の構成のように認証を付けてください
- プラグインを有効にした bot では、トークンを持つ人が許可したグループで代理発言できます。`PLAYGROUND_ALLOWED_GROUPS` には、本物の参加者がいないテスト用グループだけを入れてください

## 開発

```sh
npm test          # vitest
npm run typecheck
```
