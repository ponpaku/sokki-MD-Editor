# Sokki MD Editor

Tauri v2 ネイティブ Markdown エディタ。Flask+SocketIO から移行済み。

## プロジェクト構造

```
frontend/           # Vite + vanilla JS フロントエンド
  src/
    main.js         # エディタ本体（ショートカット、プレビュー、スクロール同期）
    file-ops.js     # 開く/保存/名前を付けて保存（Tauri dialog+fs）
    autosave.js     # デバウンス付き自動保存 + 起動時復元
    export.js       # Word (.docx) / プレーンテキスト (.txt) エクスポート
    preview-style.js # プレビューペインのスタイルカスタマイズ
    i18n.js         # 多言語対応（en/ja）
    style.css       # 全スタイル（light/darkテーマ含む）
  index.html        # エントリHTML
src-tauri/          # Tauri Rust バックエンド
  src/lib.rs        # アプリ初期化（dialog, fs, store プラグイン）
  capabilities/default.json  # パーミッション設定
  tauri.conf.json   # Tauri設定
```

## 開発コマンド

```bash
# 開発サーバー起動（Vite + Tauri）
pnpm tauri dev

# フロントエンドのみビルド確認
cd frontend && pnpm build

# 本番ビルド（NSIS/MSIインストーラ生成）
pnpm tauri build
```

## Windows 環境の注意点

- bash から pnpm を呼ぶ場合は `cmd.exe /c "pnpm ..."` を使う
- Tauri ビルドには VS 2022 の「Desktop development with C++」ワークロードが必要
- Rust 1.93.0 以上

## コーディング規約

- フロントエンドは ESM（`type: "module"`）、vanilla JS（フレームワークなし）
- UI テキストは `i18n.js` の `t()` 経由。ハードコードしない
- `data-i18n` / `data-i18n-title` / `data-i18n-placeholder` 属性で自動翻訳適用
- CSS 変数でテーマ切替（`[data-theme="light"]` / `[data-theme="dark"]`）
- ファイル保存には Tauri plugin-fs を使用。ブラウザ API は使わない
- バイナリ書き込みは `writeFile`（Uint8Array）、テキストは `writeTextFile`

## Tauri パーミッション

新しい Tauri API を使う場合は `src-tauri/capabilities/default.json` に権限を追加すること。
`fs:scope` の `allow` パターンも必要に応じて更新する。

## コミットメッセージ

Conventional Commits 形式: `feat(scope):`, `fix(scope):`, `chore(scope):` など。
