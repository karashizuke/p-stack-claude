# Upstream sync log

`cursor/plugins` の `harness/pstack/claude-code` を `main` に取り込むたびに、何が変わったかをここに記録します。新しいエントリは先頭に追加します。手順は [README](./README.md#sync-with-upstream) にあります。

これより前の同期は記録していません。

## 2026-11-25: cursor/plugins@41e4009 (0.15.46 → 0.15.48)

差分は [aaeb0ea...41e4009](https://github.com/cursor/plugins/compare/aaeb0ea3a0584995aa8f55ce44c6c5259414b896...41e400932eca14f289e7db717a70455256b6d388) です。このツリーに触れた commit は2件 (#1324, #1326) で、変更は6ファイル (+28 / -2) です。

### 追加

- `/reframe` スキル。作ろうとしているものの専門用語を 8〜12 個、作るものへの影響が大きい順に教え、隣の分野から借りた用語と、その類推が崩れる点も示します。最後に説明文を新しい用語で書き直します。引用したリンクは開いて確かめ、確かめられないものは削ります (#1324)。
- 説明が複数の問題を指しうるときは、まず候補を2〜3個、見分ける手がかりと一緒に挙げ、最もありそうなものを選びます (#1326)。
- `/reframe` は `disable-model-invocation: true` で、入力したときだけ動きます。`poteto-help` の対応表と `docs/guide/02-poteto-mode.md` に案内が入りました。

### このフォークへの影響

- 衝突は `plugin.json` と `.claude-plugin/plugin.json` の version だけでした。バージョンは `0.15.48-k.1` にしました。
- ローカルの変更 (`hooks/`、`skills/deslop/`、`skills/setup-pstack/` の step 5) は本家の変更と重なっていません。
- SessionStart フックが案内するコマンドに `/reframe` は足していません。フックが案内するのは、作業の途中で合うものを勧めるコマンドで、`/reframe` は依頼を書く前に使うものだからです。
- 変更はスキルの文章だけで、コードは変わっていないため、テストは実行していません。

## 2026-11-21: cursor/plugins@aaeb0ea (0.15.42 → 0.15.46)

差分は [bf0c7cd...aaeb0ea](https://github.com/cursor/plugins/compare/bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7...aaeb0ea3a0584995aa8f55ce44c6c5259414b896) です。このツリーに触れた commit は4件 (#1249, #1283, #1284, #1292) で、変更は78ファイル (+358 / -1415) です。

### 既定モデルの変更

- どのロールも `xhigh` を超えて動かなくなりました。`setup-pstack` の budget から `unlimited` がなくなり、`# budget: unlimited` は `large` に置き換わります (#1249)。
- コード・判断・文章の既定は `claude-opus-5-5-xhigh-fast` です。Opus 5.5 は常に `-fast` slug を使います (#1249)。
- Fable 5.2 は panel の外では、ユーザーが指名したときか、同じ brief で Opus 5.5 xhigh が2回失敗したときだけ動きます。`hardest tasks` ロールはなくなりました (#1249)。
- panel の Gemini 席は `gemini-4-neon-xhigh` になりました (#1283, #1284)。`arena cross-judge pool` の既定から Fable を外しました。Fable と Opus は同じベンダーだからです。
- 生成するルールの行が `# defaults: 3` になりました。
- `agents/poteto-agent.md` に `model: claude-opus-5-5-xhigh-fast` が入りました。Claude Code の adapter は、`pstack:poteto-agent` を起動する Agent 呼び出しで必ず `model` と `effort` を渡すよう指示しています。

### 動作が変わったスキル (#1249)

- `poteto-mode`。trigger の一覧と Subagents の節を大幅に短くしました。「Writing the reply」の節は削除されました。agent を起動するとき、kickoff の1行目で新しい `skills/poteto-mode/worker.md` を読ませます。
- `architect`。Phase A〜E の手順と runner の arena をやめ、短い指針だけになりました。大きい設計や争点のある設計は `arena` を使います。`architect runners` ロールはなくなりました。
- `reflect`。4種の reviewer と synthesizer をやめ、1ファイルの手順になりました。`reflect tooling` と `reflect judgment, divergent, synthesizer` のロールはなくなりました。
- `multi-phase-plan`、`babysit`、`opening-a-pr` の各 playbook を短くしました。
- principle 系スキル、`technical-writing`、`unslop` の本文を短くしました。

### 修正

- `statechart`。ネイティブ Windows で動き、TLC 出力の `\r\n` を読めるようになりました (#1292)。`janitor.ts` と `kill.ts` を追加しました。

### 削除

- `orchestrate` playbook。playbook は22個になりました。
- `skills/architect/references/` の3ファイル、`skills/reflect/references/` の4ファイル、`skills/poteto-mode/scripts/check-plan.mjs` とそのテスト。

### このフォークへの影響

- 衝突は `plugin.json`、`.claude-plugin/plugin.json`、`skills/setup-pstack/SKILL.md` の3件でした。
- バージョンは `0.15.46-k.1` にしました。
- `setup-pstack` の step 5 は本家の新しい形を採り、panel 3行 (`arena runners`、`arena cross-judge pool`、`interrogate reviewers`) だけローカルの値を残しました。本家が廃止した `architect runners`、`hardest tasks`、`reflect` の各行は消えます。
- `arena cross-judge pool` はローカルの `opus xhigh, fable xhigh` のままです。どちらも親と同じ Claude ベンダーなので judge は動かず、コーディネーターが単独で base を選びます。これはマージ前と同じ動作です。
- `hooks/` は本家の変更と重なっていません。SessionStart フックが案内する `/pstack:architect` などのコマンドはすべて残っています。
- `statechart` のテスト (`test/messages.test.ts`、`test/cli.test.ts`) を実行しました。失敗は symlink 経由で launcher を起動する1件だけで、マージ前の `fc326b6` でも同じように失敗します。

## 2026-11-16: cursor/plugins@bf0c7cd (0.15.36 → 0.15.42)

差分は [bb68f23...bf0c7cd](https://github.com/cursor/plugins/compare/bb68f2365eceafa0cb2d253112f675acf5f144cc...bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7) です。このツリーに触れた commit は1件 (#1236) で、変更は55ファイル (+372 / -1029) です。

### 既定モデルの変更

- `setup-pstack` の既定値から grok を外しました。コードの委譲 (feature、refactoring、bug-fix、perf-issue、hillclimb) と判断・文章は `claude-opus-5-5-xhigh`、`hardest tasks` は `claude-fable-5-2-max`、`reflect tooling` と `swarm workers` は `claude-opus-5-5-high-fast` です。
- panel (arena runners、cross-judge pool、architect runners、interrogate reviewers) の既定は `claude-fable-5-2-high`、`claude-opus-5-5-high-fast`、`gemini-4-carbon-high` の3席です。
- 生成するルールに `# defaults: 2` 行が入ります。この行がない古いルールを再設定すると、`grok-*` の値だけを新しい既定値に置き換え、ほかの値は残します。
- Fable は arena の Phase A で独立したモデルファミリーとして扱われます。

### 動作が変わったスキル

- `how`。explorer と explainer の2段構成をやめ、1つの subagent が調べて説明します。`how explorer` と `how explainer` のロールはなくなりました。
- `why`。MCP ごとの investigator と synthesizer をやめ、1ファイルの手順になりました。commit と PR の議論を中心に答え、それで足りないときだけ他の情報源を見ます。`why investigators` と `why synthesizer` のロールはなくなりました。
- `poteto-mode` と各 playbook。`how` スキルを呼ぶ代わりに「対象のサブシステムを追跡する」と書くようになりました。役割ごとの既定 effort は xhigh か high で、`hardest tasks` だけ max です。
- `recall`。共有記録の調査で、`why` の investigator を借りずに情報源ごとに subagent を起動します。
- `sharpen`。実験で決められる選択は試作して推奨させ、好みの選択だけをユーザーに残すプロンプトを書きます。
- `reflect`、`architect`、`arena`、`blast-radius` などは、既定モデル名の更新が中心です。

### 修正

- `statechart`。SANY が仕様を読めないとき、SANY を再実行して構文エラーの本文を表示します。Mermaid 出力の変更とテスト追加もあります。

### 削除

- `skills/how/references/` の2ファイルと、`skills/why/references/` の11ファイル。

### このフォークへの影響

- 衝突は `plugin.json`、`.claude-plugin/plugin.json`、`skills/setup-pstack/SKILL.md` の3件でした。
- バージョンは `0.15.42-k.1` にしました。
- `setup-pstack` の panel 4行は、ローカルの `opus xhigh, fable xhigh` (interrogate は `sonnet xhigh` を加えた3席) を残しました。`swarm workers` はローカルで変えていなかったので、本家の新しい既定値 `claude-opus-5-5-high-fast` を採りました。
- `hooks/` は本家の変更と重なっていません。SessionStart フックが案内する `/pstack:how` と `/pstack:why` は引き続き存在します。
- `statechart` のテストは実行していません。このフォークで変更していないファイルだけが対象です。

## 2026-11-05: cursor/plugins@bb68f23 (0.15.26 → 0.15.36)

差分は [8838150...bb68f23](https://github.com/cursor/plugins/compare/8838150c6b4829ea3c01782631213776d86df14a...bb68f2365eceafa0cb2d253112f675acf5f144cc) です。このツリーに触れた commit は27件、変更は452ファイル (+20420 / -3491) で、うち407ファイルは `skills/statechart/` の追加です。

### 追加されたスキル

- `/statechart` (#741, #776, #779, #791, #977, #981, #982)。TLA+ モデルを TLC で検査し、Mermaid のステートチャートを描き、ルールを破る状態までの最短経路を報告します。実行コマンドは `scripts/statechart SPEC.tla` です。Node (22.18 以上の 22.x か 23.6 以降)、Bun 1.1.5 以降、Deno 2.0 以降のいずれかで動きます。初回実行では mise で TLC と Java を入れるため、ネットワークが必要です。環境変数 `TLA2TOOLS` に jar を指定すると mise を使いません。
- `/ketchup-video` (#797, #986)。`/ketchup` の内容を字幕付きスライド動画で見せます。判断待ちの項目は動画の下にテキストで出します。
- `maintain-formal-verification-skill` (#716)。形式検証スキルを保守する手順です。対象コードに触れた commit を読み、モデルや検査を更新して再実行し、各検査を in sync、updated、bug、blocked のいずれかで報告します。

### 動作が変わったスキル

- `poteto-mode` (#986)。最初のメッセージ、ブリーフ、PR、最終報告でユーザーの目的を言い直します。実行中のエージェントへの追加指示と再開もバックグラウンドで行います。Task ツールがモデル指定を拒否したときは、次の候補へ切り替えます。Explain the Number を計測の前にも適用します。
- Autopilot の playbook (#986)。PR を止める理由は、実行結果か誤ったドキュメント行で示せる問題に限ります。完了した単位ごとに push します。文言だけの変更には verifier を付けません。Autopilot-stack は、マージしない Autopilot-full という定義になりました。PR をスタックするのは、別の PR の上に作るときだけです。
- Orchestrate (#1043)。`orch` CLI を使わず、コーディネーター自身のツールで進めます。
- `interrogate` (#986)。指摘には実行による証明が必要になり、リードは再実行で確認できた指摘だけを残します。
- `arena` と `setup-pstack` (#986)。拒否された runner の席は外すか置き換えます。cross-judge は親と別のモデルファミリーからだけ選びます。`auto` と `inherit-parent` は判定しません。別ファミリーのモデルが動かないときは判定を省き、コーディネーターが単独で base を選びます。
- `reflect` (#800)。承認した編集をプラグインキャッシュに書かなくなりました。承認前に書き込み先を示し、承認後にスキルをユーザー側のスキルフォルダへコピーして編集します。PR と push はしません。
- `create-formal-verification-skill` (#716, #721, #724, #794)。イベント順序の問題は言語を問わず TLA+ を既定にします。検証ツールがない言語では、その旨を伝えて生成入力で実コードをテストします。生成する検証スキルには、対象コードと同期 commit の記録、および `/statechart` で結果を読む指示が入ります。
- `/sharpen` (#729)。元のプロンプトに戻し、書き直したプロンプトだけを返します。
- `principle-explain-the-number` (#986)。実行の前に、判断を変える結果とノイズの範囲を書きます。
- スタック PR の手順 (#986)。子 PR は親ブランチの上に rebase します。

### 修正

- `watch-pr` (#801, #802)。スタック検出でフォークの head を区別します。ポーリングの待ち時間は期限で打ち切ります。
- `check-plan` (#803)。対応するインラインコードの区切りを認識します。
- `worktree-audit` (#805)。transcript の更新時刻を GNU の `stat` と `date` で読みます。
- `swarm` (#807)。Phase A の番号と、参照先のない表への言及を直しました。
- README (#806)。Claude Code はサードパーティのマーケットプレイスを既定で自動更新しないことを追記しました。

### 削除

- `skills/poteto-mode/scripts/orch/` (#1043)。
- `skills/interrogate/references/` の4ファイル (#986)。

### このフォークへの影響

- マージで衝突はありませんでした。`skills/setup-pstack/SKILL.md` は本家とローカルの編集箇所が別の行で、両方の変更が残っています。
- ローカルの panel 既定値 `opus xhigh, fable xhigh` は、cross-judge の新しい規則に合います。親が Opus なら Fable が判定します。これは SKILL の記述から読み取った結果で、`arena` を実行して確かめてはいません。
- `hooks/` と effort mod は本家の変更と重なっていません。`scripts/test-effort.sh` の結果は同期の前後で同じ 58 pass / 2 fail です。失敗する `crew > a row shows what its agent is doing, ...` と `status > todos made while no pstack skill runs, ...` は同期前からあります。
- 旧 `upstream` ブランチは、`UPSTREAM_COMMIT` が 8838150 を指す一方で、`plugin.json` の2ファイルだけが 0.15.26 のままでした。8838150 の値は 0.15.27 です。見出しの起点を 0.15.26 としているのはこのためです。今回の同期で本家と一致しました。
- `scripts/sync-upstream.sh` を、git オブジェクトから `upstream` のツリーを組み立てる方式に変更しました。以前のファイルコピー方式は、`core.filemode=false` の環境で新規ファイルの実行ビットを落とします。`rsync` と同じ動作の代替コマンドで試すと、`skills/statechart/scripts/statechart` と `skills/statechart/scripts/test/java.ts` が 100644 になりました。新しい方式は作業ツリーを経由しないため、`rsync` は不要です。
- Windows では、本家の `skills/poteto-mode/scripts/watch-pr/github.test.ts` のテスト1件 (`requests and parses fork identity from gh before stack discovery`) が失敗します。このテストは拡張子のないシェルスクリプトを偽の `gh` として `PATH` に置きますが、Windows の Bun はそれを実行せず本物の `gh` を呼びます。`PATH` の区切りを `;` にしても同じでした。本物の `gh` で `GhGitHubReader().openPullRequests` を実行すると正常に動きます。このファイルにローカルの変更はありません。
