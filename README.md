# Sokki MD Editor

速記（Shorthand）に特化した、シンプルで高速なMarkdownエディターです。
Tauri v2 によるネイティブデスクトップアプリとして動作し、ローカルファイルの編集・保存に対応しています。

## 特徴的な機能（速記ショートカット）

入力の手間を最小限に抑えるための独自機能が搭載されています。

- **見出しの瞬時作成**: `#1`〜`#6`（全角 `＃１`〜`＃６` も可）と入力して `Space` または `Tab` を押すと、即座に `#` 見出しに変換されます。
- **テーブル生成**: `t2`〜`t9` と入力して `Space` または `Tab` を押すと、指定した列数のテーブル雛形が作成されます。
- **スマートな改行操作**:
    - `Enter`: 自動で新しい段落（ブロック）を作成します。
    - `Shift + Enter`: 段落内で改行（`<br>`）を挿入します。
    - リストやテーブル内で `Enter` を押すと、自動的に次の行を継続します。
- **テーブル列の追加**: テーブル内で `Ctrl + .` を押すと、その位置に新しい列をテーブル全体に追加します。
- **テキスト装飾**: `Ctrl + B` (太字), `Ctrl + I` (斜体), `Ctrl + U` (下線) に対応。
- **ファイル操作**: `Ctrl + O` (開く), `Ctrl + S` (保存), `Ctrl + Shift + S` (名前を付けて保存)
- **スクロール同期**: エディターとプレビューのスクロール位置がリアルタイムで同期します。
- **自動保存**: 編集中の内容は自動的にスナップショットとして保存され、アプリが強制終了しても復元可能です。

## セットアップと起動方法

### 前提条件
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)
- Visual Studio 2022 の「C++ によるデスクトップ開発」ワークロード (Windows)

### 開発モード
```bash
pnpm install
cd frontend && pnpm install && cd ..
pnpm tauri dev
```

### プロダクションビルド
```bash
pnpm tauri build
```

## 技術スタック
- **Frontend**: Vite, Vanilla JavaScript, CSS3, Marked.js
- **Desktop**: Tauri v2 (Rust)
- **Plugins**: @tauri-apps/plugin-dialog, @tauri-apps/plugin-fs, @tauri-apps/plugin-store

## ライセンス
MIT License
