# 保育園 休園チェッカー（日高乳児園）

気象警報などから保育園の休園可能性をチェックする Web アプリ。

## 構成・技術
- `index.html`：アプリ本体（静的）
- `functions/warning.js` `functions/history.js`：Cloudflare Pages Functions。**気象庁の公開XMLフィード**（`data.jma.go.jp`）を取得（APIキー不要）
- ホスティング：Cloudflare Pages（**hoiku-kyuen-checker.pages.dev**）

## デプロイ
- `main` に push → GitHub Actions が `<リポジトリ名>.pages.dev` へ自動デプロイ（`.github/workflows/deploy.yml`、プロジェクト名＝リポジトリ名＝`hoiku-kyuen-checker`）。
- リポジトリは **public**（`uniboo-apps` 組織の `CLOUDFLARE_API_TOKEN` 組織シークレットを使用）。

## ルール
- **public なので秘密（APIキー等）をコードに置かない**。使っているのは全て公開API（気象庁）でキー不要。
- 変更は `index.html` / `functions/*.js` を編集 → push で自動公開。
