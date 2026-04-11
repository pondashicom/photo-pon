# PHOTO-PON

PHOTO-PON は、人物写真をまとめて読み込み、顔位置や見た目サイズを揃えながら、トリミング・リサイズ・圧縮して書き出すための Windows 向け Electron デスクトップアプリです。

イベント登壇者写真、スタッフ写真、プロフィール写真などを、一定ルールでまとめて整える用途を想定しています。

---

## 主な機能

- 画像のドラッグアンドドロップ登録
- 画像リスト表示
- 元画像プレビュー
- 加工後プレビュー
- Zoom / X / Y による手動位置調整
- 再処理ボタンによる再生成
- 初回起動時の設定モーダル
- 処理設定の永続保存
- 一括自動処理
- Export による一括書き出し
- 例外画像の表示
- 人物透過 PNG 出力モード
- 加工後プレビューでの透過確認用チェッカー表示

---

## 出力モード

### 通常モード

通常のトリミング・リサイズ・圧縮を行い、指定形式で書き出します。

### 人物透過PNGモード

背景を除去し、人物のみを透過 PNG として書き出します。

- 書き出しファイルは背景透過 PNG
- 加工後プレビューでは透過確認用のチェッカー背景を表示
- 背景除去に失敗した画像は例外扱いになります

---

## 画面構成

- **左ペイン**
  - ドロップエリア
  - 進捗表示
  - 画像リスト

- **右上**
  - 元画像プレビュー
  - 検出領域表示

- **右下**
  - 加工後プレビュー
  - Zoom / X / Y 調整
  - Reset
  - 再処理
  - 出力情報表示

---

## 基本的な使い方

1. アプリを起動する
2. 初回起動時に処理設定を保存する
3. 画像をドラッグアンドドロップ、または「画像を追加」で登録する
4. 自動処理結果を確認する
5. 必要に応じて Zoom / X / Y を調整する
6. 必要に応じて「再処理」を実行する
7. 「Export」で一括書き出しする

---

## 処理設定

設定画面では以下を指定できます。

- 出力幅
- 出力高さ
- 出力形式
- 出力モード
- 最大容量（KB）
- 顔サイズ比率
- 顔未検出時の扱い
- 複数人検出時の扱い
- 出力フォルダ名

設定は保存され、次回起動時にも自動適用されます。

---

### 背景透過について

人物透過 PNG モードは動作しますが、画像によっては背景除去結果に差が出ることがあります。  
細い髪、半透明部分、背景との境界が近い画像では、手修正が必要になる場合があります。

---

## 動作環境

- Windows
- Node.js / npm
- Electron

---

## セットアップ

```bash
cd C:\photo-pon
npm install
npm start
```

---

## ビルド

### 開発起動

```bash
npm start
```

### パッケージ作成

```bash
npm run pack
```

### Windows インストーラー作成

```bash
npm run dist
```

ローカルでビルドした成果物は通常 `dist` フォルダに出力されます。

GitHub Actions で自動ビルドされた最新版の Windows インストーラーは、以下から取得できます。

- [Build Windows Installer](https://github.com/pondashicom/photo-pon/actions/workflows/build-installer.yml)

---

## 推奨配置

このフォルダ一式をそのまま `C:\photo-pon` に配置して使用してください。

---

## 主なファイル構成

- `src/main.js`
- `src/preload.js`
- `src/index.html`
- `src/renderer.js`
- `src/styles.css`
- `src/default-settings.js`
- `src/background-removal-worker.js`

---

## 今後の予定

- 顔検出精度の改善
- 背景透過処理の安定化
- 例外画像の扱い改善
- UI の磨き込み
- Windows 配布向けの仕上げ

---

## ライセンス

Photo-PON 本体は **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** の下で公開します。

本リポジトリには、以下の主なサードパーティライブラリを利用しています。

- `@imgly/background-removal-node` - AGPL-3.0
- `@vladmandic/human` - MIT
- `electron-store` - MIT
- `sharp` - Apache-2.0
- `electron` - MIT
- `electron-builder` - MIT

背景透過機能には `@imgly/background-removal-node` を使用しています。
そのため、配布・改変・再頒布にあたっては、各ライセンス条件を確認してください。

サードパーティライセンス一覧および notices は `THIRD_PARTY_LICENSES.md` を参照してください。
