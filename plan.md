# sokking 開発計画

## 目的

Ubuntu 上に常駐し、外から届く「やること」を一箇所に集め、Claude Code に処理させるまでを一つの画面で回せるツールを作る。
Slack の通知や GitHub の Issue は届く場所がばらばらで、見落としや着手の先送りが起きやすい。
sokking はそれらをタスクボックスに積み、人間が仕分け、Claude Code を呼び出して処理し、処理中の様子をタブで見守れるようにする。

対象は次の四つである。

- 受信：Slack などの通知を受け取り、タスクボックスに積む。
- 仕分けと処理：タスクボックスからタスクを選び、GitHub Issue 登録や Claude Code による処理に回す。
- 自動取り出し：GitHub の検索条件に合う Issue を定期的に取り出し、自動で処理を試みる。
- 定期実行：cron 式で動くジョブを登録し、履歴を残す。

## 設計原則

- **タスクボックスを唯一の入口にする**。
  Slack、GitHub、手動登録、定期ジョブのどれから来た仕事も、まず task として記録してから処理に回す。
  入口を一本にしておけば、取り込み元を増やしても仕分けと処理の仕組みは変わらない。
- **処理中のタスクは一つのタブである**。
  petaterm と同じく、タブは独立した pty を持ち、Claude Code の権限待ちや完了をバッジと通知で知らせる。
  自動処理も人間が途中から介入できるよう、ヘッドレス実行ではなく pty 上の対話セッションとして起動する。
- **状態はローカルの DB とリポジトリに外在化する**。
  タスク、ルール、ジョブ、実行履歴は SQLite に持ち、Claude Code の成果はブランチと PR に残す。
  アプリを再起動してもタスクボックスと履歴は失われず、処理の続きは Issue と PR を読み直せば再開できる。
- **常駐はトレイ常駐で実現する**。
  ウィンドウを閉じてもプロセスは残り、受信、自動取り出し、定期ジョブは動き続ける。
  デーモンと UI を分けない理由は、処理タブが pty を握っており、別プロセスにすると pty と画面のあいだに中継が必要になるからである。
- **通知の受信はデスクトップの通知を監視して行う**。
  Slack などの通知は、各サービスの API ではなく、デスクトップに表示される通知を D-Bus で監視して拾う。
  サービスごとのアプリ登録やトークンが要らず、デスクトップに通知を出すものなら何でも対象にできる。
  通知には元メッセージへのリンクが含まれないため、返信や正確な重複排除が要るサービスだけ API 連携を後から足す。
- **外部サービスの認証は既存の CLI と公式 SDK に委ねる**。
  GitHub は `gh` の認証をそのまま使い、Slack の API 連携を足す場合も Socket Mode の公式 SDK を使う。
  公開 URL や独自の認証基盤を持たない。

## 技術構成

petaterm の構成をそのまま引き継ぐ。
Electron + React + TypeScript、ターミナル描画は xterm.js、シェルは node-pty、Git 操作は simple-git、状態管理は zustand、ビルドは electron-vite である。
petaterm から持ち込む資産は、縦タブのサイドバー、ターミナルビュー、Git パネル群（変更、diff、ログ）、ワークスペースパネル、設定画面、Claude Code hooks の受信（Unix ドメインソケット）、デスクトップ通知、セッション復元、デスクトップエントリと自動起動のスクリプトである。

petaterm には無い要素は次の三つである。

- **DB**：Node.js 組み込みの `node:sqlite` で SQLite をメインプロセスから扱う。
  alir の iceql（CSV + YAML）は人間が読める利点があるが、通知の受信と定期ジョブが同時に書き込むため、トランザクションを持つ SQLite を選ぶ。
  Electron 43 の Node 24 と開発環境の Node 22 の両方で `node:sqlite` が使えるため、better-sqlite3 のようなネイティブモジュールを Electron 向けに再ビルドする手間を避けられる。
- **コア**：タスク、取り込み元、ルール、ジョブ、スケジューラを Electron に依存しないモジュールとして `src/core` に置く。
  メインプロセスはコアを起動して IPC で UI に露出するだけにする。
  Electron に依存しないのは、テストを Electron なしで走らせるためと、将来デーモンに切り出す余地を残すためである。
- **外部連携**：デスクトップ通知の監視は `busctl monitor --json=short` をサブプロセスとして起動し、その JSON 出力を読んで行う。
  busctl は systemd の一部で Ubuntu のデスクトップに必ずあり、D-Bus のライブラリを持ち込まずに済む。
  GitHub は `gh` CLI の呼び出し、cron 式の解釈は croner を使う。
  Slack の API 連携を足す場合は `@slack/socket-mode` と `@slack/web-api` を使う。

petaterm のリポジトリは fork せず、必要なソースをコピーして独立させる。
petaterm は汎用ターミナルとして残し、sokking はタスク処理に特化して別々に育てる。

## 画面構成

左のサイドバーは上下二段に分ける。
上段は固定の入口で、タスクボックス（未処理件数のバッジ付き）、通知、ルール、ジョブ、設定を並べる。
下段は処理タブの一覧で、petaterm のセッションタブと同じく、Claude Code の状態（権限待ち、Idle、実行中）をバッジで示す。

タスクボックスを選ぶと、メイン領域に task の一覧が出る。
各 task は取り込み元、タイトル、受信日時、元のメッセージや Issue へのリンクを持ち、次の操作ができる。

- **Claude Code で処理する**：作業ディレクトリと初期プロンプトを指定して処理タブを開く。
- **GitHub Issue にする**：リポジトリを選んで `gh issue create` で登録し、task に Issue の URL を結びつける。
- **ジョブにする**：定期ジョブの作成画面へ task の内容を引き継ぐ。
- **アーカイブする**：対応不要として閉じる。

処理タブを選ぶと、petaterm と同じ terminal / diff / Git / log / workspace のパネルに加えて、task 情報パネルが出る。
task 情報パネルには元の通知や Issue 本文、処理の状態、完了後の操作（PR を開く、完了にする）を置く。

通知画面には、受信した通知の直近のログとフィルタルールの一覧を置く。
ログの各行から「この通知でルールを作る」を選ぶと、アプリ名と要約を埋めた状態でルールの編集フォームが開く。
どの通知が届いていて、どのルールで落ちたのかを見ながらルールを調整できるようにするためである。

ルール画面とジョブ画面は一覧と編集フォームの二画面で足りる。
ジョブ画面には実行履歴も置く。

## データモデル

- **task**：id、source（notification / github / manual / schedule）、title、body、source_app（通知を出したアプリ名）、source_ref（Issue の URL、Slack のパーマリンクなど、あれば）、status（inbox / running / review / done / archived）、workdir、created_at、updated_at。
- **run**：task_id、tab_id、mode（interactive / auto）、permission_mode、delivery（pr / push）、push_branch、prompt、session_id（Claude Code のセッション ID）、branch、pr_url、started_at、finished_at、result（done / failed / parked）。
  一つの task は複数回 run されうる（やり直し、PR 修正）。
- **repo**：workdir、default_delivery（pr / push）、default_push_branch、default_permission_mode。
  処理タブを開くときの既定値をリポジトリごとに持つ。
- **notification_filter**：name、order、enabled、app_pattern、title_pattern、body_pattern（いずれも正規表現、空なら条件なし）、action（accept / ignore）、workdir、prompt_template。
  通知をタスクボックスに積む前に通すフィルタルールで、order の順に評価して最初に合致したルールの action に従う。
  どのルールにも合致しない通知の扱い（accept / ignore）は setting に持つ。
- **notification_log**：app、title、body、received_at、matched_filter_id、result（accepted / ignored）、task_id。
  受信した通知の記録で、件数と日数で自動的に消す。
- **source_config**：取り込み元ごとの設定（Slack API 連携を使う場合のトークンなど）。
- **rule**：workdir、query（`gh issue list --search` に渡す検索式）、interval_seconds、auto（取り込んだら即処理するか）、permission_mode、prompt_template、enabled。
- **job**：name、cron、kind（shell / claude）、command または prompt、workdir、timeout_seconds、enabled。
- **execution**：job_id、status（running / success / failed / timeout）、exit_code、stdout、stderr、started_at、finished_at。
- **setting**：キーと値の汎用設定（並列上限、通知の有無など）。

Slack の API 連携を使う場合、トークンは DB に入れず、userData 配下のファイルに権限 0600 で保存する。

## 開発するもの

### 1. 土台とタスクボックス

petaterm のソースをコピーし、sokking の名前に置き換えて起動できる状態にする。
その上に `src/core` と SQLite を足し、task の CRUD と手動登録（UI と `sokking add` コマンド）を作る。
サイドバー上段の固定入口とタスクボックス画面を実装する。

この段階では取り込み元は手動だけだが、タスクボックスから処理タブを開くところまでを通す。

### 2. 処理タブ

task から処理タブを開き、pty 上で Claude Code を起動する。
開くときの画面で workdir、初期プロンプト、permission mode、成果の形（PR を作るか、指定ブランチへ直接 push するか）を決める。
これらの既定値は repo に持ち、同じリポジトリでは毎回選び直さなくて済むようにする。
初期プロンプトは task の本文とリンクを含めたテンプレートから生成する。

Claude Code の状態は petaterm の hooks 連携で受け取る。
Stop や Notification のイベントで task の status を running から review に進め、タブのバッジとデスクトップ通知で知らせる。
人間はタブに入って続きを指示でき、終わったら task 情報パネルから done にする。

自動処理（ルール由来、ジョブ由来）では、作業を worktree に隔離する。
worktree の配置と branch の規約は alir のもの（`<repo>-sokking/issue-<n>`）を踏襲する。
成果の形は repo の既定値に従い、PR なら PR の URL を、直接 push なら push 先のブランチを run に記録する。

### 3. 取り込み元

取り込み元は Source インターフェースとして統一する。
Source は起動、停止、受信した内容を task に変換する処理を持つ。

**デスクトップ通知**は、D-Bus のセッションバスで `org.freedesktop.Notifications` の `Notify` 呼び出しを監視して拾う。
Ubuntu のデスクトップに出る通知はこの呼び出しを通るため、Slack のデスクトップアプリでも、システム通知を使う設定のブラウザで開いた Slack でも、メールクライアントでも同じ仕組みで受けられる見込みである。
この環境（GNOME 46）で `dbus-monitor` を使い、`notify-send` の通知をアプリ名、要約、本文つきで捕捉できることは確認済みである。
受けた通知は、まず notification_log に記録し、次にフィルタルール（notification_filter）を order の順に評価する。
ルールはアプリ名、要約、本文それぞれへの正規表現を条件に持ち、最初に合致したルールの action が accept なら task にし、ignore なら捨てる。
どのルールにも合致しない通知は、setting の既定（初期値は ignore）に従う。
初期値を ignore にするのは、監視を始めた直後にメールやカレンダーの通知までタスクボックスに流れ込むのを防ぐためである。
accept のルールには workdir と prompt_template を持たせられ、合致した task の既定の作業ディレクトリと初期プロンプトになる。
たとえば「アプリ名が Slack で要約に特定のチャンネル名を含む通知は、そのプロジェクトの workdir で処理する」のように書ける。
task には source_app にアプリ名、title に要約、body に本文を入れる。

デスクトップ通知には制約が三つある。
本文はアプリが通知に載せた分だけで、長いメッセージは切り詰められている。
元メッセージへのリンクが無いので、処理後に Slack のスレッドへ返信する操作は作れない。
おやすみモード中や、Slack のウィンドウにフォーカスがあるときは通知自体が出ず、拾えない。
Slack の通知を確実に拾い、元スレッドへ返信したくなったら、Socket Mode による API 連携を Source として足す。
拾う条件は、bot への DM、bot へのメンション、メッセージショートカット（メッセージのメニューに置く「sokking に送る」）の三つにする。
ショートカットのペイロードには本文、チャンネル、timestamp が入り、パーマリンクは `chat.getPermalink` で取れるため、チャンネル履歴の読み取り権限なしに任意のメッセージを拾える。
絵文字リアクションで拾う方式は採らない。
リアクションのイベントには本文が無く、本文を取るにはチャンネル履歴の読み取り（`channels:history` など）が要り、bot に会話を丸ごと読ませる権限になるからである。
必要なスコープは `app_mentions:read`、`im:history`、返信用の `chat:write`、Socket Mode 用の app-level token の `connections:write` に収める。

snap や Flatpak で入れたアプリは、通知を `org.freedesktop.portal.Notification` 経由で出すことがある。
GNOME ではこれが `org.gtk.Notifications` に流れるため、監視の対象にこの経路も含める。
実装の最初に、実際に使う Slack の入れ方で通知が捕捉できることを確かめる。

**GitHub ルール**は、workdir ごとに検索式と間隔を登録し、`gh issue list --search` で定期的に検索する。
未登録の Issue は task として積む。
ルールの auto が有効なら、積むと同時に処理タブを開き、無効ならタスクボックスで人間の仕分けを待つ。
同じ Issue を二重に積まないよう、source_ref（Issue の URL）で重複を弾く。

**汎用の入口**として、`sokking add` コマンドとローカルの HTTP エンドポイント（127.0.0.1 のみ）を用意する。
スクリプトや他のツールから task を積めるようにするためである。

### 4. 定期ジョブ

mogiri の機能のうち、cron 式による定期実行、手動実行、実行履歴の保存を持ち込む。
ワークフロー（DAG）と環境変数の階層は持ち込まない。

ジョブには shell と claude の二種類を設ける。
shell ジョブはサブプロセスで実行し、stdout と stderr を execution に保存する。
claude ジョブは処理タブとして起動し、人間が途中経過を見られるようにする。
claude ジョブの完了は hooks の Stop イベントで判定する。

スケジューラはコアの中で動き、アプリ起動時に enabled なジョブとルールを読み込む。
実行履歴は保持日数と件数で自動的に消す。

### 5. 常駐化と運用

ウィンドウを閉じてもトレイに残り、トレイのメニューから表示、終了ができるようにする。
petaterm のグローバルホットキーと自動起動スクリプトをそのまま使う。

処理タブの並列上限を setting に持ち、上限に達したら自動処理は待たせる。
レート制限の検知とバックオフは alir の方式（エラー文字列の検知、1 分開始、2 倍、上限 1 時間）を持ち込む。

アプリの再起動時は、running だった task を review に戻し、タブを復元して人間に状況確認を促す。
pty のセッションは復元できないので、Claude Code のセッション ID を使った `--resume` を再開の手段として用意する。

## 開発順序

1. 土台とタスクボックス（petaterm のコピー、SQLite、手動登録）
2. 処理タブ（Claude Code の起動、hooks による状態遷移、task 情報パネル）
3. デスクトップ通知の取り込み（D-Bus の監視、通知ログ、フィルタルールの評価と編集画面）
4. GitHub ルール（検索、重複排除、auto による自動処理、worktree と成果の push）
5. 定期ジョブ（shell と claude、実行履歴）
6. 常駐化と運用（トレイ、並列上限、バックオフ、再起動時の復元）
7. 汎用の入口（`sokking add`、ローカル HTTP）
8. Slack の API 連携（Socket Mode、元スレッドへの返信）。必要になったときだけ着手する

1 と 2 だけでも、手動で積んだタスクを Claude Code に処理させる道具として使える。
3 以降で受信と自動化を足す。

## 決定事項

実装前の未決事項と、その決定を記す。

- **通知の受け方**：Slack の API 連携（Socket Mode）ではなく、デスクトップ通知の D-Bus 監視を最初の取り込み元にする。
  Slack アプリの作成が要らず、Slack 以外の通知も同じ仕組みで拾える。
  返信や確実な捕捉が要るときに API 連携を足す。
- **Slack アプリの拾い方**：API 連携を足すときは、DM、メンション、メッセージショートカットの三つで拾い、絵文字リアクションは使わない。
  チャンネル履歴の読み取り権限を要求せずに任意のメッセージを拾うためである。
- **自動処理の権限モード**：既定を `acceptEdits` とし、`bypassPermissions` はルールごとの明示設定に限る。
- **自動処理の成果の形**：処理タブを開くときに PR か直接 push かを選ぶ。
  既定値はリポジトリごとに repo に持つ。
- **処理タブの並列上限**：既定 2 とし、setting で変更できるようにする。
- **petaterm との関係**：fork せずソースをコピーして独立させる。
  両者の用途が違うため、共通化の維持コストが見合わない。
