# 学習トラッカー

小学校の教員が、宿題・プリント・作品などの提出状況を管理するためのブラウザアプリです。

## 特徴

- 毎日型と締め切り型を分けて管理
- 毎日型は、対象日の記録がなくても未提出として集計
- 締め切り型は、児童1人につき1件の継続記録
- 未提出 → 提出済み → 欠席・免除 → 未提出のタップ操作
- 締め切り後の提出は自動で「遅れて提出」
- ダッシュボード、個人履歴、JSONバックアップ、CSV出力
- localStorageだけで動作し、外部サーバー・CDN・ライブラリは不使用

## GitHub Pagesで公開する

1. このフォルダー内のファイルを、GitHubリポジトリへアップロードします。
2. GitHubのリポジトリで `Settings` → `Pages` を開きます。
3. `Deploy from a branch` を選び、公開するブランチと `/ (root)` を指定します。
4. 表示されたURLを開きます。

`index.html` がある階層を公開対象のルートにしてください。

## データの保存

記録はブラウザのlocalStorageに保存されます。同じURLでも、別の端末・別のブラウザには自動同期されません。

端末変更やブラウザデータ削除に備えて、設定画面の「JSONバックアップ」を定期的に実行してください。

## 自動テスト

ブラウザの開発者ツールのコンソールで、次を実行できます。

```javascript
runTrackerTests()
```

Node.jsがある場合は、フォルダー内で次を実行できます。

```bash
node run-tests.cjs
```

テストは専用データだけを使用し、本番のlocalStorageを変更しません。

## ファイル構成

```text
learning-tracker/
├─ index.html
├─ styles.css
├─ core.js
├─ app.js
├─ run-tests.cjs
├─ README.md
└─ package.json
```

## 対応環境

現在のChrome、Edge、Safariを推奨します。パソコンとタブレットの横画面・縦画面に対応しています。

## 公開ページ

[GitHub Pagesで開く](https://tt-sensei.github.io/checker/)
