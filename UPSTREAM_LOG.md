# Upstream sync log

`cursor/plugins` の `harness/pstack/claude-code` を `main` に取り込むたびに、何が変わったかをここに記録します。新しいエントリは先頭に追加します。手順は [README](./README.md#sync-with-upstream) にあります。

これより前の同期は記録していません。

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
