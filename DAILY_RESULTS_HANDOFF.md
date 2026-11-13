# S級全選手成績一覧

一覧の原稿は `site/daily-results/`、公開先は
`/keirin-lineup2/daily-results/index.html?date=YYYYMMDD`。
日付省略時はAsia/Tokyoの当日を選び、`calendar/dates.json.days` にない日は未公開とする。
トップが翌日へ進んでも当日の代用には使わない。

`scripts/daily_results.py` は保存済みカード・日別資料だけを読み、
`public/data/YYYYMMDD/all-rider-results.json` を生成する。
全出走を先に保持し、出走URL・車番・氏名・期別・JKA番号で照合する。
今場所成績以外は前回資料と不変選手ファイルへの参照を使う。
前回・10場所はチェックサムと本人を確認し、不一致は該当選手・資料だけ保留にする。
コレクター、ensure_daily、共通台帳の更新、追加スケジューラは呼ばない。
原稿・保存済みカード・過去ページ・独立index2を変更しない。

ブラウザでは全出走の基本行を先に出し、前回資料と最大4人並列の選手別読込を進める。
参照パスは公開基底から解決し、SHA-256を検証する。
再読込失敗は確認済み表示を保持する。過去10場所は古い開催から新しい開催へ表示し、
未知SHB・上がり・レースIDを推測しない。5走以上、事故、欠場、未取得も保持する。
確認済みの楽天digest座標だけ、既存仕様と同じ公式MP4への通常リンクに変換する。

JSONと2種類のCSVは日付全員分をブラウザのメモリから生成する。
検索中も全員を出力し、カテゴリの重複は保つ。CSVはUTF-8 BOM付きで引用・改行を処理する。
SHBは1/0/空欄、調子0は出力では残す。表計算への取込時はID・タイム列を文字列にする。
成績ソースの観測時刻・証拠を保持し、生成時刻と区別する。

共有調子は既存 `comments-passphrase.js` の公開クライアント初期化だけを生成時に再利用する。
元の共有ファイル、認証、権限を変更しない。新一覧はSELECTのみ。
既存ブラウザセッションを共有し、最新有効値をcreated_at DESC/id DESCで読む。
約30秒ごとに確認し、最新0は空欄表示、失敗時は確認済み値を維持する。
DB、コメント、認証情報の複製はない。

検証:

```sh
python3 -m unittest discover -s tests -q
python3 scripts/export_pages.py
node tests/test_daily_results.cjs public 20261114
NODE_PATH=/tmp/lineup2-browser/node_modules node tests/test_daily_results_browser.cjs public
```

ブラウザテストは `playwright` とChromiumを使う。`CHROMIUM_PATH` で実行ファイルを指定できる。
既存の出走表DOM・前回・成績テストも継続する。
`verify_pages.py` は一覧のHTML/JS/CSS、薄い全日索引、当日参照先も匿名HTTPの照合対象に含める。
公開完了はActionsのデプロイ・HTTP照合・publication receipt後に判断する。

23:30 JSTのカード追加確認は添付仕様書で別項目とされているため、今回の一覧実装では既存heartbeatを変更していない。
