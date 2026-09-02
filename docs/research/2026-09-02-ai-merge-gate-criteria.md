# AI 生成変更の自動マージ判定基準に関する調査(2026-09-02)

## 0. この文書について

- 作成日: 2026-09-02
- 作成方法: Claude Code セッション上で、Web 検索・一次資料の取得・ローカルにインストール済みの Superpowers 6.3.0 の読解を行い、3 本の並列調査エージェントの報告を統合した。
- 目的: 「AI が設計・実装計画・実装を作り、基準を満たせば自動マージ、満たさなければ人間レビュー」という開発フローにおける「基準」の軸と、参照できる既存の知見を整理する。
- 引き継ぎ先: リポジトリ `ship-or-ask`(このゲートを E2E のトレーサーブレッツとして実装する)。
- 注意: 調査環境の egress 制限により、claude.com、rewind.com、rootly.com、intercom.com、ona.com、customer.io、arxiv.org、engineering.fb.com、docs.github.com、docs.renovatebot.com などは本文を直接取得できなかった。これらは複数の検索スニペットまたは GitHub 上のソースリポジトリで内容を突き合わせて確認した。数値を引用する際は原文で再確認すること。
- 付録 A〜C に、調査エージェントの原文レポート(英語)を省略せずに収録している。本文に載せきれない条件語彙、メトリクス定義、検証状況はそちらを参照する。

## 1. 背景と元の依頼

依頼者は開発者で、Claude Code などの AI コーディングエージェントを日常的に使っている。課題は、特定のリポジトリに限らない一般的な開発フローとして「AI と人間の共同作業によるアウトプットのスループット」を最大化すること。

構想している開発フロー:

1. AI が設計書と実装計画を作る(Claude Code プラグイン「Superpowers」(obra/superpowers)の brainstorming → writing-plans → executing-plans の流れを想定)
2. その設計・計画・実装を何らかの基準で評価する
3. 基準を満たさない場合は人間にレビューを依頼する
4. 基準を満たす場合は AI がそのまま実装し、マージまで完了する

依頼内容:

1. 自動マージを許すか人間レビューに回すかを判定する軸を網羅的に洗い出す
2. その軸や観点を体系的に整理している既存のドキュメント、規約、フレームワーク、考え方、仕組みを調査し、URL 付きで示す

## 2. 結論の要約

基準の軸は大きく 4 群に分けられる。

- 壊れたときに何が起きるか: 可逆性、影響範囲、機微領域、外部副作用
- 何を変えたか: 変更の種類、規模、依存関係
- どれだけ確かめたか: 仕様の明確さ、検証の証拠、独立レビュー、計画との整合
- 運用実績: タスク種別ごとの信頼度、ロールバック手段

先例を横断して一致している原則は 3 つ。

1. 規模ではなく「壊れたときの影響」で判定する(Rootly、Rewind、Meta)
2. 認証・課金・マイグレーション・IaC・CI 設定・シークレットは常に人間が見る(Anthropic、Ona、Customer.io、Chromium)
3. 書いたエージェントは承認できない。自己分類も禁止。自動承認はログとサンプリング監査で裏取りする(Anthropic、SLSA、Ona)

Superpowers 6.3.0 自体はすでに判定に使える構造を持っている。brainstorming の spike / bounded / architectural 分類、subagent-driven-development の「止まるのは 4 つだけ」(不可逆・破壊的操作、セキュリティ機微な操作、worktree 外への副作用、全経路が推測になる計画)、code-reviewer の Critical / Important / Minor である。ただし現状は全経路で人間承認を HARD-GATE にしており、マージ判断も人間に委ねる設計になっている。今回の構想は、この固定ゲートをリスク条件付きゲートに置き換えることに相当する。

## 3. 基準の軸一覧

| 軸 | 何を測るか | 自動判定に使える具体的なシグナル | 人間レビューに回す閾値の例 |
|---|---|---|---|
| 可逆性 | 失敗時に元へ戻せるか、戻すコストはいくらか | マイグレーションファイルの有無、データ削除や `DROP` / `rm` 相当の操作、外部への公開(パッケージ publish、メール送信、決済 API)、スキーマ変更、feature flag の有無 | 不可逆操作を 1 つでも含めば人間。flag 配下かつ内部ユーザーのみ露出なら 1 段下げる |
| 影響範囲(blast radius) | 壊れたときに何がどこまで壊れるか | 触ったディレクトリとその service tier、変更モジュールを import している推移的依存数、共有 API やインターフェースの変更、Kamei の NS / ND / NF(サブシステム・ディレクトリ・ファイル数) | 複数サブシステムにまたがる、他モジュールが依存する公開契約を変える、Tier 0/1 相当のパスに触れる、のいずれかで人間 |
| 機微領域 | セキュリティ・規制・金銭に直結するコードか | パスの deny list(auth、billing、tenant 分離、crypto、権限、IaC、CI ワークフロー、`.env`、シークレット、パッケージマニフェスト)、シークレット検出、IAM スコープ拡大 | deny list に 1 ファイルでも一致すれば人間。自動化度に関係なく常に固定 |
| 外部への副作用 | worktree の外に何かを起こすか、新しい危険操作を持ち込むか | 新規の subprocess / eval / SQL / ネットワーク / ファイル書き込みの導入(capability delta)、共有ブランチへの push、外部サービス呼び出しの追加 | 新しい危険操作クラスの導入、または本番相当の外部作用を含めば人間 |
| 変更の種類(機械性) | 振る舞いを変えない変更か、パターン化された安全な変更か | Conventional Commits の type(docs / test / style / chore / revert)、clean revert / clean cherry-pick、フォーマットのみ、コメントのみ、翻訳ファイル、生成物、dead code 削除 | docs・test 追加・整形・clean revert のみなら自動側。`feat` や `fix` で振る舞いが変わるものは他の軸で判定 |
| 規模・拡散 | 一度に見る量と散らばり | 追加・削除行数、ファイル数、ディレクトリ数、エントロピー(変更行の分散)、コミット数 | 行数は主判定に使わず補助に。目安として 200 行超または 10 ファイル超で他の軸を厳しめに評価。Google は 100 行程度を妥当、1000 行は過大とする |
| 依存関係・サプライチェーン | 外部コードの取り込みか、その更新幅 | 新規依存の追加、semver の major / minor / patch、lockfile のみの変更、`0.x` 系か、リリースからの経過日数、maintainer 変更フラグ | 新規依存追加と major は人間。patch / minor かつ CI 通過かつ一定日数経過なら自動(Renovate と Dependabot の定石) |
| 仕様の明確さ | 何を作るかが確定しているか | Superpowers の分類(spike / bounded / architectural)、Spec Kit 流の `[NEEDS CLARIFICATION]` 残数、受け入れ条件が検証可能な形か、実行中に記録された Ruling(裁定)の数と重さ | architectural は人間。未解決マーカーが 1 つでもあれば人間。実行中の裁定が N 件超、または仕様と矛盾する裁定があれば人間 |
| 検証の証拠 | テストが本当に振る舞いを縛っているか | CI 全通過、新規振る舞いに対応するテスト追加、変更行のカバレッジ、red → green の記録、CI を弱める変更の検出(skip、`\|\| true`、閾値の引き下げ、ワークフロー条件の追加) | CI 失敗、CI 弱体化、振る舞い変更にテスト追加なし、のいずれかで人間。CI 弱体化は即ブロック |
| 独立レビューの判定 | 書いた主体と別の目が問題を見つけたか | 新しいコンテキストのレビュアーエージェントによる Critical / Important / Minor 件数、レビュアーの確信度、根拠(file:line)付きかどうか | Critical または Important が 1 件以上で人間。確信度が閾値未満(例: 5 段階の 4 未満)なら人間 |
| 計画との整合 | 承認済み計画からの逸脱 | 計画の Files 欄に無いファイルへの変更、計画外の依存追加、タスク数や範囲の膨張、途中での分類格上げ | 計画外ファイルへの変更、途中格上げ(bounded → architectural 相当)が起きたら人間 |
| 変更履歴・所有 | 触った場所が「壊れやすい場所」か | ファイルの直近 churn、直近の関与者数(NDEV)、最終変更からの経過(AGE)、過去インシデントに関係したファイルか | 直近 3 人以上が触った、または過去インシデント関連ファイルなら人間寄りに補正 |
| ロールバック・観測手段 | 壊れたときに気づけて戻せるか | feature flag、canary、ロールバック手順の存在、監視やアラートの有無 | 手段があれば他軸を 1 段緩める。無ければ緩めない |
| タスク種別ごとの実績 | このカテゴリで自動化を信頼できるか | カテゴリ別の自動マージ件数、revert 率、後日の人間サンプリングでの差し戻し率 | 新カテゴリは shadow mode(判定だけ出して人間が押す)。連続 N 件が無 revert なら自動へ昇格。revert が出たら降格 |

## 4. 参照フレームワーク一覧

| 名称 | URL | 対応する軸 | このフローへの転用 |
|---|---|---|---|
| Superpowers 6.3.0(obra/superpowers) | https://github.com/obra/superpowers | 仕様の明確さ、外部副作用、可逆性、独立レビュー、計画との整合 | brainstorming の 3 分類をゲートの一次入力に使う。SDD の「4 つの停止条件」を「人間へ回す条件」に読み替える。code-reviewer の Critical / Important を自動判定の入力にする。ledger の Ruling 数を曖昧さの指標にする |
| Anthropic「How Anthropic secures its AI-native software development lifecycle」 | https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle | 機微領域、独立レビュー、タスク種別ごとの実績 | コードベースをリスクでティア分けし、ティアごとに自動化度を決める。新しい AI レビュアーは shadow mode で開始。承認をシグナルと理由付きでログし、リスク加重サンプルを人間が監査。「書いたエージェントは承認できない」を守る。REVIEW.md 相当に「pass の種類、証拠要件、nit の上限」を書く |
| Anthropic「The AI-Native SDLC playbook」(2026-08-21) | https://claude.com/blog/the-ai-native-sdlc-playbook | 仕様の明確さ、計画との整合 | intent.md → spec.md → plan.md → diff → review findings という成果物の連鎖を採用し、人間の判断をゲートに集約する。「エージェントは production gate までは全部やるが越えない」を出発点にする |
| Claude Code「Code Review」ドキュメント | https://code.claude.com/docs/en/code-review | 独立レビュー | 判定はブロックしない設計なので、check run 末尾の `bughunter-severity` を CI で読み `normal > 0` ならゲートを閉じる。REVIEW.md で「Important」の定義を自分の基準に合わせる |
| Claude Code「Hooks」 | https://code.claude.com/docs/en/hooks | 外部副作用、機微領域 | PreToolUse / PermissionRequest / Stop hook で決定論的な deny・ask を実装する。ゲートの「ハードルール層」の置き場所 |
| Claude Code「Permission modes」 | https://code.claude.com/docs/en/permission-modes | 外部副作用 | 保護パスと deny ルールは全モードで有効という設計を、リポジトリ側の deny list 設計の手本にする |
| Anthropic「Measuring AI agent autonomy in practice」 | https://www.anthropic.com/research/measuring-agent-autonomy | タスク種別ごとの実績 | 「エージェント側が止まって質問した回数」を監督シグナルとして使える、という知見を Ruling 数の扱いに応用 |
| Anthropic「Building effective human-agent teams」 | https://claude.com/blog/building-effective-human-agent-teams | タスク種別ごとの実績 | タスク種別ごとに自律を段階的に広げる運用モデル。最初は手動で検証し、成功が積み上がった種別だけ範囲を拡大 |
| Meta「Diff Risk Score」 | https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/ | 影響範囲、変更履歴 | diff とメタデータから 0〜1 のインシデント確率を出し、閾値をチームのリスク許容度で調整する。コードフリーズ時に上位 16 % だけ止めて 42 % 多く変更を通した、という結果が「リスクで絞る」根拠 |
| Meta「RADAR: Automating Low-Risk Code Review」 | https://arxiv.org/abs/2605.30208 | 変更の種類、独立レビュー、検証の証拠 | 自動ランドの最も近い先例。著者種別と自動化ソースで適格性を分け、静的ヒューリスティクス → リスクスコア → LLM レビュー → 決定論的検証の漏斗で通す。「安全シグナル」と「危険シグナル」の一覧が変更の種類軸の雛形 |
| Kamei ら「Just-in-Time defect prediction」(TSE 2013) | https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_TSE2013.pdf | 規模・拡散、変更履歴 | 14 メトリクス(NS, ND, NF, Entropy, LA, LD, LT, FIX, NDEV, AGE, NUC, EXP, REXP, SEXP)は git から全て計算できる。最小構成では NF・ND・LA+LD・NDEV だけ使う |
| Mockus & Weiss「Predicting risk of software changes」(2000) | https://mockus.org/papers/bltj13.pdf | 規模・拡散、変更履歴 | 「変更の拡散と開発者経験が失敗予測の中核」という原典。AI は常に「経験の浅い貢献者」として扱う根拠 |
| Bird ら「Code ownership」(Microsoft Research) | https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ownership.pdf | 変更履歴・所有 | 「minor contributor による変更はより厳しくレビューする」という提言。AI エージェントは構造的に minor contributor |
| ITIL 4 Change enablement | https://s3.amazonaws.com/thinkific/file_uploads/381835/attachments/491/75a/635/Change-enablement.pdf | 変更の種類、タスク種別ごとの実績 | 「標準変更」の考え方を採用する。手順(=タスクカテゴリ)を一度リスク評価して事前承認し、個々の変更は再審査しない。手順が変わったときだけ再評価 |
| DORA「Streamlining change approval」 | https://dora.dev/capabilities/streamlining-change-approval/ | 全体設計 | 外部承認は速度を落とすが変更失敗率を下げない、という研究結果。「全変更を同じ承認プロセスに通す」を明示的な落とし穴として挙げている。ゲートの効果測定に Change Failure Rate と Rework Rate を使う |
| Google eng-practices「Code Review」 | https://google.github.io/eng-practices/review/ | 規模・拡散、独立レビュー | レビュー観点(design、functionality、complexity、tests、naming、comments、style、docs)をレビュアーエージェントのチェックリストに。「信頼できる自動リファクタリングツールの変更はレビューが検証中心になる」という例外規定 |
| Chromium code review / Rubber-Stamper | https://github.com/chromium/chromium/blob/main/docs/code_reviews.md | 変更の種類、独立レビュー | 「検証可能に安全」な変更(翻訳ファイル、clean revert、clean cherry-pick)だけボットが承認し、OWNERS 承認は設計上出さない。自動承認の対象を「パターンで機械的に検証できる変更」に限定する手本 |
| SLSA Source track(L4 二者レビュー) | https://slsa.dev/spec/v1.2/source-requirements | 独立レビュー | 「アップロード者とレビュアーは別人」の要件。個人開発では「実装エージェント ≠ レビューエージェント(新規コンテキスト)+ 人間サンプリング」に置き換える。Trusted Robot に例外を与えてよいという規定が自動レーンの根拠 |
| OpenSSF Scorecard「Code-Review」 | https://github.com/ossf/scorecard/blob/main/docs/checks.md | 独立レビュー | 「AI/ML ボットのレビューは code review と数えない」と明記。外部から見た信頼性を保つなら、人間サンプリングの記録を残す必要がある |
| NIST SSDF(SP 800-218)PW.7 | https://csrc.nist.gov/pubs/sp/800/218/final | 全体設計 | 「コードレビュー(人)とコード解析(ツール)のどちらを使うかを組織が定義する」と書かれており、リスクティア付きゲートはこの枠内に収まる |
| Cloud Security Alliance「Agentic AI Autonomy Levels and Control Framework」 | https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/03/agentic-ai-autonomy-levels-control-framework-v2-csa-styled.pdf | 可逆性、影響範囲、外部副作用 | 自律度を決定権限・範囲・可逆性・影響・時間の 5 次元で採点する。この 5 次元をそのままゲートの特徴量にできる |
| Feng ら「Levels of Autonomy for AI Agents」 | https://arxiv.org/abs/2506.12469 | 全体設計 | 人間の役割を Operator → Collaborator → Consultant → Approver → Observer で定義。この構想は「タスク種別ごとに Approver と Observer を切り替える」設計 |
| GitHub Copilot「Manage rationale, confidence, and approvals」 | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/manage-rationale-confidence-approvals | 独立レビュー、タスク種別ごとの実績 | 各変更に rationale と confidence を付け、Full control / Cautious / Balanced / Full automation の 4 段階で閾値を選ぶ。ゲートの「ダイヤル」の UI 設計として流用できる |
| GitHub Copilot cloud agent「Risks and mitigations」 | https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations | 独立レビュー | 「エージェントは自分の PR を Ready にも承認もマージもできない」「依頼者は承認できない」。分離原則の実装例 |
| OpenAI「Auto-review of agent actions」 | https://alignment.openai.com/auto-review/ | 可逆性、外部副作用 | 別エージェントが行動を採点し、low / medium は通し high は人間、critical は常に拒否。ブロック対象 4 分類(データ持ち出し、資格情報探索、セキュリティ低下、不可逆な破壊)。分類器のみに不可逆判定を任せた失敗例(codex issue 18840)もあり、ハードルールを別に持つ根拠 |
| Cursor「Approval Agents」 | https://cursor.com/docs/approval-agents | 機微領域、独立レビュー | ディレクトリ単位の `APPROVAL_POLICY.md` で条件を書き、条件を満たせば自動承認、不明確なら厳しい方に従う。パス別ポリシーファイルの設計例 |
| Renovate automerge / Merge Confidence | https://github.com/renovatebot/renovate/blob/main/docs/usage/key-concepts/automerge.md | 依存関係 | `matchUpdateTypes: ["minor","patch"]`、`matchCurrentVersion: "!/^0/"`、`minimumReleaseAge` の組み合わせが「依存更新の標準変更」の定石 |
| Dependabot fetch-metadata | https://github.com/dependabot/fetch-metadata | 依存関係 | `update-type`、`dependency-type`、`maintainer-changes`、`cvss` などを条件に使い、GitHub の auto-merge を「腕」として使う |
| Mergify conditions | https://docs.mergify.com/configuration/conditions/ | 影響範囲、変更の種類、検証の証拠 | `files ~= ^docs/`、`#files`、`check-success`、`approved-reviews-by` などの条件語彙。ゲートを YAML で書くときの語彙の参考 |
| GitHub rulesets / CODEOWNERS | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets | 機微領域 | パス別の必須レビュアー、Code Owners レビュー必須、必須ステータスチェック。自動レーンが越えられない最終防衛線をプラットフォーム側に置く |
| GitHub Spec Kit「spec-driven.md」 | https://github.com/github/spec-kit/blob/main/spec-driven.md | 仕様の明確さ | `[NEEDS CLARIFICATION]` マーカーと「No markers remain / Requirements are testable and unambiguous / Success criteria are measurable」のチェックリスト。仕様曖昧度を数値化する最も簡単な方法 |
| GitHub Blog「Agent pull requests are everywhere. Here's how to review them」 | https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/ | 検証の証拠 | CI を弱める変更(テスト削除・skip、`\|\| true`、カバレッジ閾値変更、ワークフロー条件の追加)を即ブロック対象にするチェックリスト |
| Rootly「Why we got rid of our small-PR rule」 | https://rootly.com/blog/why-we-got-rid-of-our-small-pr-rule | 影響範囲、可逆性、ロールバック手段 | 「小さいか」を「壊れたら何が起きるか」に置き換え、risk:low / medium / high を付与。flag 配下・マイグレーション無し・共有契約変更無しなら 3000 行でも low |
| Intercom(Fin)「AI is approving our pull requests」 | https://www.intercom.com/blog/ai-is-approving-our-pull-requests-heres-how-we-made-it-safe/ | 規模・拡散、独立レビュー | 19 % 超を人間なしで承認、パイロット 100 件超で revert ゼロ。大きすぎる PR は承認せず分割を要求。スタイル・テスト・セキュリティ・アーキテクチャ準拠を評価 |
| Rewind「How we let AI approve pull requests (safely)」 | https://rewind.com/blog/ai-approve-pull-requests-safely/ | 可逆性、機微領域 | 「PR のリスクは行数とほぼ無関係」。ロックを伴うマイグレーション、IAM スコープ拡大、認証変更を高リスクの名指し例に |
| Ona「auto-approving low-risk PRs」 | https://ona.com/stories/auto-approving-low-risk-prs | 機微領域、タスク種別ごとの実績 | アーキテクチャ判断、認証ロジック、DB マイグレーションを除外。「エンジニアは自分の変更を低リスクと自己分類できない」という制約。リードタイム 74 % 減、初回承認までの時間 2 時間 49 分 → 3.8 分 |
| Customer.io「How we taught AI to approve pull requests」 | https://customer.io/learn/how-we-work/how-we-taught-ai-to-approve-pull-requests | 機微領域、独立レビュー | リポジトリごとに人間が「絶対に自動承認しないパス」と「人間が必要になるサイズ」を決める。非人間が書いた PR は人間がボタンを押すまでマージしない。AI で機微パス候補を洗い出させてから人間が確定。500 件の AI 承認 PR で本番インシデント 0、マージ時間 3.5 時間 → 33 分 |
| Bezos「one-way door / two-way door」(2015・2016 株主書簡) | https://s2.q4cdn.com/299287126/files/doc_financials/annual/2016-Letter-to-Shareholders.pdf | 可逆性 | 可逆な判断は少人数で速く、不可逆な判断は慎重に。可逆性を最上位の軸に置く思考の原点 |
| INVEST / Definition of Ready | https://agilealliance.org/glossary/definition-of-ready/ | 仕様の明確さ | Independent / Negotiable / Valuable / Estimable / Small / Testable。「着手可能」の判定基準として、仕様の明確さ軸のチェックリストに使える |
| Progressive delivery / feature flags | https://www.getunleash.io/blog/progressive-delivery-with-feature-flags | 可逆性、ロールバック手段 | 可逆性を「フラグで戻せる」「露出割合を下げられる」に置き換える。flag 配下の変更を 1 段緩める根拠 |

## 5. 推奨する判定フロー

判定は 2 回行う。計画時点で「予測リスク」を出して実装の進め方を決め、PR 時点で「実測リスク」を出してマージの進め方を決める。計画時の予測より実測が重くなった場合は必ず人間に回す。Superpowers の「格上げは一方向、格下げは無し」と同じ考え方。

判定ロジックは 2 層にする。第 1 層は決定論的なハードルールで、1 つでも該当すれば人間レビュー。ここは LLM の判断に任せない。第 2 層は第 1 層を通過した変更に対する適格性判定で、決定論的シグナルと独立レビュアーの判定を組み合わせる。両層を通過したものだけ自動マージする。

```text
gate(plan, diff, ci, review, history):

  # 第1層: ハードルール(該当すれば即 HUMAN)
  if diff.touches(DENY_PATHS)            # auth, billing, tenant, crypto, IaC, CI設定, secrets, manifests
  or diff.has_irreversible_op()          # migration, データ削除, 外部publish, 決済/送信API
  or diff.introduces_capability(subprocess|eval|sql|network|fs_write)
  or diff.weakens_ci()                   # test skip/削除, "|| true", 閾値引き下げ, workflow条件追加
  or plan.classification == ARCHITECTURAL
  or spec.unresolved_clarifications > 0
  or diff.files ⊄ plan.declared_files    # 計画外ファイルへの変更
  or ledger.has_ruling_conflicting_with_spec():
      return HUMAN

  # 第2層: 適格性判定
  if not ci.all_green(): return HUMAN
  if review.critical + review.important > 0: return HUMAN
  if review.confidence < 4/5: return HUMAN
  if diff.behavior_changing and not diff.adds_tests(): return HUMAN
  if diff.subsystems > 1 or diff.changes_shared_contract(): return HUMAN
  if diff.adds_new_dependency or diff.dependency_bump == MAJOR: return HUMAN
  if history.category(plan.task_type).status != GRADUATED: return SHADOW  # 判定だけ表示、人間が押す

  # 補助シグナルで最終補正
  score = f(diff.lines, diff.files, diff.dirs, files.recent_authors, files.incident_linked, has_feature_flag)
  return AUTO_MERGE if score <= THRESHOLD(task_type) else HUMAN
```

自動マージした変更は全件、判定に使ったシグナルと理由を PR(またはログ)に残し、週に一度リスク加重でサンプリングして人間が読み返す。revert が発生したカテゴリは shadow mode に降格する。

判定結果のラベル語彙は `ship`(自動マージ)/ `ask`(人間レビュー)/ `shadow`(判定を表示し人間が押す)の 3 値とする。

### 5.1 最初に導入すべき最小構成

1. DENY_PATHS をリポジトリごとに書く。Customer.io のやり方に倣い、AI に候補を洗い出させてから人間が確定する。GitHub rulesets のパス別必須レビュアーにも同じ内容を入れ、自動レーンが越えられない最終防衛線にする。
2. Superpowers の分類をそのまま使う。spike と architectural は人間、bounded だけ第 2 層へ進める。
3. CI 弱体化検出と不可逆操作検出を CI ジョブとして実装する。ファイルパターンとキーワードのマッチで十分に始められる。
4. レビュアーエージェントは実装エージェントと別コンテキストで起動し、Superpowers の code-reviewer.md をそのまま使う。Critical と Important がゼロ、かつ「Ready to merge? Yes」でなければ人間。
5. 全カテゴリを shadow mode で開始する。ゲートが「自動マージ可」と判定しても、最初の数週間は人間がボタンを押し、判定と人間の判断の一致率を記録する。
6. 測定指標を最初から取る。自動判定率、人間へ回した率、revert 率、判定から本番までの時間。DORA の Change Failure Rate と Rework Rate に相当する。

### 5.2 後から足す拡張

- Kamei のメトリクス(NF、ND、Entropy、NDEV、AGE)を git log から算出し、第 2 層の補助スコアに加える。
- モジュール単位の推移的依存数(dependency-cruiser や grimp 相当)を影響範囲シグナルに加える。
- Renovate または Dependabot の automerge を有効化し、依存更新を「標準変更」レーンとして分離する。
- タスク種別ごとの実績テーブルを持ち、連続 N 件無 revert で shadow から auto へ昇格する仕組みを入れる。
- Spec Kit 流の `[NEEDS CLARIFICATION]` マーカーを brainstorming の spec テンプレートに組み込み、曖昧度を機械的に数える。
- feature flag と canary が使えるリポジトリでは「flag 配下なら 1 段緩める」補正を入れる。
- Cursor の `APPROVAL_POLICY.md` に倣い、ディレクトリ単位でポリシーを書き分ける。
- 分類の自己申告を避けるため、分類だけ別コンテキストのエージェントに再判定させ、両者が一致した場合だけ bounded として扱う二重判定を入れる。

## 6. 「spike と architectural は人間、bounded だけ第 2 層へ進める」の解説

Superpowers 6.3.0 の brainstorming スキルにある 3 分類を、そのままゲートの一次入力に使うという提案。分類ごとに「人間に回す理由」が異なる。

### 6.1 3 分類の定義(brainstorming/SKILL.md より)

- Spike は「できるか」「可能か」を確かめる実現可能性の調査で、成果物は答えであってコードではない。スキルは「anything you built stays labeled throwaway」と定めている。
- Bounded は「このリポジトリにすでに存在するフローへの、範囲が明確な変更」。新しいフラグ、小さなエンドポイント、1 ファイルの修正が例。スキルは「変更対象のフローがすでにここにあって読める状態であること」を条件にしており、既存フローが無ければ bounded ではないとしている。
- Architectural は新規プロジェクト、新しいサブシステム、コンポーネント同士の組み方を変える変更、他が依存するインターフェースを変える変更。質問、複数案の比較、セクションごとの設計、書面の spec、writing-plans という完全な手順を通す。

### 6.2 Spike を人間に回す理由

Spike はマージするものが無いのが前提。成果物は「やるべきか、どうやるか」の推奨であり、人間が次の方針を決めるための情報。マージ判断ではなく方針判断なので、ゲートの対象外として人間に返す。Spike で書いたコードを残したくなった場合、スキルは「Keeping the code is a new request」として再分類を要求している。Spike から自動マージへ直行する経路は、Superpowers の設計上もともと存在しない。

### 6.3 Architectural を人間に回す理由

セクション 3 の軸に照らすと、architectural は複数の軸で同時に閾値を超える。影響範囲の軸では「他が依存する公開契約を変える」に該当する。仕様の明確さの軸では、複数案から選ぶ判断を含むため、選択そのものが人間の価値判断。可逆性の軸でも、構造を変えた後に戻すコストは高い。Anthropic の事例でも Ona の事例でも「アーキテクチャ判断」は自動承認の除外対象に名指しされている。先例が一致している領域なので、最小構成では議論せず人間固定にする。

### 6.4 Bounded だけ第 2 層に進める理由

Bounded の定義は、ゲートが欲しい前提条件をすでに満たしている。既存フローの変更なので影響範囲が読める、変更対象が特定されているので計画の Files 欄と実測 diff を比較できる、既存のテストがあるので検証の証拠を要求できる、の 3 点。第 2 層のシグナル(CI、独立レビューの Critical/Important、計画外ファイル、テスト追加、依存追加)は、この前提があるときに意味を持つ。

ただし bounded なら自動マージ、ではない。第 1 層のハードルール(機微パス、不可逆操作、CI 弱体化、計画外ファイル)は bounded にもかかる。認証まわりの 1 ファイル修正は bounded だが、DENY_PATHS に当たるので人間。第 2 層も通過して初めて自動マージ候補になる。

### 6.5 分類を一次入力に使うときの注意

- 分類は AI が行い、声に出して宣言する設計。スキルは「When in doubt between two paths, take the heavier one」と定めている。ゲート側でもこの原則を引き継ぎ、分類が不確かな場合は人間に回す。
- 分類は一方向にしか変わらない。実行中に隠れた複雑さが見つかれば bounded から architectural へ格上げされ、格下げはない。格上げが起きた変更はセクション 5 の擬似コードで HUMAN に落ちる。
- Ona の事例にある「自己分類の禁止」との整合が課題。Superpowers では実装する同じセッションが分類する。厳密にするなら、分類だけ別コンテキストのエージェントに再判定させ、両者が一致した場合だけ bounded として扱う二重判定が候補。

### 6.6 最初に bounded だけを対象にする実務上の理由

Bounded は件数が多く、1 件あたりのレビュー負荷が小さい変更。ここが自動化されるとスループットへの効きが大きく、失敗しても戻しやすいので、shadow mode で判定精度を測る母集団としても適している。Architectural を自動化対象に含めるかどうかは、bounded で実績が積み上がった後に判断する方が安全。

## 7. Superpowers 6.3.0 一次情報メモ(ローカルインストール版を直接読解)

- バージョン: 6.3.0(RELEASE-NOTES: 2026-08-12)。作者 Jesse Vincent(obra)。MIT。
- README: 「a complete software development methodology for your coding agents, built on top of a set of composable skills and some initial instructions」。基本ワークフローは brainstorming → using-git-worktrees → writing-plans → subagent-driven-development または executing-plans → test-driven-development → requesting-code-review → finishing-a-development-branch。
- スキル一覧(14): brainstorming, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, writing-skills。
- brainstorming: spike / bounded / architectural の 3 分類。全経路で HARD-GATE(「Do NOT invoke any implementation skill, write any code ... until you have told your human partner what you intend and they have approved it」)。「迷ったら重い方」「途中で判明した複雑さは格上げのみ」。Architectural は spec を `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` に保存し、spec self-review(placeholder、矛盾、曖昧さ、スコープ)を行う。
- writing-plans: 計画は `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`。Task Right-Sizing 「レビュアーが隣のタスクを承認しつつ当該タスクだけ却下できる粒度」。各タスクに Files(Create / Modify / Test)と Interfaces(Consumes / Produces)を明記。No Placeholders(TBD、TODO、「適切なエラー処理を追加」などは計画の失敗)。Self-Review(spec coverage / placeholder scan / type consistency)。計画ヘッダに `Spec:` ポインタ。
- executing-plans: STOP 条件 = blocker(依存欠落、テスト失敗、不明な指示)、計画の重大な欠落、指示を理解できない、検証の繰り返し失敗。「Ask for clarification rather than guessing」。main/master での実装は明示同意なしに禁止。
- subagent-driven-development: タスクごとに新規 implementer サブエージェント、タスクレビュー(spec 準拠 + コード品質)、最後に全体レビュー。「Continuous execution: Do not pause to check in with your human partner between tasks」。「Rulings, not stalls」: 矛盾や曖昧さは裁定して ledger に `Ruling: <what> — <why> — <what it costs if wrong>` として記録し続行。止まるのは 4 つだけ: 不可逆または破壊的操作、セキュリティ機微な操作、worktree 外への副作用(merge、共有ブランチへの push、publish)、全経路が推測になるほど壊れた計画。fix round 上限 5(R≤3 は同じ implementer を再開、R≥4 は新規 implementer とより高性能なモデル)。implementer と reviewer は自分でサブエージェントを起動できない(重複レビュー防止)。
- requesting-code-review / code-reviewer.md: レビュアーは読み取り専用で、git SHA 範囲と計画を渡す。チェック観点: Plan alignment、Code quality、Architecture(security 含む)、Testing、Production readiness(migration、backward compat、docs)。出力: Strengths / Issues(Critical: bugs, security, data loss, broken functionality / Important: architecture, missing features, error handling, test gaps / Minor: style, optimization, docs)/ Recommendations / Assessment(Ready to merge? Yes | No | With fixes)。Critical は即修正、Important は先に進む前に修正、Minor は後回し可。
- finishing-a-development-branch: full test suite → 環境検出 → base branch 確認 → 3 択メニュー(merge locally / push + PR / keep as-is)を提示して人間の回答を待つ。「Integration is your human partner's decision」。discard は人間が `discard` と打った場合のみ。
- verification-before-completion: 「NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE」。「Agent said success」は証拠にならず独立検証が必要。
- RELEASE-NOTES 6.3.0 の要点: 「Ceremony now scales to the task」(3 分類の導入、#2063)。「Controllers no longer stall on plan conflicts」(#2077)。「Plans carry a Spec: pointer」(#2086)。

## 8. 前提と未解決事項

### 8.1 調査中に置いた前提

- 依頼者は単独の開発者で、二者レビューの「別人」は用意できないと仮定。分離原則を「実装エージェント ≠ 新規コンテキストのレビューエージェント + 人間の事後サンプリング」に置き換えている。
- 対象は GitHub 上のリポジトリで、rulesets と GitHub Actions が使えると仮定。
- Superpowers は 6.3.0(2026-08-12)を前提。
- 「マージ」は main への統合を指し、本番デプロイは別のゲートがあると仮定。デプロイまで自動化する場合は可逆性とロールバック手段の軸をさらに重くする必要がある。

### 8.2 確認できなかった点

- claude.com、rewind.com、rootly.com、intercom.com、ona.com、customer.io、arxiv.org、engineering.fb.com の各記事は直接アクセスできず、複数の検索スニペットで内容を突き合わせた。数値は原文で再確認すること。
- Stripe の Minions が依存更新などを自動マージしているという記述は二次ブログにのみあり、Stripe 自身の記事は「人間がレビューしてからマージ」と書いている。自動マージの先例としては数えていない。
- 「Claude Approvals」という名称の公開製品や GitHub check は見つからなかった。Anthropic の Code Review は判定をブロックしない設計。
- OpenSSF Scorecard は「AI/ML ボットのレビューは code review と数えない」と明記している。外部監査や OSS 公開を意識するなら、人間サンプリングの記録が必要。

### 8.3 依頼者が決める必要のある判断事項

- DENY_PATHS の中身。特に「CI 設定」「パッケージマニフェスト」を常時人間にするか、依存更新レーンだけ例外にするか。
- レビュアーエージェントの確信度閾値と、shadow mode から昇格させる連続成功数。Meta は LLM レビュアーの確信度 8/10 以上、Intercom はパイロット 100 件超で判断している。
- 「bounded」の中でさらに自動化対象を絞るか。最初は docs・test・整形・clean revert・依存 patch だけを自動にし、振る舞いを変える bounded 変更は shadow に留める選択肢がある。
- サンプリング監査の頻度と割合。Anthropic は「リスク加重サンプル」と表現しているが、具体的な割合は公開されていない。
- Superpowers の brainstorming HARD-GATE と finishing-a-development-branch の統合メニューを、この基準で条件付きに書き換えるかどうか。書き換えるなら自前のフォークかローカルスキルの上書きになる。

## 9. リポジトリ名の検討(結果: `ship-or-ask` を採用)

| 名前 | 由来と含意 | 向き不向き |
|---|---|---|
| `ship-or-ask`(採用) | 判定の出力がそのまま名前。「AI が作った変更を ship するか、人間に ask するかを決めるゲート」 | 説明不要。判定ラベルを `ship` / `ask` / `shadow` にすればコードと名前が揃う |
| `merge-ratchet` | 「格上げは一方向」と段階的な自動化拡大の両方を「ラチェット」で表す | 設計思想が濃い。初見では判定ゲートと分かりにくい |
| `two-way-door` | Bezos の可逆性の枠組み | 覚えやすいが可逆性以外の軸が名前に含まれない |
| `landing-gate` | Meta RADAR や Chromium の「land」+ ゲート | 業界用語に馴染むが一般的で衝突しやすい |
| `bounded-lane` | bounded 分類だけを自動レーンに乗せる最小構成 | トレーサーブレッツの範囲に正確。将来狭くなる |
| `trust-ladder` | タスク種別ごとに shadow → auto へ昇格する「信頼の梯子」 | 実績管理の側面が主役。拡張の名前に近い |

---

# 付録 A. 調査エージェント原文レポート: リスクベースのレビュー枠組み(英語)

Note on method: the research sandbox's egress proxy blocks most primary hosts (google.github.io, dora.dev, slsa.dev, csrc.nist.gov/nvlpubs, arxiv.org, engineering.fb.com, dl.acm.org, ieee, researchgate, web.archive.org). Where the canonical page was blocked, content was verified through the canonical source repository on GitHub (the eng-practices, dora.dev, slsa, and scorecard sites are all built from GitHub repos whose raw files could be read), through PDFs that could be downloaded and extracted, or, where noted, through multiple independent search results only. Each item states its verification level.

## 1. ITIL 4 Change Enablement (AXELOS practice guide)
- URL: https://s3.amazonaws.com/thinkific/file_uploads/381835/attachments/491/75a/635/Change-enablement.pdf (a hosted copy of the AXELOS "Change enablement ITIL 4 Practice Guide", Jan 2020). Canonical publisher page is axelos.com (paywalled). Verified: full PDF downloaded and text-extracted.
- What it says: Defines three approaches. Standard change: "A low-risk, pre-authorized change that is well understood and fully documented, and which can be implemented without needing additional authorization." Key mechanics: when the procedure for a standard change is created or modified it "should be authorized and undergo a full risk assessment"; that assessment "does not need to be repeated for every change; it is needed only if the procedure itself undergoes another modification." Examples: service-request fulfilment, infrastructure maintenance, "routine software updates." Normal change: goes through assessment/authorization by a change authority ("A person or group responsible for authorizing a change"); for low-risk normal changes the authority is "someone who can make rapid decisions, often using automation," while high-risk ones may go to "the management board." Emergency change: "A change that must be introduced as soon as possible"; models "often include bypassed or delayed procedures," but "'Emergency' does not mean 'no rules or control'." Change models ("A repeatable approach to the management of a particular type of change") are defined by factors such as "systems/technologies to change," "scale of change," "locations/territories," "customers," "regulatory requirements," and set the "level of formalization" and "level and form of the change authority." Explicitly warns that CABs "often become bottlenecks" and says authority should be delegated "to the appropriate level, such as development teams, technical experts, or service and product owners"; assessment and authorization "may be done manually, automatically, or skipped for specific types of change." Also notes CI/CD organizations "often automate most of the change enablement practice processes."
- Signals/criteria named: risk level, prior authorization of the procedure (not the instance), documentation completeness, repeatability, scale, systems touched, regulatory scope, whether a pre-tested solution exists.

## 2. Google Engineering Practices, Code Review guide
- URLs (canonical): https://google.github.io/eng-practices/review/reviewer/standard.html, .../reviewer/looking-for.html, .../reviewer/speed.html, .../developer/small-cls.html, .../emergencies.html. Verified via the source repo: https://github.com/google/eng-practices (raw review/reviewer/*.md, review/developer/small-cls.md, review/emergencies.md).
- Standard: "reviewers should favor approving a CL once it is in a state where it definitely improves the overall code health of the system being worked on, even if the CL isn't perfect." Technical facts and style guide override opinion; optional comments are prefixed "Nit:".
- Looking for: design (does the change belong, do interactions make sense), functionality (edge cases, concurrency), complexity (avoid "over-engineering"; code that "can't be understood quickly"), tests (must "actually fail when the code is broken"), naming, comments ("explain why"), style, consistency, documentation, plus "every line," the surrounding context, and calling out good things.
- Speed: "Most complaints about the code review process are actually resolved by making the process faster"; respond within one business day; approve with unresolved minor comments ("LGTM with comments"); ask to split oversized CLs.
- Small CLs: "one self-contained change"; ~100 lines is reasonable, 1000 is "usually too large"; spread across 50 files is worse than 200 lines in one file; reviewers may "reject your change outright for the sole reason of it being too large." Exceptions: whole-file deletions and changes from "trusted automatic refactoring tools where review is mainly verification."
- Emergencies: only a "small" CL fixing a severe production bug, security hole, legal issue or preventing a launch rollback; reviewers then prioritize "speed of the review and the correctness of the code" and do a thorough follow-up review. Not emergencies: soft deadlines, end-of-week, timezone inconvenience, rollbacks.
- Signals: line count, file count, self-containedness, test presence/quality, whether generated by trusted tooling, emergency classification.
- Related empirical paper (verified via search only): Sadowski et al., "Modern Code Review: A Case Study at Google" (ICSE-SEIP 2018): median 1 approver, fewer than 25% of changes have more than one reviewer, ~20k changes/workday, small changes get first feedback in under an hour.

## 3. DORA, metrics and "Streamlining change approval"
- URLs (canonical): https://dora.dev/capabilities/streamlining-change-approval/ and https://dora.dev/guides/dora-metrics/. Verified via source repo https://github.com/dora-team/dora.dev (raw hugo/content/capabilities/streamlining-change-approval/index.md, hugo/content/guides/dora-metrics/_index.md, hugo/content/insights/dora-metrics-history/index.md).
- Change approval: "formal change management processes that require the approval of an external body such as a change advisory board (CAB) or a senior manager have a negative impact on software delivery performance"; "no evidence was found to support the hypothesis that a more formal, external review process was associated with lower change fail rates"; more approvals cause "less frequent releases of large batches, with an accompanying higher impact on the production system." Recommendation: "Use peer review to meet the goal of segregation of duties, with reviews, comments, and approvals captured in the team's development platform," backed by automated tests and early detection of regressions/security issues; CAB becomes a coordinator, not an approver. Pitfalls: "Treating all changes equally" ("when all changes are subject to the same approval process, change review is inefficient"), relying on a central CAB to catch errors, "Responding to problems by adding more process." Measure: share of changes needing manual approval, approval wait time, proportion needing external review, team confidence in the process.
- Metrics (current five): Change lead time: "time it takes for a change to go from committed to version control to deployed in production"; Deployment frequency; Failed deployment recovery time; Change fail rate: "ratio of deployments that require immediate intervention following a deployment"; Deployment rework rate (added 2024): "ratio of deployments that are unplanned but happen as a result of an incident in production." "speed and stability are not tradeoffs." Legacy benchmark bands (Accelerate era, verified via search only): CFR Elite 0-15%, lead time Elite < 1 day.
- Related book finding (verified via search only, Forsgren/Humble/Kim Accelerate): external approvals "negatively correlated with lead time, deployment frequency, and restore time, and had no correlation with change fail rate."
- Signals: batch size, approval latency, per-change risk classification, whether review happens in-tool at check-in.

## 4a. SLSA, Source track two-party review
- URL (canonical): https://slsa.dev/spec/v1.2/source-requirements. Verified via source repo: https://github.com/slsa-framework/slsa (raw spec/source-requirements.md, spec/build-requirements.md).
- Source L1 version controlled; L2 continuous history + source provenance attestations; L3 "continuous enforcement via technical controls" (branch protections must be applied continuously; a lapse requires re-establishing continuity); Source L4 "Two-party review": "Changes in protected branches MUST be agreed to by two or more trusted persons prior to submission." Acceptable: "Uploader and reviewer are two different trusted persons" or "Two different reviewers are trusted persons." Applies "to the final revision submitted... if additional changes are made during the review process, those changes MUST be reviewed as well." "Reviews SHOULD cover, at least, security relevant properties of the code." Notably, an organization "MAY choose to grant a Trusted Robot a perpetual exception to a policy (e.g. a bot may be able to merge a change that has not been reviewed by two parties)": a formal hook for a pre-authorized automated lane.
- Build track (L1-L3) has no review requirement; the spec says the v0.1 producer/source requirements "were removed in the v1.0 specification" and returned as the separate Source track.
- Signals: trusted-person count, independence of uploader vs approver, review of final revision, robot exception policy.

## 4b. OpenSSF Scorecard, Code-Review check
- URL: https://github.com/ossf/scorecard/blob/main/docs/checks.md (Code-Review and Branch-Protection sections). Verified: fetched directly.
- Risk: "High (unintentional vulnerabilities or possible injection of malicious code)." Looks at ~30 recent changesets for GitHub/GitLab approvals or merger != committer, Prow "lgtm"/"approved" labels, Gerrit "Reviewed-on"/"Reviewed-by". Scoring is "leveled instead of proportional": unreviewed bot changes -3; one unreviewed human change -7, several -10. Crucially: "Review by bots, including bots powered by artificial intelligence / machine learning (AI/ML), do not count as code review." Branch-Protection tiers: Tier 2 requires "at least 1 reviewer for approval before merging"; Tier 4 requires "at least 2 reviewers" plus "review from code owners."
- Signals: human-approval presence, author-vs-merger identity, bot authorship (Dependabot/Renovate treated separately and more leniently), required-reviewer counts, CODEOWNERS.

## 5. NIST SP 800-218, SSDF v1.1
- URL (canonical): https://csrc.nist.gov/pubs/sp/800/218/final (PDF: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf). Verified via a verbatim mirror of the practice text at https://github.com/cdfoundation/CICD-Cybersecurity (content/en/docs/Phase 3/ssdf/ssdf-pw/_index.md, ssdf-ps/_index.md) plus matching text in ciso-assistant and cdxgen SSDF templates.
- PW.7 "Review and/or Analyze Human-Readable Code": PW.7.1: "Determine whether code review (a person looks directly at the code to find issues) and/or code analysis (tools are used to find issues in code, either in a fully automated way or in conjunction with a person) should be used, as defined by the organization." PW.7.2: "Perform the code review and/or code analysis based on the organization's secure coding standards, and record and triage all discovered issues and recommended remediations in the development team's workflow or issue tracking system." PS.1.1: store all code "based on the principle of least privilege so that only authorized personnel, tools, services, etc. have access." PW.8: decide whether and which executable-code testing to do; document results. The SSDF is deliberately outcome-based: it lets the organization decide human vs. automated review, which is a useful compliance anchor for a risk-tiered gate.
- Signals: organization-defined criteria for when human review is required; secure-coding-standard conformance; issue tracking of findings; access control on code.

## 6. Industry / academic risk scoring of changes

### 6a. Meta, Diff Risk Score (DRS)
- URL: https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/ (Aug 6, 2025). Companion paper: "Moving Faster and Reducing Risk: Using LLMs in Release Deployment," https://arxiv.org/abs/2410.06351; TOSEM 2025 paper "Leveraging Risk Models to Improve Productivity for Effective Code Un-Freeze at Scale," https://dl.acm.org/doi/full/10.1145/3722216. Verified via multiple independent search results and third-party notes only (pages blocked).
- Fine-tuned Llama model that "evaluates code changes and metadata to produce a risk score" in [0,1] predicting a production incident (SEV), and highlights risky hunks via attention. Powers "approximately 20 risk-aware features" including "accept-to-ship," code-freeze management and "risk-aware reviewer recommendation." Winter 2023 code freeze: gating only the riskiest 16% of changes let "42% more changes" land with a "52% decrease in outages." From the arXiv paper: a logistic-regression baseline captures 18.7% / 27.9% / 84.6% of SEVs when gating the top 5% / 10% / 50% riskiest diffs; risk-aligned LLMs capture more. Teams "tune thresholds and policies based on their tolerance for risk." The TOSEM paper adds per-file risk plus change properties, un-freezing "2 and 2.5 times more changes."
- Signals: diff content, diff metadata, per-file historical risk, change properties; test-file changes treated as low-signal.

### 6b. Meta, RADAR (Risk Aware Diff Auto Review)
- URL: https://arxiv.org/abs/2605.30208 "Automating Low-Risk Code Review at Meta: RADAR, Risk Calibration, and Review Efficiency" (2026). Verified via multiple search results only (arXiv blocked).
- The closest published precedent for an auto-merge gate: a "multi-stage funnel that classifies each diff by authorship and source type, applies eligibility gates, static heuristics, a machine-learned Diff Risk Score, LLM-based Automated Code Review, and deterministic validation before landing qualifying changes." Eligibility rules "vary by authorship and automation source type." Reported: 535K+ diffs reviewed, 331K+ landed; relaxing the DRS threshold from the 25th to the 50th percentile raised approve rate to 60.31%; RADAR-landed diffs show a revert rate ~1/3 and production-incident rate ~1/50 of non-RADAR diffs; median time-to-close down >330%, review wall time down 35%. Third-party notes cite an LLM-reviewer confidence threshold of >=8/10 and a landing-delay escape hatch. Listed "safe signals": refactor without behavior change, dead-code removal, logging, formatting, docs/comments, import hygiene, test additions, static resources; "risk signals": high review-effort score, substantial structural change, detected bugs, performance risk, secrets exposure.
- Signals: author type (human/bot/AI), source of automation, DRS percentile, static heuristics on diff type, LLM review verdict + confidence, deterministic validation (CI).

### 6c. Mockus & Weiss (Bell Labs, 2000), "Predicting risk of software changes"
- URL: https://mockus.org/papers/bltj13.pdf (Bell Labs Technical Journal 5(2):169-180). Verified via search results and secondary notes only (PDF host blocked).
- The founding change-level risk model (5ESS switch). Predictors: "size in lines of code added, deleted, and unmodified"; "diffusion of the change... number of files, modules, and subsystems touched"; "several measures of developer experience"; type of change (fault fix vs new code); interval. Finding: "change diffusion and developer experience are essential to predicting failures." Intended use is exactly a review gate: "The risk value can be used by developers to decide if a review is needed or additional testing activities should be performed."

### 6d. Kamei et al. (TSE 2013), Just-in-Time defect prediction
- URL: https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_TSE2013.pdf (IEEE TSE 39(6):757-773). Verified via search results; the 14-metric table verified from a reproduction dataset README https://github.com/oh-gnues/explainable-bug-prediction-workbench (Datasets/kamei_metrics/README.md) and implementations such as https://github.com/AI4Code-HUST/VulGuard (Kamei14.py).
- The canonical 14 change metrics in 5 dimensions. Diffusion: NS (subsystems), ND (directories), NF (files), Entropy (spread of changed lines across files); Size: LA (lines added), LD (deleted), LT (lines in files before change); Purpose: FIX (is a bug fix); History: NDEV (developers who touched the files), AGE (average interval since last change), NUC (unique prior changes to the files); Experience: EXP (author's total changes), REXP (recency-weighted), SEXP (author's changes in the subsystem). Results on 6 OSS + 5 commercial projects: ~68% accuracy, ~64% recall; effort-aware: inspecting 20% of changes finds ~35% of defect-inducing ones.

### 6e. Bird et al. (Microsoft Research), code ownership
- URL: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ownership.pdf ("An Analysis of the Effect of Code Ownership on Software Quality across Windows, Eclipse, and Firefox"). Verified: PDF downloaded and text-extracted.
- Defines a minor contributor as one with <5% of a component's commits; metrics Minor, Major, Total, Ownership (top owner's share). Finding: "The number of minor contributors has a strong positive relationship with both pre- and post-release failures even when controlling for metrics such as size, churn, and complexity." Explicit policy recommendation: "Changes made by minor contributors should be reviewed with more scrutiny... When possible, major contributors should perform these code inspections." Directly applicable: an AI agent is by construction a "minor contributor" to most components.

### 6f. Facebook, Predictive Test Selection (ICSE-SEIP 2019)
- URL: https://arxiv.org/abs/1810.05286 (Machalica et al.). Verified via search results and a replication repo https://github.com/maropu/predictive-testing that cites and reimplements the features.
- Gradient-boosted decision trees predict per-test failure probability; catches "more than 99.9 percent of all regressions while running just a third" of transitively affected tests. Features: file change history (commit counts over recent windows), "file cardinality" (files touched), target cardinality, file extensions, "number of distinct authors," historical failure rates, project name, number of tests, "minimal distance between files and targets" in the dependency graph, common path tokens.

### 6g. Google, "Taming Google-Scale Continuous Testing" (ICSE-SEIP 2017)
- URL: https://research.google/pubs/pub45861/ ; DOI https://doi.org/10.1109/ICSE-SEIP.2017.16 (Memon et al.). Verified via search results only.
- Findings: tests that fail are generally "closer" to the code they test in the dependency graph; "frequently modified code and certain users/tools cause more breakages"; code "recently modified by multiple developers (more than 3) breaks more often." Signals: dependency distance, file change frequency, number of recent distinct developers, author/tool identity, language.

### 6h. Uber, SubmitQueue ("Keeping Master Green at Scale," EuroSys 2019)
- URLs: https://doi.org/10.1145/3302424.3303970 ; open-source repo https://github.com/uber/submitqueue. Repo README verified directly; paper details via search results only.
- A merge queue that "speculatively rebases and validates multiple changes in parallel" and "isolates the offending change and retries the rest." The paper's probabilistic model is logistic regression over ~100 hand-picked features (97% accuracy) using "reviews, authors, and modified files"; strongest features were prior speculation successes and revert/test-plan history. Important design note: ML only prioritizes speculative builds; landing itself stays deterministic (CI must pass). Scale: thousands of commits/day.

## 7. Blast radius / criticality tiering
- Google, "Building Secure and Reliable Systems," ch. 7 "Design for a Changing Landscape": https://google.github.io/building-secure-and-reliable-systems/raw/ch07.html. Verified via source repo (raw.githubusercontent.com/google/building-secure-and-reliable-systems/master/raw/ch07.html). Keep changes "as small and standalone as possible"; "Avoid the temptation to tie a change to unrelated improvements"; use feature flags so the system "should exhibit no change in behavior when the feature is turned off"; frequent releases mean "each release contains fewer changes, which are therefore less likely to require rollback"; roll out speed should scale with severity ("hours or days" for critical fixes, "team by team" otherwise). Related SRE Workbook chapter "Canarying Releases" (https://sre.google/workbook/canarying-releases/, verified via search only) defines canarying as a partial, time-limited deployment to a small population before broad rollout.
- Atlassian Jira Service Management, "What are service tiers?": https://support.atlassian.com/jira-service-management-cloud/docs/what-are-service-tiers/. Verified via search results only (host blocked). A service tier "indicates how critical a service is to the operation of your business"; Tier 1 = "a failure of that service will result in a significant impact to customers or to the company's bottom line"; Tier 2 = degraded experience but not total loss; tiers 3-4 lower. Atlassian's change-management guide says change requests can be classified as standard/normal/emergency "or by service tier and dependencies," with automation to "automatically calculate the level of risk" and route approvals.
- Uber service tiers T0-T5: "Uber's Failover Architecture" https://arxiv.org/abs/2603.07345 (2026). Verified via search results only. ~6,000 microservices "organized into business-criticality tiers T0 (higher-priority aka critical) to T5 (lower-priority)" with tiered SLAs; only the most critical retain instantaneous failover guarantees. Demonstrates a concrete Tier-0/1/2 ownership model usable as a change-blast-radius input.
- Deterministic blast-radius signals (practitioner note): https://github.com/KyleKing/wavez (_ai_/notes/is-it-risky-deterministically.md), verified directly. Proposes two cheap deterministic signals: "capability delta" (does the diff introduce a new dangerous operation class: subprocess, eval, SQL, network, file writes, auth edits) and "module-level blast radius" (transitive importer count via grimp / dependency-cruiser), while concluding "The industry has no deterministic 'is this diff safe' oracle": such signals "can only narrow risk, never prove safety."

## Also relevant (verified via search results)
- Dependabot auto-merge convention: https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions : widespread policy of auto-merging semver-patch/semver-minor updates (via dependabot/fetch-metadata update-type) after CI passes, while semver-major requires a human: a de-facto "standard change" lane.
- GitHub Blog, "Agent pull requests are everywhere. Here's how to review them.": https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/ : checklist for AI-agent PRs: treat any weakening of CI as a blocker (removed/skipped tests, `|| true`, changed coverage thresholds, workflows no longer running on PRs, CI steps newly gated behind conditions); watch for duplicated logic, "hallucinated correctness," scope creep.
- Cortex, "A Practical Guide to Risk-Based Code Review": https://www.cortex.io/post/risk-based-code-review : route "human attention by risk"; light/automated review for low-risk, deep review for anything "touching a hot path, anything security- or data-adjacent, anything meant to run for years."

## Searched for but could NOT verify / could not read
- Could not read the pages themselves (blocked) for: engineering.fb.com DRS post, arXiv RADAR / 2410.06351 / 1810.05286 / Uber-failover, dl.acm.org papers, mockus.org PDF, Kamei PDF, Atlassian service-tiers page, cortex.io, github.blog. Existence and key claims were cross-checked against >=2 independent search results each, but exact wording beyond the quoted snippets is unconfirmed.
- No official DORA page that defines a risk-tiered approval scheme; DORA only names "treating all changes equally" as a pitfall.
- SLSA v1.0 requirements.md at the expected path no longer exists in the repo (spec reorganized into spec/build-requirements.md, spec/source-requirements.md); the v1.0 page on slsa.dev was unreachable.
- Could not find a public Google document describing "risk-aware review" or per-CL risk scoring for human-review gating (only Rosie's pattern-based auto-approval for mechanical changes, cited second-hand, and TAP test selection).
- Could not find an Atlassian page with formal Tier-3/Tier-4 definitions (only Tier 1/Tier 2 text surfaced).
- Sadowski et al. "Modern Code Review: A Case Study at Google": existence and headline stats confirmed by search, but the paper/slides were unreachable.

---

# 付録 B. 調査エージェント原文レポート: AI エージェントの自律度・人間監督・権限モデル(英語)

Note on verification: the research sandbox's egress proxy blocked direct fetches of many domains (anthropic.com, claude.com, github.blog, docs.github.com, openai.com, cursor.com, docs.devin.ai, arxiv.org, stripe.dev, rewind.com, nist.gov, iso.org, and several others). For those, the URL and content were confirmed via multiple search-engine result snippets quoting the page (marked "search-verified"). Items marked "fetched" were read directly. GitHub-hosted mirrors (raw.githubusercontent.com) were fetchable and used where possible.

## 1. Anthropic / Claude Code

### 1a. Claude Code docs: "Choose a permission mode" (fetched)
https://code.claude.com/docs/en/permission-modes
Defines six modes with the tradeoff stated as "convenience vs. oversight": default (Manual; "Reads only" run without asking; "Best for: Reviewing every action yourself, sensitive work"), acceptEdits (file edits + mkdir/mv/cp auto-approved), plan (read-only exploration; "Claude Code blocks edits until you approve a plan"), auto ("Everything, with background safety checks": a second model, the classifier, reviews actions instead of you; default on Pro/Max/Team), dontAsk ("Only pre-approved tools", for "Locked-down CI and scripts"), bypassPermissions ("Everything", "Isolated containers and VMs only"). Key gating signals it names: a set of "Actions no mode auto-approves" (explicit ask rules, tools requiring user interaction, rm/rmdir on critical paths, org connector tools set to ask); "Protected paths" that are never auto-approved except in bypass; and "Deny rules block in every mode, including bypassPermissions." The "Common setups" table maps goals to modes and required isolation (e.g., CI with exact allowlist -> dontAsk --allowedTools; fully unattended -> skip-permissions flag only inside a container/VM as non-root).

### 1b. Claude Code docs: "Configure permissions" (fetched)
https://code.claude.com/docs/en/permissions
Tiered permission system per tool type (read-only: no approval; Bash: approval except built-in read-only commands; edits: approval; etc.), with allow/ask/deny rules that can be checked into version control. Relevant for a gate: permission rules are a declarative, auditable policy layer that sits above the mode.

### 1c. Claude Code docs: "Hooks" (fetched)
https://code.claude.com/docs/en/hooks
Hooks are the mechanism for programmatic gating. PreToolUse, PermissionRequest, UserPromptSubmit, Stop, PostToolBatch, ConfigChange can block; a hook returns permissionDecision: "allow" | "deny" | "ask" with a reason, or exit code 2 to hard-block. Five handler types: command, http, mcp_tool, prompt (send to Claude for evaluation), and agent (spawn a subagent for verification). The docs explicitly frame PreToolUse for pre-execution validation and PermissionRequest for "explicit approval gating." A Stop hook that blocks stopping is a natural "verification before completion" gate.

### 1d. Claude Code docs: "Code Review" (the GitHub check run) (fetched)
https://code.claude.com/docs/en/code-review
This is the closest thing to a "Claude Approvals" check; the check run is named "Claude Code Review" (no product named "Claude Approvals" was found). Severity levels: Important ("A bug that should be fixed before merging"), Nit ("worth fixing but not blocking"), Pre-existing. Crucially: "Findings are tagged by severity and don't approve or block your PR, so existing review workflows stay intact" and "The check run always completes with a neutral conclusion so it never blocks merging through branch protection rules. If you want to gate merges on Code Review findings, read the severity breakdown from the check run output in your own CI." It documents a machine-readable last line (bughunter-severity: {"normal": N, "nit": N, "pre_existing": N}) parseable with gh api ... | jq; "a non-zero normal value means Claude found at least one bug worth fixing before merge." REVIEW.md lets you redefine what "Important" means per repo (e.g., "findings that would break behavior, leak data, or block a rollback"), add skip rules for "machine-authored branches," and set a "verification bar" (require file:line citations).

### 1e. Claude Code docs: "GitHub Actions" (fetched) and claude-code-action security docs (fetched)
https://code.claude.com/docs/en/github-actions ; https://github.com/anthropics/claude-code-action/blob/main/docs/security.md
The action runs only for triggering actors with write access and rejects bot actors unless allow-listed (prevents agent-triggers-agent loops). Best practice: "Grant the workflow only the permissions it needs, and review Claude's changes before merging." Security doc: "Claude does not create pull requests automatically" by default; it pushes a branch and provides a PR-creation link "ensuring human oversight before any code is proposed for merging." Claude cannot approve or merge PRs.

### 1f. Anthropic research: "Measuring AI agent autonomy in practice" (search-verified; anthropic.com blocked)
https://www.anthropic.com/research/measuring-agent-autonomy
Empirical findings on Claude Code: users approve ~93% of permission prompts (approval fatigue motivates auto mode); full auto-approve used in ~20% of sessions by new users rising to 40%+ with experience; interrupt rates rise 5%->9% with experience; "agent-initiated stops are an important kind of oversight": on complex tasks Claude stops to ask for clarification more than twice as often as humans interrupt it; 99.9th-percentile turn duration nearly doubled (<25 min Oct 2025 -> >45 min Jan 2026). Gate-relevant signal: agent-initiated uncertainty/stops are a usable oversight signal.

### 1g. Anthropic: "Our framework for developing safe and trustworthy agents" (search-verified)
https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents
Principle: "balancing agent autonomy with human oversight ... humans should retain control over how their goals are pursued, particularly before high-stakes decisions are made." Claude Code "has read-only permissions by default ... must ask for human approval before taking any actions that modify code or systems," and "users can grant persistent permissions for routine tasks they trust Claude to handle." Five principles: human control, alignment, security, transparency, privacy.

### 1h. Anthropic: "How Anthropic secures its AI-native software development lifecycle" and "The AI-Native SDLC playbook" (search-verified; claude.com blocked)
https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle ; https://claude.com/blog/the-ai-native-sdlc-playbook
Most directly on point. "Layers of agentic review with human review reserved for regulated and critical code"; "A human approves, and the agent that wrote the code cannot" (separation of duties); "Routine changes go to the engineer, riskier ones to a tech lead." Concrete tiering reported from the playbook: low-risk documentation can merge after deterministic checks; medium-risk application logic needs code-owner review and focused tests; high-risk (authentication, tenant isolation, production infrastructure, cryptography, billing, regulated data) requires a named human approver, a threat-specific reviewer, and a rollback rehearsal. Also: "a fresh context improves code review since Claude won't be biased toward code it just wrote"; hooks used as approval gates; a Claude-powered project security review of design docs against MITRE ATT&CK at the planning stage. Additional snippets: codebase tiered by risk with automation level per tier; new AI reviewers run in shadow mode until trust is earned; REVIEW.md sets the passes (bugs, security, compliance), the evidence requirement, and the 5-nit cap; every approval logged with signals and reasoning; a risk-weighted sample reviewed by humans; roughly a third of the bugs behind past claude.ai incidents would have been caught by the automated processes now in place.

### 1i. Anthropic: "Lessons from Anthropic on building effective human-agent teams" (search-verified)
https://claude.com/blog/building-effective-human-agent-teams
Trust is earned per task type: "Reviewing agent work manually in the beginning to vet quality, provide feedback, and design task verification checklists"; use a "verifier" agent; "Tracking which kinds of tasks each agent has earned autonomy on and expanding scope per task type after repeated successes." This is a concrete model for a progressive auto-merge gate (autonomy graduated by task category and track record).

### 1j. Anthropic engineering: "How we contain Claude across products" and "Building effective agents" (search-verified)
https://www.anthropic.com/engineering/how-we-contain-claude ; https://www.anthropic.com/engineering/building-effective-agents
Containment: blast radius grows with capability; sandbox/VM boundaries as defense in depth alongside permissions. Building effective agents: "Agents can pause for human feedback at checkpoints or when encountering blockers"; recommends "extensive testing in sandboxed environments, along with the appropriate guardrails."

### 1k. Independent evaluation of auto mode's classifier (search-verified; arxiv blocked)
https://arxiv.org/abs/2604.04978 ("Measuring the Permission Gate")
Reports Anthropic's stated 0.4% false-positive / 17% false-negative rate for the auto-mode classifier on production traffic; failure modes when "target scope, blast radius, or risk level is underspecified." Useful caution: an LLM classifier alone is not a sufficient gate for irreversible actions.

## 2. GitHub Copilot coding agent (cloud agent)

### 2a. "Risks and mitigations for GitHub Copilot cloud agent" (fetched via github/docs source on raw.githubusercontent.com)
https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations
"Draft pull requests created by Copilot cloud agent must be reviewed and merged by a human." "Copilot cloud agent cannot mark its pull requests as 'Ready for review' and cannot approve or merge a pull request." "Prevents the user who asked Copilot cloud agent to create a pull request from approving it." When the agent opens a PR under its own identity, "one more approval is required before it can be merged, as long as the repository already requires at least one approval." "By default, workflows are not triggered until Copilot cloud agent's code is reviewed and a user with write access to the repository clicks the 'Approve and run workflows' button." Agent "can only perform simple push operations" to a single branch and "is also subject to any branch protections and required checks."

### 2b. "Configuring settings for Copilot cloud agent" + changelog "Optionally skip approval for Copilot coding agent Actions workflows" (2026-03-13)
https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings ; https://github.blog/changelog/2026-03-13-optionally-skip-approval-for-copilot-coding-agent-actions-workflows/
Repo admins can disable "Require approval for workflow runs," with the warning: "Allowing GitHub Actions workflows to run without approval may allow unreviewed code written by Copilot to gain write access to your repository or access your GitHub Actions secrets." Community discussion (https://github.com/orgs/community/discussions/167493) confirms the prior default treated agent PRs like outside contributors.

### 2c. "Manage rationale, confidence, and approvals" (Copilot automations) (fetched via GitHub source)
https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/manage-rationale-confidence-approvals
A confidence-threshold model for issue automations that is a ready-made template for a gate: each change carries a rationale and confidence; repo "automation level" sets the threshold: Full control ("Every change is held for review"), Cautious (default; "Only high-confidence changes are applied automatically"), Balanced ("Routine, clear-cut changes are applied automatically. Anything with ambiguity is held for review"), Full automation (everything applied except items the agent flags as uncertain). "Changes rated below the threshold are held as suggestions; changes at or above it apply automatically."

## 3. OpenAI Codex, Cursor, Devin, Google Jules

### 3a. OpenAI: "Auto-review of agent actions without synchronous human oversight" (search-verified; openai.com blocked) and Codex "Auto-review" docs
https://alignment.openai.com/auto-review/ ; https://developers.openai.com/codex/concepts/sandboxing/auto-review
Released April 2026: a separate Codex agent "grades" boundary-crossing requests "considering the user's intent, the environment, the security policy, and the likely impact." Rationale for separation: the main agent "is optimized to complete the user's task, creating pressure to treat an approval boundary as just another obstacle." Sessions stop for human approval "roughly 200x less often"; auto-review approves ~99% of actions reaching it. Four harm categories it is trained to block: data exfiltration, credential probing, security degradation, destructive actions "with significant risk of irreversible damage." Four-level risk scheme: low/medium proceed when policy allows; high requires user authorization and no deny rule; critical always denied. Config: approvals_reviewer = "auto_review". A logged failure case (https://github.com/openai/codex/issues/18840) shows a destructive cleanup being auto-approved: evidence that irreversibility should be a hard rule, not left to a classifier.

### 3b. OpenAI: "Agent approvals & security" and "Review GitHub pull requests with Codex" (search-verified)
https://developers.openai.com/codex/agent-approvals-security ; https://developers.openai.com/codex/integrations/github
Approval policies: untrusted (only known-safe ops run automatically), on-request (default), on-failure, never; sandbox modes incl. workspace-write. GitHub integration: Codex posts only P0 (blocking: "security regressions, auth bypass, or data loss") and P1 (must-fix: performance, concurrency, logging sensitive data) findings; follows review guidelines in AGENTS.md. Note: the frequently quoted line "@codex review is not an approval ... sensitive changes such as auth, payment, or data migration still need human confirmation" comes from a third-party blog (https://eastondev.com/blog/en/posts/ai/20260709-codex-ai-code-review-pr/), not OpenAI's docs.

### 3c. OpenAI: "Harness engineering: leveraging Codex in an agent-first world" (search-verified only)
https://openai.com/index/harness-engineering/
Cited in results as the source for mechanical enforcement (linters, structural constraints) over human review; details could not be confirmed.

### 3d. Cursor: "Approval Agents" and "Auto-review run mode" (search-verified; cursor.com blocked)
https://cursor.com/docs/approval-agents ; https://cursor.com/changelog/auto-review ; https://cursor.com/blog/agent-best-practices
Approval Agents "can auto-approve pull requests when your approval criteria are met, or route PRs to reviewers when more review is needed." Inputs: configured approval criteria, per-directory APPROVAL_POLICY.md files (checked for each changed file's directory and ancestors), "risk settings," AI reviewer (BugBot) findings, and current review state. Conflict rule: "follows the most specific policy; if specificity is unclear, it follows the stricter instruction and avoids auto-approval." Auto-review run mode uses a three-tier gate (allowlist -> sandbox -> classifier subagent) and reportedly cut approval prompts by 84%. Best-practices blog: "review the full diff and not approve blindly ... Cloud Agents are an execution surface and do not remove your review responsibility."

### 3e. Devin: "Devin Review" docs and Cognition blog (search-verified; docs.devin.ai blocked)
https://docs.devin.ai/work-with-devin/devin-review ; https://cognition.com/blog/devin-101-automatic-pr-reviews-with-the-devin-api
Devin Review flags bug (likely incorrect behavior), investigate (worth a closer look), and note (informational). Humans can approve, merge, and toggle GitHub auto-merge from the Review UI, but docs state "Devin isn't guaranteed to catch every bug, and it's best to still have a human check your PRs before merging": "an extra set of eyes, not a complete replacement for human oversight." Parallelism guidance: "plan for human review of each PR before merging to main."

### 3f. Google Jules (search-verified; jules.google blocked)
https://jules.google/docs/changelog/
Jules opens a PR that "goes through the team's code review, triggers the CI/CD pipeline"; it does not merge. Third-party guides consistently state plan approval before execution and human review of the final diff.

## 4. Autonomy-level frameworks

### 4a. Google DeepMind, "Levels of AGI: Operationalizing Progress on the Path to AGI" (Morris et al., 2023) (search-verified; arxiv blocked)
https://arxiv.org/abs/2311.02462
Six autonomy levels orthogonal to capability: L0 No AI; L1 AI as Tool (human fully controls); L2 AI as Consultant (substantive role only when invoked); L3 AI as Collaborator (co-equal); L4 AI as Expert (AI drives, human provides guidance/feedback); L5 AI as Agent (fully autonomous). Each level introduces distinct risks; the authors emphasize autonomy should be a deployment choice, not implied by capability.

### 4b. Feng, McDonald, Zhang (UW), "Levels of Autonomy for AI Agents" (2025) (search-verified)
https://arxiv.org/abs/2506.12469
Five levels defined by the user's role: Operator -> Collaborator -> Consultant -> Approver -> Observer. "Autonomy can be treated as a deliberate design decision, separate from capability and operational environment"; proposes "autonomy certificates." Directly maps to an auto-merge gate: the "Approver" role is a human-gated PR; "Observer" is auto-merge with monitoring.

### 4c. Cloud Security Alliance, "Autonomy Levels for Agentic AI" / "Agentic AI Autonomy Levels and Control Framework" (Jan 2026) (search-verified; CSA blocked)
https://cloudsecurityalliance.org/blog/2026/01/28/levels-of-autonomy ; https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/03/agentic-ai-autonomy-levels-control-framework-v2-csa-styled.pdf
Six levels (L0-L5) scored on five dimensions: decision authority, scope, reversibility, impact, temporal duration. L1 Assisted = every action requires explicit human approval; L2 Supervised = autonomous execution within a human-approved plan; L3 Conditional = autonomous decisions within defined boundaries; L4 adds monitoring, anomaly detection, kill switches. Distinguishes autonomy from capability. The five dimensions are usable directly as gate features.

### 4d. Hugging Face smolagents docs, "Introduction to agents", agency levels table (fetched via GitHub source)
https://huggingface.co/docs/smolagents/en/conceptual_guides/intro_agents
Simple processor (LLM output has no impact on program flow) -> Router (controls if/else) -> Tool call / Multi-step agent (controls function execution; controls iteration and continuation) -> Multi-agent / Code agents (can start other agents; acts in code, defines its own tools). Guidance: use deterministic workflows when request categories are predictable; adopt agents only "if the pre-determined workflow falls short too often." Frame: the more the LLM controls flow, the more verification is needed.

### 4e. Tessl, "The 5 levels of AI agent autonomy: learning from self-driving cars" and Swarmia, "Five levels of AI coding agent autonomy, and why higher isn't better" (search-verified)
https://tessl.io/blog/the-5-levels-of-ai-agent-autonomy-learning-from-self-driving-cars/ ; https://www.swarmia.com/blog/five-levels-ai-agent-autonomy/
Coding-specific SAE analogies. Swarmia: L3 "Task agent" (hand off a task, come back to a PR; "introduces automated review gates"), L4 "Approver model" (human interacts only on blockers). Key line: "Auto-merge horror stories are Level 3.5 and Level 4 failures, whereas review-wait bottlenecks are Level 2 failures": pick the level per task, not globally.

### 4f. TrustX "Agent Risk Classification (ARC) Framework" (search-verified)
https://arxiv.org/html/2607.09586v1
Twelve-dimension risk score incl. Autonomy, Blast Radius, Reversibility -> Tier 1 Low / Tier 2 Medium / Tier 3 High with escalating oversight. Similar four-tier action models (read-only / reversible / external / irreversible-high-risk) appear at https://www.mindstudio.ai/blog/classify-ai-agent-actions-by-risk and the "Helmsman pattern" (Tier 1 automated, Tier 2 execute-then-async-review, Tier 3 halt pending human approval) at https://www.baytechconsulting.com/blog/engineering-patterns-secure-agentic-ai-2026.

## 5. NIST AI RMF and ISO/IEC 42001 (briefly)

### 5a. NIST AI RMF 1.0 (NIST AI 100-1) and Playbook (search-verified; nist.gov blocked)
https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf ; https://airc.nist.gov/airmf-resources/playbook/manage/
Relevant subcategories: GOVERN 3.2: "policies and procedures are in place to define and differentiate roles and responsibilities for human-AI configurations and oversight of AI systems" (human-in-the-loop vs on-the-loop vs autonomous is itself a governance decision that must document who decides, when humans must override, and how oversight is evidenced). MANAGE 2.4: "mechanisms are in place ... to supersede, disengage, or deactivate AI systems that demonstrate performance or outcomes inconsistent with intended use." The RMF calls for proportional oversight by impact/risk tolerance rather than fixed tiers.

### 5b. CSA "NIST AI RMF: Agentic Profile" (search-verified)
https://labs.cloudsecurityalliance.org/agentic/agentic-nist-ai-rmf-profile-v1/
Extends RMF with "formal autonomy tier classification with corresponding oversight obligations" (GOVERN), "tool-use risk modeling and action-consequence mapping" (MAP), "runtime behavioral metrics and autonomy calibration" (MEASURE), incident response for drift (MANAGE). States that "data sensitivity, action reversibility, and potential legal or customer impact should dictate the maximum acceptable tier for any workload." Also: UC Berkeley CLTC "Agentic AI Risk-Management Standards Profile" (Feb 2026) https://cltc.berkeley.edu/wp-content/uploads/2026/02/Agentic-AI-Risk-Management-Standards-Profile.pdf (not fetched).

### 5c. ISO/IEC 42001:2023 (search-verified via iso.org and multiple control-guide sites; iso.org blocked)
https://www.iso.org/home/insights-news/resources/iso-42001-explained-what-it-is.html ; https://www.isms.online/iso-42001/annex-a-controls/
Requires an AI management system with AI system impact assessment (Annex A.5; considers "effects on human autonomy and decision-making"), documented risk acceptance criteria, and human oversight built into design/development (A.6.1.3 "includes provisions for testing, human oversight, and impact assessments") and responsible use (A.9). Human oversight is a documented objective with assigned accountability; the standard is framework-level and does not prescribe autonomy tiers.

## 6. Essays and engineering blogs (2025-2026) on auto-merge vs. human review

### 6a. Rewind, "Review is the bottleneck now: How we let AI approve pull requests (safely)" (search-verified; rewind.com blocked)
https://rewind.com/blog/ai-approve-pull-requests-safely/
"Diff Vader" AI reviewer becomes "the only reviewer needed" for "a carefully bounded set of low-risk changes." Central idea: "a PR's risk has almost nothing to do with its line count" ("a twelve-line database migration that adds an index to a fifty-million-row table is one of the most dangerous things you can ship"). Every PR gets LOW / MEDIUM / HIGH "derived from what the review found." Named high-risk signals: locking migrations, IAM scope widening, changes to authentication. Backend ("Death Star") holds "the safety, measurement, and compliance story."

### 6b. Intercom Fin team, "AI is approving our pull requests: here's how we made it safe" (search-verified)
https://ideas.fin.ai/p/ai-is-approving-our-pull-requests ; https://www.intercom.com/blog/ai-is-approving-our-pull-requests-heres-how-we-made-it-safe/
>19% of PRs auto-approved with no human reviewer. Pilot of 100+ PRs: zero reverts of AI-approved PRs; 6-16x faster time-to-approval at p75. AI-authored code reverted ~10x less than human code (backend 0.53% vs 5.39%; frontend 0.22% vs 2.00%). Criteria: evaluates "style consistency, test coverage, security vulnerabilities, and adherence to architectural guidelines"; refuses large/broad-scope PRs and asks for them to be broken down.

### 6c. Rootly, "Why we got rid of our small-PR rule" (search-verified; also covered by InfoQ Aug 2026)
https://rootly.com/blog/why-we-got-rid-of-our-small-pr-rule ; https://www.infoq.com/news/2026/08/rootly-small-pr-agentic-ai/
Replaced "is it small?" with "what happens if this breaks?" Every PR labeled risk:low|medium|high. Internal AI reviewer outputs "a risk assessment, a standardization score, a confidence score, and specific findings grouped by severity." Rewind explicitly adopted this model. Example from the post: a 3,000-line PR behind a feature flag, with no migration, no shared contract changes, shipping to internal users first, is risk:low. For a risk:low PR that scores 5/5 on standards compliance, the review is a quick sanity check; for a risk:high PR with a 3/5 confidence score, the reviewer knows which findings to dig into.

### 6d. Stripe, "Minions: Stripe's one-shot, end-to-end coding agents" (Parts 1 & 2, Feb 2026) (search-verified; stripe.dev blocked)
https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents ; https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2
1,000-1,300 PRs/week "completely minion-produced, human-reviewed, but containing no human-written code." Policy: "at most two rounds of CI before human review is triggered"; if tests pass, the harness opens a PR, "a human engineer reviews the PR. If the review passes, the code merges." Note: several secondary blogs claim Stripe auto-merges dependency bumps/tests; this could not be verified in Stripe's own posts, which describe human review before merge.

### 6e. Augment Code, "From Assisted to Autonomous: How Far Can the Engineering Loop Close?" (July 2026) (search-verified)
https://www.augmentcode.com/guides/autonomous-engineering-loop
"All major agents route output through human approval before code reaches production ... the boundary is merge." Proposes stage-by-stage autonomy decisions; merge gates shifting from a human checkbox to "structured agent sign-off with test coverage thresholds, security scan results, and style compliance reports," with human approval "reserved for high-risk changes, novel architecture choices, and regulated code paths where legal accountability is required."

### 6f. Monperrus, "The End of Code Review: Coding Agents Supersede Human Inspection" (arXiv, June 2026) (search-verified)
https://arxiv.org/abs/2606.13175
Position paper arguing agents "have crossed a threshold of capability at which traditional human code review is no longer a necessary component of a software quality pipeline." Useful as the strongest pro-automation position; rebuttal at https://blakecrosley.com/blog/agents-supersede-the-reviewer ("Agents Supersede the Reviewer, Not the Review").

### 6g. Empirical studies of agentic PRs (search-verified)
"Why Are Agentic Pull Requests Merged or Rejected?" (MSR 2026) https://arxiv.org/abs/2605.22534 : 9,799 agentic PRs; only 35.7% of rejections were clear agentic failures (failing checks/tests, "does not work" comments), 31.2% workflow constraints (duplicates, superseded, inactivity), 33.1% no observable rationale; Codex/Cursor PRs "typically merged with minimal interaction," Copilot/Devin "embedded in reviewer-mediated workflows." "On the Use of Agentic Coding" https://arxiv.org/abs/2509.14745 : 567 Claude Code PRs; 54.9% merged as-is vs 58.5% for humans. Signals for a gate: CI/test pass status, reviewer engagement, duplication, PR description quality.

### 6h. Governance pattern posts (search-verified)
Developers Digest, "Agent PR Governance" https://www.developersdigest.tech/blog/agent-pr-governance-github-copilot-review : rules: only validated agents may open PRs; every agent PR must include task, acceptance criteria, and verification output; no agent PR merges without required checks and a human reviewer; agent branches namespaced (agent/*); env files, CI/CD configs, IaC, and package manifests never agent-writable without explicit human approval. Prediction Guard, "Least agency and blast radius" https://predictionguard.com/blog/least-agency-blast-radius-governance-framework-persistent-ai-agents : least-agency + capped blast radius + reversibility controls.

### 6i. Additional company cases found by the parent session (search-verified; hosts blocked)
- Ona, "How auto-approving low-risk PRs with AI cut our lead time by 74%" https://ona.com/stories/auto-approving-low-risk-prs : time to first approval from 2h49m to 3.8 minutes; lead time down 74%, deploys tripled. Excluded from auto-approval: architecture decisions, auth logic, database migrations. Policy constraint: engineers cannot self-classify a change as low-risk. Prior automation reviewed every PR with an 88% comment acceptance rate.
- Customer.io, "How we taught AI to approve pull requests" https://customer.io/learn/how-we-work/how-we-taught-ai-to-approve-pull-requests : after 500 AI-approved PRs, zero production incidents; merge time from 3.5 hours to 33 minutes. Three components: Context Building, Heuristic Evaluation (complexity, risk, quality, approval thresholds), Review Decision (approve within thresholds, feedback, or escalate to human). Every repo in scope was looked at by a human who decided which paths can never be auto-approved and how large a change can be before it needs human eyes. A PR authored by a non-human can be reviewed by the system but can never be merged without a human clicking the button; that human becomes the accountable shipping engineer. AI was used for the first pass to surface every path that smelled like a tenant boundary, a credential, or an IaC lifecycle change, proposing a per-repo "always require a human" list.
- Macroscope, "What is Approvability?" https://macroscope.com/content/what-is-approvability-auto-approve-safe-pull-requests (vendor content; not read).

## 7. Superpowers (obra/superpowers), fetched from GitHub

Repo / README: https://github.com/obra/superpowers (README fetched; plugin.json version 6.3.0, author Jesse Vincent, MIT).
README description: "a complete software development methodology for your coding agents, built on top of a set of composable skills and some initial instructions." Workflow: brainstorming -> using-git-worktrees -> writing-plans -> subagent-driven-development or executing-plans -> test-driven-development -> requesting-code-review -> finishing-a-development-branch. "The agent checks for relevant skills before any task. Mandatory workflows, not suggestions."

Current skills (14, confirmed from /skills directory): brainstorming, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, writing-skills.

Built-in gating/review criteria found (from SKILL.md files, fetched):
- brainstorming: hard gate: "Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have told your human partner what you intend and they have approved it." Classifies requests as Spike / Bounded / Architectural (announced aloud so the human can override); Architectural work gets a written spec reviewed section-by-section by the human. "Simple means a short design, not no design."
- writing-plans: tasks are "the smallest independently testable unit worth code review"; steps 2-5 minutes each with verification; plan includes a self-review against the spec; offers Subagent-Driven (recommended) or Inline execution.
- executing-plans: review plan critically first, "raise concerns with your human partner before starting"; stop-and-ask triggers: blocker (missing dependency, failing test, unclear instruction), critical plan gaps, repeated verification failure; "Ask for clarification rather than guessing"; never implement on main/master without explicit consent.
- subagent-driven-development: two-stage review per task: spec compliance, then code quality; "never accept a report missing either verdict." Continuous execution is the default; the agent stops only for: (1) an irreversible or destructive operation, (2) a security-sensitive action, (3) a side effect outside the current worktree ("merges, pushes to shared branches, publishes"), (4) a plan so broken every path is guesswork. All ambiguity rulings are logged ("Every adjudication is a ledger entry; a silent discard is forbidden") for human review at the end.
- requesting-code-review: dispatched reviewer subagent with plan + git SHAs; severities Critical (fix immediately) / Important (must resolve before moving on) / Minor (can defer). Critical and Important block progress; "never skip review assuming something is simple."
- verification-before-completion: "Evidence before claims, always"; "If you haven't run the verification command in this message, you cannot claim it passes"; bans hedging ("should", "probably") and trusting agent reports without independent verification.
- finishing-a-development-branch: after tests pass, presents a menu (merge locally / push + PR / keep / discard, discard only on typing the literal word) and "Wait for their answer"; "the integration decision is theirs"; "Confirm before merging: merging into the wrong base is expensive to undo." The agent never merges autonomously.

Net: Superpowers has strong process gates (design approval, plan review, per-task two-stage review, verification evidence, human merge decision) but no risk-scoring or auto-merge criteria; the merge decision is always deferred to the human.

## Could not verify / not found
- Any Anthropic product or GitHub check literally named "Claude Approvals": none found; the check run is "Claude Code Review" (neutral conclusion, never blocks). Community "auto-approve" hooks exist (e.g., froggeric/claude-smart-approval) but are third-party.
- Anthropic platform.claude.com docs page specifically on "when to require human review": only found computer-use prompt-injection classifiers steering to user confirmation (https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool); no standalone guidance page located.
- Claims that Stripe Minions auto-merge low-risk PR categories (dependency bumps, docs): appear only in secondary blogs; Stripe's own posts (search-verified) describe human review before merge.
- OpenAI "Harness engineering" post content on review policy: could not confirm details beyond the title.
- Cursor Approval Agents' exact risk-setting values / thresholds and Devin Review's full docs: cursor.com and docs.devin.ai were blocked; only snippet-level verification.
- Direct text of NIST AI 100-1 and ISO/IEC 42001 Annex A: blocked; verified via multiple secondary control guides and the NIST Playbook site listing.
- Google Jules official docs on plan approval/auto-PR settings: jules.google blocked; only third-party descriptions.
- Blog posts from Google, Meta, Shopify, or Vercel specifically on agent auto-merge policy: none found in searches; Stripe, Rewind, Intercom, Rootly, Ona, Customer.io, and Anthropic were the company sources with concrete policies.

---

# 付録 C. 調査エージェント原文レポート: 「条件を満たせば自動マージ、満たさなければ人間」を実装済みのツールと条件語彙(英語)

Note on verification: several vendor doc hosts (docs.renovatebot.com, docs.github.com, docs.mergify.com, kodiakhq.com, bors.tech, docs.gitlab.com, danger.systems, abseil.io, chromium.googlesource.com, docs.coderabbit.ai, greptile.com, graphite.com/.dev, docs.qodo.ai, forge.rust-lang.org) are blocked by the research sandbox's egress proxy. For those the same document was fetched from its source repository on GitHub and that URL is cited; the canonical URL is given alongside where useful.

## 1. Renovate (Mend) automerge

Automerge concept doc: https://github.com/renovatebot/renovate/blob/main/docs/usage/key-concepts/automerge.md (canonical: docs.renovatebot.com/key-concepts/automerge/)
Renovate's rule of thumb: "enable automerge for any dependency update where you would select 'merge' anyway." It ranks safe classes: lock-file maintenance ("probably the lowest risk type of update"), devDependencies, linter/formatter updates, and non-major updates of packages not on 0.x. The canonical low-risk packageRule is matchUpdateTypes: ["minor","patch"] + matchCurrentVersion: "!/^0/". Preconditions: status checks must exist and pass, no mandatory human review (or a bypass), and it "will only automerge one branch/PR, per target branch, per run."

Configuration options reference: https://raw.githubusercontent.com/renovatebot/renovate/main/docs/usage/configuration-options.md
Condition vocabulary (verbatim option names):
- automerge (default false), automergeType = "pr" | "branch" | "pr-comment" (the last hands off to an external bot such as bors), automergeStrategy (auto/fast-forward/merge-commit/rebase/rebase-merge/squash), automergeSchedule, automergeComment.
- Gate on CI: "Renovate's default behavior is to only automerge if every status check has succeeded"; ignoreTests: true disables that (doc warns against it). With automergeType: "branch" it merges only when "(a) up-to-date with the base branch, and (b) passing all tests", otherwise falls back to raising a PR.
- platformAutomerge (default true): uses GitHub/GitLab native auto-merge; the doc explicitly says you must then enable "Require status checks before merging" in branch protection or "the platform might merge Renovate PRs even if the repository's tests haven't started."
- Age/stability gate: minimumReleaseAge (formerly stabilityDays): while the release is younger than the threshold Renovate posts a pending status check renovate/stability-days, flipping to passing after the period; minimumReleaseAgeBehaviour = timestamp-required | timestamp-optional; internalChecksFilter = none | strict | flexible controls whether pending versions are skipped.
- Matchers usable in packageRules: matchUpdateTypes (major/minor/patch/pin/digest/lockFileMaintenance...), matchCurrentVersion, matchCurrentAge (e.g. "> 2 years"), matchDepTypes (e.g. devDependencies), matchConfidence (["high","very high"], Mend API key required).

Merge Confidence: https://raw.githubusercontent.com/renovatebot/renovate/main/docs/usage/merge-confidence.md
Four badges: Age, Adoption ("percentage of this package's users... using this release"), Passing ("percentage of updates which have passing tests"), Confidence. Levels: low ("we think the update contains breaking changes"), neutral, high, very high ("months old and have either high Adoption or very high test Passing"). Paid workflows can "automerge Very High confidence updates".

## 2. Dependabot auto-merge patterns

GitHub Docs: Automating Dependabot with GitHub Actions: https://github.com/github/docs/blob/main/content/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions.md (canonical: docs.github.com/.../automate-dependabot-with-actions)
Pattern: gate on github.event.pull_request.user.login == 'dependabot[bot]', run dependabot/fetch-metadata, then gh pr review --approve and/or gh pr merge --auto --merge, conditioned on e.g. contains(steps.metadata.outputs.dependency-names, 'my-dependency') && steps.metadata.outputs.update-type == 'version-update:semver-patch'. The doc insists "You should enable Require status checks to pass before merging for the target branch", i.e. --auto only arms GitHub's native auto-merge, which still waits on branch protection.

dependabot/fetch-metadata outputs: https://github.com/dependabot/fetch-metadata
Signals exposed for conditions: update-type (version-update:semver-major|minor|patch), dependency-type (direct:production, direct:development, indirect), dependency-names, dependency-group, package-ecosystem, directory, target-branch, previous-version, new-version, compatibility-score, alert-state (OPEN/FIXED/DISMISSED), ghsa-id, cvss, maintainer-changes (true if the PR body flags a maintainer change: a supply-chain risk signal).

## 3. Mergify

Conditions grammar: https://raw.githubusercontent.com/Mergifyio/docs/main/src/content/docs/configuration/conditions.mdx (canonical: docs.mergify.com/configuration/conditions/)
Grammar: [ "-" ] [ "#" ] <attribute> [ <operator> <value> ]; "-" negates, "#" evaluates list length; operators =, !=, ~= (regex), path-glob match, >=, >, <, <=; combinators and, or, not.

Attribute vocabulary (from the published config schema): https://raw.githubusercontent.com/Mergifyio/docs/main/public/mergify-configuration-schema.json
Review state: approved-reviews-by, changes-requested-reviews-by, commented-reviews-by, dismissed-reviews-by, review-requested, review-threads-resolved, review-threads-unresolved, branch-protection-review-decision. CI: check-success, check-failure, check-neutral, check-pending, check-skipped, check-stale, check-cancelled, check-timed-out, check-success-or-neutral. Diff shape: files, added-files, modified-files, removed-files, #files, commits, #commits, commits-behind, commits-unverified, co-authors, linear-history, conflict. Metadata: author, title, body, label, base, head, head-repo-full-name, draft, locked, milestone, number, created-at/updated-at, schedule, current-datetime. Dependabot-specific: dependabot-dependency-name, dependabot-dependency-type, dependabot-update-type. Queue: queue-position, queue-name, queued-at, queue-dequeue-reason. Typical rule: #approved-reviews-by >= 2, check-success = test, files ~= ^docs/.

Merge queue / merge protections keys (same schema): queue_rules[] have queue_conditions (when a PR may enter) vs merge_conditions (what must hold before merge), branch_protection_injection_mode, batch_size, batch_max_wait_time, checks_timeout, max_checks_retries, merge_method, update_method, autoqueue; merge_protections rules have if + success_conditions (a Mergify-owned status check that fails until conditions hold: a "block until X" primitive); priority_rules have conditions + priority.

## 4. Kodiak, bors-ng, GitHub merge queue, GitLab merge trains

Kodiak config reference: https://github.com/chdsbd/kodiak/blob/master/docs/docs/config-reference.md (canonical: kodiakhq.com/docs/config-reference)
Kodiak "can only merge pull requests passing your GitHub branch protection rules": it delegates review/CI policy to GitHub and adds label/author/title gates: merge.automerge_label, merge.require_automerge_label, merge.blocking_labels, merge.blocking_title_regex (block WIP titles), merge.automerge_dependencies.versions (major/minor/patch) + .usernames (only dependency bots), merge.do_not_merge_forks, merge.dont_wait_on_status_checks, merge.method, merge.prioritize_ready_to_merge, update.always/update.autoupdate_label, and auto-approval by identity: approve.auto_approve_usernames, approve.auto_approve_labels.

bors-ng reference: https://raw.githubusercontent.com/bors-ng/bors-ng.github.io/master/_documentation/reference.md (canonical: bors.tech/documentation/; project archived Apr 2024, README points to GitHub merge queue)
Trust model: only registered reviewers may say bors r+; bors delegate+ lets the PR author self-approve, bors delegate=[list] extends approval rights per-PR; bors r=[list] records who reviewed. bors.toml gates: status (CI contexts that must pass on the staging merge commit), pr_status (statuses that must pass on the PR itself when r+-ed), required_approvals (GitHub review count), up_to_date_approvals (only approvals on the latest commit count), block_labels (labels that forbid r+), timeout_sec, use_squash_merge, delete_merged_branches. "Not Rocket Science Rule": the main branch never breaks because every batch is tested post-merge before fast-forwarding.

GitHub merge queue: https://github.com/github/docs/blob/main/content/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue.md
A PR can be queued only after satisfying all branch-protection/ruleset requirements (required reviews, required checks). The queue then re-runs CI on a merge_group event against gh-readonly-queue/* branches. Settings: merge method, build concurrency (1-100), "Only merge non-failing pull requests", minimum/maximum group size, wait time to meet minimum group size, status check timeout; failing PRs are removed from the queue automatically.

GitLab merge trains: https://github.com/gitlabhq/gitlabhq/blob/master/doc/ci/pipelines/merge_trains.md (canonical: docs.gitlab.com/ci/pipelines/merge_trains/)
Requires merged-results pipelines and the "Pipelines must succeed" setting; approval rules must be satisfied before an MR can join; a failing train pipeline ejects the MR. Notable: "All threads must be resolved" deliberately does not block once queued, and "Merge immediately" bypasses the train for hotfixes (an experimental "Merge immediately without restarting" variant is described for low-risk changes such as documentation).

## 5. GitHub CODEOWNERS, branch protection, rulesets

About code owners: https://github.com/github/docs/blob/main/content/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners.md
gitignore-style patterns -> @user/@org/team; "the last matching pattern takes the most precedence"; with "Require review from Code Owners", "an approval from any of the owners is sufficient". Owners are auto-requested (not on drafts).

Available rules for rulesets: https://github.com/github/docs/blob/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets.md
Verbatim rule names: "Require a pull request before merging" with sub-options Required approvals, "Dismiss stale pull request approvals when new commits are pushed", "Require review from Code Owners", "Require approval of the most recent reviewable push", "Require conversation resolution before merging", Allowed merge methods, "Automatically request Copilot code review", "Additional approval for unattributed Copilot pull requests", and required reviewers per file path (path-scoped reviewer requirements inside a ruleset); "Require status checks to pass" (+ "Require branches to be up to date before merging", "Do not require status checks on creation"); "Require merge queue"; "Require deployments to succeed"; "Require signed commits"; "Require linear history"; "Require code scanning results"; "Require code quality results"; "Restrict code coverage"; "Require workflows to pass before merging"; "Block force pushes"; "Restrict file paths", "Restrict file path length", "Restrict file extensions", "Restrict file size"; metadata restrictions on commit message, author/committer email, branch/tag names; all with bypass lists for users/teams/apps.

## 6. PR-linting: Danger, Reviewpad, reviewdog

Danger JS: https://github.com/danger/danger-js ; Danger (Ruby): https://github.com/danger/danger (canonical: danger.systems)
A Dangerfile asserts on danger.git.modified_files / created_files / deleted_files / lines_of_code / diffForFile / commits and danger.github.pr.title / body / additions / deletions / changed_files / user / labels, emitting fail() (blocks the check), warn(), message(), markdown(). Canonical rules: big PR (lines_of_code > 500), "Please include a CHANGELOG entry", no test files touched when source changed, empty PR body, "WIP" in title, missing issue-tracker link, extra scrutiny for sensitive files.

Reviewpad: https://github.com/GildedHonour/reviewpad__action (fork; original reviewpad/reviewpad repo now 404s; canonical docs docs.reviewpad.com blocked)
reviewpad.yml = rules + workflows with if/then. Built-ins: $size() (rules like $size() <= 50 small / > 150 large), $hasFileName(), $hasFileExtensions(), $containsOnlyFileExtensions([".md"]), $author(), $labels(), $isDraft(), $approvalsCount(), $getCheckRunConclusion("build") == "success", $hasLinkedIssues(); actions $merge(), $approve(), $addLabel(), $assignReviewer(), $fail(), $comment().

reviewdog: https://github.com/reviewdog/reviewdog
Turns linter output into PR gates: -reporter (github-check, github-pr-check, github-pr-review, gitlab-mr-discussion, ...), -filter-mode (added, diff_context, file, nofilter), -level (info/warning/error), and -fail-level=[none,any,info,warning,error]: "exit with code 1 ... if it finds at least 1 issue with severity greater than or equal to the given level" (-fail-on-error deprecated).

## 7. Large-org trust tiering

Google LSC / Rosie (SWE at Google, ch. 22): https://github.com/qiangmzsx/Software-Engineering-at-Google/blob/main/zh-cn/Chapter-22_Large-Scale_Changes/Chapter-22_Large-Scale_Changes.md (bilingual mirror with English original; canonical abseil.io/resources/swe-book/html/ch22.html blocked)
Rosie "takes a large change and shards it based upon project boundaries and ownership rules into changes that can be submitted atomically. It then puts each individually sharded change through an independent test-mail-submit pipeline." Each shard is tested via TAP ("every test that depends on the files in a given change transitively"). An LSC committee ("about a dozen people") authorizes the change and typically assigns all shards to a single global approver, who "use[s] a separate set of pattern-based tooling to review each of the changes and automatically approve ones that meet their expectations", i.e. mechanical, pre-vetted change classes get pattern-based auto-approval; owners still review anything outside the pattern.

Chromium code review + OWNERS: https://github.com/chromium/chromium/blob/main/docs/code_reviews.md and https://github.com/mises-id/mises-browser-chromium/blob/main/docs/code_review_owners.md (mirror of chromium docs/code_review_owners.md)
"You must get a positive review from an owner of each directory your change touches"; non-committers need two committer +1s. OWNERS directives: per-file, set noparent (must cite an approved use case in //build/OWNERS.setnoparent). Escape hatches are tiered: Owners-Override +1 for gardeners/release managers/ATLs; the Rubber Stamper bot votes Bot-Commit +1 "for verifiably safe changes like translation files, clean reverts, and clean cherry-picks", but "Rubber Stamper never provides OWNERS approval, by design." Design rationale (from the infra README, search-verified): if it provided both code review and OWNERS approval, "that would be an abuse vector: that would allow anyone who can create a revert or cherry-pick to land it without any other person being involved (e.g. the silent revert of security patches)". The bot either adds Bot-Commit +1 or leaves a comment explaining why the CL does not meet the configured rules and removes itself as reviewer. Config vocabulary reported: benign_file_pattern, clean_revert_pattern, clean_cherry_pick_pattern with time windows.

Chromium LSC process: https://github.com/chromium/chromium/blob/main/docs/process/lsc/large_scale_changes.md
Threshold "Number of child CLs >= 30"; approval by a domain reviewer plus the LSC committee, which then grants the requester temporary OWNERS-bypass power, revoked when done; a second reviewer spot-checks the batch with Code-Review +1.

Rust bors / rollups: https://github.com/rust-lang/rust-forge/blob/master/src/release/rollups.md (canonical forge.rust-lang.org/release/rollups.html blocked) plus bors-ng reference above
@bors r+ by a team reviewer is the merge authorization; risk is encoded with rollup=always|maybe|iffy|never: "PRs that just edit docs are usually rollup=always", CI/bootstrap changes are "probably iffy", large or perf-sensitive PRs never; p=N sets queue priority. Reviewer fit is policy-defined in https://raw.githubusercontent.com/rust-lang/rust-forge/master/src/compiler/reviews.md (reviewer must be "the right person to approve", may need sign-off from other teams, r? @name reassigns).

Kubernetes OWNERS + Prow: https://github.com/kubernetes/community/blob/master/contributors/guide/owners.md and https://raw.githubusercontent.com/kubernetes-sigs/prow/main/site/content/en/docs/components/plugins/approve/approvers/_index.md ; Tide config https://github.com/kubernetes-sigs/prow/blob/main/site/content/en/docs/components/core/tide/config.md
Two-tier trust: reviewers (any collaborator may /lgtm, must be renewed on each change) vs approvers (/approve; "every file modified by the PR must be approved... by an approver from the OWNERS files"; an approver's /lgtm also counts as approval). OWNERS supports filters (regex per path), labels, no_parent_owners, emeritus_approvers. Plugin options: issue_required, require_self_approval/implicit_self_approve, lgtm_acts_as_approve. Tide merges when query labels (e.g. lgtm, approved) are present, missingLabels (e.g. do-not-merge/hold) absent, optional reviewApprovedRequired, author, includedBranches, and required-contexts pass (or from-branch-protection); blocker_label, squash_label.

## 8. AI review bots as gates

Claude Code, Code Review (managed): https://code.claude.com/docs/en/code-review
Severity vocabulary: Important ("a bug that should be fixed before merging"), Nit, Pre-existing. "Findings are tagged by severity and don't approve or block your PR"; "The check run always completes with a neutral conclusion so it never blocks merging." Explicit gating recipe: parse the machine-readable bughunter-severity: {"normal":N,"nit":N,"pre_existing":N} from the check-run output in your own CI and fail if normal > 0. REVIEW.md lets you redefine Important, cap nits, add skip rules for paths/branches, set a "verification bar" (evidence required before posting). Effort levels low/medium = only highest-confidence findings.

Claude Code GitHub Action: https://github.com/anthropics/claude-code-action/blob/main/docs/solutions.md and https://code.claude.com/docs/en/github-actions
Review examples restrict tools to mcp__github_inline_comment__create_inline_comment,Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*): comment-only, no approve/merge; filtering by paths: (e.g. src/auth/**) and author_association == 'FIRST_TIME_CONTRIBUTOR'. Runs require the triggering actor to have write access and be human (allowed_bots). No "Claude Approvals" product was found.

GitHub Copilot code review: https://github.com/github/docs/blob/main/content/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review.md
"By default, Copilot leaves a 'Comment' review, not an 'Approve' review or a 'Request changes' review... do not count toward required approvals", but "if configured to do so, Copilot can leave 'Approve' reviews." Auto-trigger via the ruleset rule "Automatically request Copilot code review" with "Review new pushes"; rulesets also offer "Additional approval for unattributed Copilot pull requests".

CodeRabbit: real-world config https://raw.githubusercontent.com/Open-Paws/coderabbit/main/.coderabbit.yaml (canonical docs.coderabbit.ai/pr-reviews/pre-merge-checks blocked; search snippets confirm the same keys)
Gating keys: reviews.request_changes_workflow: true ("CodeRabbit can block merges" by submitting Request Changes), reviews.profile: chill|assertive, reviews.pre_merge_checks with title, description, docstrings (coverage threshold), issue_assessment, and custom_checks[] each with mode: off|warning|error; error + request-changes blocks until resolved; auto_review.ignore_title_keywords, drafts, base_branches, ignore_usernames; path_filters, path_instructions, labeling_instructions; estimate_code_review_effort.

Greptile: real-world config https://github.com/NVIDIA/Megatron-LM/blob/main/greptile.json (docs blocked; search snippets from greptile.com/docs confirm semantics)
Keys: strictness (1 verbose / 2 balanced / 3 critical-only), commentTypes (logic, syntax, style, info), ignorePatterns, ignoreKeywords, includeAuthors/excludeAuthors, includeBranches, disabledLabels, statusCheck (bool: publish a status check), skipReview: "AUTOMATIC", confidenceScoreSection (0-5 merge-readiness score based on issue severity/quantity). Rules in .greptile/ carry id, severity: low|medium|high, enabled.

Qodo Merge /review: https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/tools/review.md (canonical docs.qodo.ai blocked)
Toggles: require_score_review, require_tests_review, require_estimate_effort_to_review, require_can_be_split_review, require_security_review, require_ticket_analysis_review, require_risk_assessment, require_merge_recommendation, require_priority_files, require_todo_scan. Label outputs usable as gates: Review effort [x/5] (enable_review_labels_effort), possible security issue (enable_review_labels_security), ticket compliance (Fully compliant | PR Code Verified | Partially compliant | Not compliant; require_ticket_labels, require_no_ticket_labels -> "No ticket found"). Doc states the purpose: "ensure PRs with potential security issues or ticket compliance problems will not be merged without further review."

Graphite Agent / Diamond: https://graphite.com/docs/ai-review-customization (not fetchable; see unverified list)
Search snippets only: custom rules, exclusions, "PR-level filtering", conservative "high confidence" thresholds. Could not confirm approve/block semantics.

## 9. Conventional Commits / semantic labels as risk signals

Conventional Commits v1.0.0: https://github.com/conventional-commits/conventionalcommits.org/blob/master/content/v1.0.0/index.md
"fix type commits should be translated to PATCH releases. feat type commits should be translated to MINOR releases. Commits with BREAKING CHANGE... should be translated to MAJOR releases."; other Angular types build, chore, ci, docs, style, refactor, perf, test.

commitizen/conventional-commit-types: https://raw.githubusercontent.com/commitizen/conventional-commit-types/master/index.json
Type definitions used by tooling for classification: docs = "Documentation only changes", style = "Changes that do not affect the meaning of the code", test = "Adding missing tests or correcting existing tests", chore = "Other changes that don't modify src or test files", ci, build, revert.

action-semantic-pull-request: https://github.com/amannn/action-semantic-pull-request
Enforces type(scope)!: subject on PR titles with types, scopes, requireScope, disallowScopes, subjectPattern, wip, ignoreLabels; pairs with squash-merge "Default to PR title for squash merge commits" so the type becomes a reliable machine-readable signal on the merged commit.

Concrete uses of type/path as a risk tier found above: Rust rollup=always for docs-only PRs; Mergify files ~= ^docs/ / #files conditions; Chromium Rubber Stamper's benign-file classes (translation, whitespace, test-expectation files, "directories that contain no code"); GitLab "Merge immediately without restarting" for documentation-type changes; Renovate lockFileMaintenance/devDependencies/patch as lowest-risk update types.

## Searched but could NOT verify (source unreachable or not found)
- Chromium Rubber-Stamper README (config keys benign_file_pattern, clean_revert_pattern, clean_cherry_pick_pattern, time windows): chromium.googlesource.com blocked; content known only from search snippets.
- Graphite Agent/Diamond docs (graphite.com and graphite.dev both blocked): could not confirm whether it can approve/request changes or block merge, nor exact rule/confidence key names.
- Greptile and CodeRabbit official docs pages (blocked); key names are corroborated only via real-world config files on GitHub plus search snippets.
- Anthropic "Claude Approvals": no such product/feature found; only claude-code-action and Code Review exist, both comment-only.
- Reviewpad official docs and original repo (docs.reviewpad.com blocked; github.com/reviewpad/reviewpad returns 404): vocabulary verified only through a fork and search snippets.
- Google eng-practices review standard (google.github.io blocked) and abseil.io SWE-book original (blocked; used a bilingual GitHub mirror instead).
- rustc-dev-guide bors/r+ prose: the contributing page has been split; only rust-forge rollup/review-policy pages were verified.
- github.blog changelog on Copilot review (blocked); Copilot facts taken from the github/docs source repo instead.
