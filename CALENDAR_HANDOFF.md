# カレンダー担当チャットへの引き継ぎ

ユーザーには「猫ちゃん」と呼びかけ、担当の呼び名は「愛ボdex」、猫語で回答するにゃ。

対象は **itaingtr/keirin-lineup2**。最新の main と `AGENTS.md` を確認してから作業するにゃ。
カレンダー本体の画面は次のチャットで作る。この引き継ぎでは、日別リンク一覧と公開経路を用意している。

## 1. 作る場所と公開URL

| 用途 | 場所 |
|---|---|
| リポジトリ | https://github.com/itaingtr/keirin-lineup2 |
| 保守用作業フォルダ | `/workspace/keirin-lineup2/github-pages` |
| カレンダーの編集元 | **`site/calendar/index.html`** |
| カレンダー用JS・CSS・画像 | `site/calendar/` 内。相対パスで参照する |
| カレンダーの生成先 | `public/calendar/index.html` |
| カレンダー公開先 | **https://itaingtr.github.io/keirin-lineup2/calendar/index.html** |
| 自動生成の日別リンク一覧 | **https://itaingtr.github.io/keirin-lineup2/calendar/dates.json** |

出走表の「更新」「トップ」の横には、指定のカレンダーへ移動する「日程」ボタンを設置済み。
`scripts/export_pages.py` が `site/calendar/` の静的ファイルを `public/calendar/` へコピーする。
`public/` はGit管理対象外の生成物なので、**`public/` だけを編集・保存しても次のActions実行には引き継がれない**。
カレンダーの原稿を `site/calendar/` に保存し、mainへ反映する。

`calendar/dates.json` は自動生成用の予約名。手書きの一覧は保存しない。
カレンダー本体が未作成の間は `dates.json` だけを公開する。仮の `index.html` は作っていない。

## 2. 毎日のページはどこに保存されるか

例：2026年11月4日の場合。

| 種類 | 保存先・公開先 |
|---|---|
| 最新トップの編集元 | main：`site/index.html` |
| 日別ページの編集元 | main：`site/line20261104.html/index.html` |
| 日別の表示用JSON | main：`site/line20261104.html/*.json` |
| 公開用トップ | Actions生成物：`public/index.html` |
| 公開用の日別ページ | Actions生成物：`public/line20261104.html` |
| 公開用の日別JSON | Actions生成物：`public/data/20261104/*.json` |
| 日別ページの公開URL | https://itaingtr.github.io/keirin-lineup2/line20261104.html |

日別ページは公開時には **フラットな `lineYYYYMMDD.html`** になる。公開URLに `/index.html` や末尾の `/` を付けない。
トップは最新の掲載日へ更新されるが、日別URLはその日のまま残る。カレンダーの日付リンクにはトップ `/` ではなく日別URLを使う。
トップと最新掲載日の日別ページは、同じHTMLで公開される。

日別JSONの主な内容：

- `media.json`：表示用の車番・選手名・印など。
- `rakuten-marks.json`：楽天の掲載印と照合情報。
- `rider-identities.json`：車番・名前・期別と選手登録番号の照合情報。
- `rider-details.json`：楽天で確認した県名・年齢。
- `odds-config.json`：その日の保存オッズフィードの接続先。
- `odds.json`：カード作成時の表示用フィード。**15分ごとの最新オッズそのものとは限らない**。

出走表の全選手・並び・今場所成績は、生成HTML内の `const races` に入っている。
公開先に `races.json` があると仮定しない。カレンダーはHTMLを解析せず、次の `dates.json` を使えばよい。

## 3. 日別リンク一覧 `dates.json` の使い方

`scripts/calendar_export.py` が、実際に生成した日別HTMLから次の形式の一覧を作る。
以下は形式の説明用の例。画面では取得したJSONの値をそのまま使う。

```json
{
  "schema_version": 1,
  "site_base": "/keirin-lineup2/",
  "current_date": "2026-11-04",
  "current_href": "/keirin-lineup2/line20261104.html",
  "days": [
    {
      "date": "2026-11-04",
      "label": "11月4日",
      "href": "/keirin-lineup2/line20261104.html",
      "race_count": 19,
      "venues": [
        {
          "name": "大宮",
          "code": "25",
          "first_race": 6,
          "race_count": 7,
          "href": "/keirin-lineup2/line20261104.html#race-25-6"
        }
      ]
    }
  ]
}
```

- `days` は公開済みの日付だけ。日付昇順。
- `days[].href` でその日の出走表へ直接移動できる。
- `venues[].href` で、その日に掲載された競輪場の最初のレースへ直接移動できる。**1R固定ではない**。レース位置IDがない初期の過去ページでは、その日の日別ページ先頭へ移動する。提供された `href` をそのまま使い、古いページに存在しない `#race-...` を作らない。
- `venues` は出走表の掲載順を維持する。
- `race_count` は、このサイトで掲載したS級戦の数。
- `current_date` は **トップの最新掲載日**。21時以降は翌日になる場合がある。「今日」の強調は、別に `Asia/Tokyo` の日付で判定する。
- 一覧にない日は「未掲載」。A級だけの開催・並び未発表・取得失敗などもあり得るため、**開催なし／休催と断定しない**。
- 日付選択欄の候補から一覧を作らない。未公開の翌日候補を拾う可能性がある。
- 未掲載の日へのURLを計算だけで作って押せる状態にしない。存在する `href` を使う。

カレンダーからの読み取り例：

```js
const response = await fetch('./dates.json', {cache: 'no-store'});
if (!response.ok) throw new Error('日程一覧を読み込めませんでした');
const calendarData = await response.json();

// 例：その日の出走表へ。同じタブで移動する。
const link = document.createElement('a');
link.textContent = calendarData.days[0].label;
link.href = calendarData.days[0].href;
```

競輪ページには日別データ用の `<base>` がある。カレンダーへそのタグをコピーしない。
提供された `/keirin-lineup2/line...html#race-...` という完全なプロジェクト内パスを使えば、相対パスのずれを避けられる。

## 4. 毎日の取得・保存・公開の流れ

現行の入口は **`.github/workflows/update.yml` → `scripts/official_publication.py`**。
古い `update_publication.main`、`prepare_next_card.main` などを新たにスケジュールしない。

1. 日本時間 **21:00・23:30** に、翌日の掲載対象S級出走表を取得する。
2. 楽天KドリームスとKEIRIN.JPを照合し、車番・名前・期別・選手ID・並び・成績などを検証する。
3. 表示用カードを `odds-diagnostics` ブランチの新しい実行別ファイルへ保存する。
4. 新規カードはmainの `site/index.html` と `site/lineYYYYMMDD.html/` に反映する。
5. `scripts/export_pages.py` が日別HTML・日別JSON・カレンダー用ファイル・`dates.json` を `public/` に生成する。
6. 同じActions実行がPagesへデプロイし、ログインなしのHTTPアクセスと生成ファイルの一致を確認する。

失敗時は公開中のページを保ち、空のページや推測値へ置き換えない。GitHub Actionsの開始は遅延する場合がある。
21:00の処理が成功した時点で翌日分が一覧へ増え、23:30の成功時に同じ日が更新される。
日付が変わっても、過去の日別HTMLは残る。

当日のオッズは日本時間 **08:00〜20:30の15分間隔**で取得する設定。
オッズだけの更新では通常Pagesを再公開しない。保存フィードだけを進めるため、カレンダー一覧を15分ごとに作り直す必要はない。
カレンダーのファイル変更をmainへpushしたときも、同じworkflowで生成・公開される。

## 5. 実行別履歴の保存先

次はすべて **同じリポジトリの `odds-diagnostics` ブランチ**内。
`RUNID` はGitHub Actionsの実行番号、`ATTEMPT` は再実行回数。

| 内容 | 実行別の追記先 | 最新値・索引 |
|---|---|---|
| 出走表の表示用カード | `fallback/cards/YYYYMMDD/runs/run-RUNID-ATTEMPT.json` | `fallback/cards/YYYYMMDD/latest.json`、`fallback/cards/current.json` |
| 楽天二車単 | `fallback/kdreams/exacta/YYYYMMDD/runs/run-RUNID-ATTEMPT.json` | 同じ日付フォルダの `latest.json` |
| 楽天印 | `fallback/marks/YYYYMMDD/runs/run-RUNID-ATTEMPT.json` | 同じ日付フォルダの `latest.json` |
| 県名・年齢 | `fallback/details/YYYYMMDD/runs/run-RUNID-ATTEMPT.json` | 同じ日付フォルダの `latest.json` |

出走表の `latest.json` と `current.json` は保存カードへのパス・SHA256を持つ検証用ポインター。
保存カードには生成HTML・表示用assets・取得元URL・観測時刻などが入る。取得元サイトの原本HTMLは保存しない。
オッズ等の `latest.json` は表示用のフィード本体。観測時刻を現在時刻へ付け替えない。
実行別の履歴は上書き・削除せず、最新表示の索引だけを進める。
選手IDはカードassetsと日別 `rider-identities.json` にあり、独立した `fallback/identities` 保存先はない。

現在の新規取得は楽天＋KEIRIN.JP。旧ウィンチケット保存データは過去の履歴として残っているが、新規取得の代替には使わない。
カレンダー作成のために保存ブランチを書き換えたり、DB保存・認証・新しい取得スケジュールを追加したりする必要はない。

## 6. 次の担当が行うこと

1. 最新main、`AGENTS.md`、このファイルを読む。
2. `site/calendar/index.html` と必要なJS・CSSを作る。カレンダーCSSは独立させる。
3. `./dates.json` を読み、公開済み日付・開催場の `href` をそのままリンクへ使う。
4. `python3 scripts/export_pages.py` で `public/calendar/index.html` と一覧が生成されることを確認する。
5. Pythonテストと既存の出走表の表示テストを通し、mainへ反映する。
6. Actions完了後、カレンダー・日付リンク・トップの「日程」ボタンを公開先で確認する。

```sh
python3 -m unittest discover -s tests -q
python3 scripts/export_pages.py
```

出走表の見た目、22pxの選手幅、ライン間隔、赤い調子、映像・結果・ライブ、共有コメント、保存済みデータを変更しない。
日別ページを新しく作ったり過去のページを書き換えたりせず、カレンダーから既存の公開ページへリンクする。
元の別リポジトリ `itaingtr/keirin-lineup` は作業対象ではない。

このチャットから次のチャットへ渡す依頼文：

> itaingtr/keirin-lineup2 の最新mainを確認し、AGENTS.md と CALENDAR_HANDOFF.md を読んで、site/calendar/index.html に日程カレンダーを作ってください。公開済み日付・開催場へのリンクは https://itaingtr.github.io/keirin-lineup2/calendar/dates.json を使ってください。既存の出走表・コメント・調子・過去ページ・保存データは維持し、公開確認まで進めてください。
