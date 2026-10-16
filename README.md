# sokking

Ubuntu に常駐し、外から届く「やること」をタスクボックスに集めて Claude Code に処理させるためのアプリ。
設計の全体像は [plan.md](plan.md) を参照。

UI と端末まわりは [petaterm](https://github.com/denzow/petaterm) のソースを土台にしている。
左に縦タブ、各タブが独立した pty を持ち、Claude Code の権限待ちや完了をバッジと通知で知らせる。

## できること

- **タスクボックス**：手動、CLI、デスクトップ通知、GitHub の Issue から来たタスクを一箇所に積む。受信箱、処理中、確認待ち、完了、アーカイブで仕分ける。
- **処理タブ**：タスクから起動ダイアログを開き、作業ディレクトリ、権限モード、成果の形(PR か直接 push)、初期プロンプトを決めて Claude Code をタブの中で起動する。hooks でセッション ID と PR の URL を拾い、応答が完了したタスクは確認待ちになる。
- **通知の取り込み**：デスクトップ通知(Slack、メールなど)を D-Bus で監視し、フィルタルールに合致したものをタスクにする。受信ログからルールを下書きできる。
- **GitHub ルール**：リポジトリと検索条件を登録すると、合致する open な Issue を定期的に取り込む。自動処理を有効にすると、Issue ごとの worktree を切って並列上限の範囲で Claude Code を起動する。

## 必要環境

- Ubuntu (Linux)。cwd 追跡に `/proc`、通知の監視に `busctl`(systemd)を使う。
- Node.js 22 以上。
- `claude`(Claude Code CLI)と `gh`(GitHub CLI、ログイン済み)。

## セットアップ

```bash
npm install
npm run dev
```

`Error: Electron uninstall` が出た場合は Electron バイナリが未取得なので `node node_modules/electron/install.js` を実行する。

初回起動時に Claude Code 連携(hooks)のセットアップを尋ねる。承諾すると `~/.claude/settings.json` に hooks が追記され、タブ内の Claude Code の状態が sokking に届くようになる。

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

## 自動処理と Claude Code の信頼設定

GitHub ルールの自動処理は、Issue ごとに `<リポジトリ>-sokking/issue-<番号>` の worktree を切り、そこで Claude Code を起動する。
Claude Code は初めてのディレクトリで「フォルダを信頼するか」を尋ねるが、自動処理では答える人がいないので、起動前に `~/.claude.json` の該当ディレクトリを信頼済みにしてから起動する。
手動で開いた処理タブではこの書き換えをしない。

## データ

SQLite(`node:sqlite`)で `~/.config/sokking/sokking.db` に保存する。開発モードは `~/.config/sokking-dev/`。
初期プロンプトは同じディレクトリの `prompts/` に run ごとのファイルとして置く。

## 開発時の確認

`scripts/` に、開発モードのアプリを端末から操作するための補助スクリプトがある。

| スクリプト | 内容 |
|---|---|
| `scripts/ui-probe.js` | `--remote-debugging-port=9222` で起動したアプリをクリック、入力、スクリーンショット |
| `scripts/hook-emit.js` | Claude Code の hook イベントを擬似送信する |
| `scripts/db-dump.js` | DB のテーブルを JSON で表示する |

```bash
npx electron-vite dev -- --no-sandbox --remote-debugging-port=9222
scripts/ui-probe.js shot /tmp/shot.png
scripts/hook-emit.js <tabId> Stop --message "done" --dev
```

## ライセンス

MIT
