# sokking

Ubuntu に常駐し、外から届く「やること」をタスクボックスに集めて Claude Code に処理させるためのアプリ。
設計の全体像は [plan.md](plan.md) を参照。

UI と端末まわりは [petaterm](https://github.com/denzow/petaterm) のソースを土台にしている。
左に縦タブ、各タブが独立した pty を持ち、Claude Code の権限待ちや完了をバッジと通知で知らせる。

## 必要環境

- Ubuntu (Linux)。cwd 追跡に `/proc` を使うため Linux 専用。
- Node.js 22 以上。

## セットアップ

```bash
npm install
npm run dev
```

`Error: Electron uninstall` が出た場合は Electron バイナリが未取得なので `node node_modules/electron/install.js` を実行する。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発モードで起動(HMR あり) |
| `npm run build` | `out/` へプロダクションビルド |
| `npm run typecheck` | 型チェック |
| `npm test` | コアのテスト(vitest) |
| `npm run package` | AppImage をビルド |
| `npm run install-desktop` | デスクトップエントリとアイコンをインストール |
| `npm run install-autostart` | ログイン時の自動起動を設定 |

## CLI

起動中のアプリに対して `bin/sokking.js` からタスクを積める。

```bash
bin/sokking.js add "ログイン画面の崩れを直す" --workdir ~/work/app --body -  < memo.txt
bin/sokking.js list --status inbox
bin/sokking.js ping --dev   # npm run dev のインスタンスに接続する
```

接続先はアプリの設定ディレクトリ(`~/.config/sokking/control.sock`、開発時は `sokking-dev`)の Unix ソケット。
`SOKKING_CONTROL_SOCKET` で上書きできる。

## データ

SQLite(`node:sqlite`)で `~/.config/sokking/sokking.db` に保存する。開発モードは `~/.config/sokking-dev/`。

## ライセンス

MIT
