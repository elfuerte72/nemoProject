# CodeRabbit — research (retrieved 2026-09-17)

Legend: "docs, retr. 2026-09-17" means a docs page with no publish date, read on 2026-09-17. UNVERIFIED means I could not confirm it from a primary source.

## 0. Key points for our setup (analysis based on the facts below)

- **Rate limits count per PR author, not per org, and every push counts.** All our agent PRs open under one GitHub identity, so all reviews come out of one developer's allowance. Adding seats does not help. Sources: https://docs.coderabbit.ai/management/rate-limits (retr. 2026-09-17).
- **The "Fair Usage" bands will throttle us.** On Essentials, 60+ PR review events in the last 7 days drop the refill to 1 review/hour, one at a time. The band starts at 70+ on Team and 80+ on Advanced. Our volume is ~22 PRs/week in nemo plus ~38/week in the sister repo, and each push is another event, so we would sit in the lowest band on every self-serve plan. The ways past it are the usage-based add-on at $0.25 per reviewed file, or spending fewer reviews (`@coderabbitai ignore` or `auto_incremental_review: false`, then one deliberate `@coderabbitai review` per PR).
- **A rate-limited push posts a PASSING check, "Review rate limited".** It does not block strict CI, so a PR can merge unreviewed unless someone reads the comment. Source: rate-limits page, above.
- **A hosted git platform is required.** PR review works only on GitHub, GitLab, Bitbucket or Azure DevOps; a bare git mirror is not supported. The CLI reviews any local git repo, but a repo not installed in a CodeRabbit org falls back to "limited/free review behavior". Sources: https://docs.coderabbit.ai/platforms/overview, https://docs.coderabbit.ai/cli (retr. 2026-09-17).

## 1. Pricing and limits

### Plan names and prices (now)
- **The plans were renamed between 2026-08-26 and 2026-09-01.** Pro became **Essentials**, Pro+ ("Pro Plus") became **Team**, and **Advanced** is a new tier.
  - Wayback snapshot of coderabbit.ai/pricing on 2026-08-26 15:37 UTC: still "Pro $24 / Pro Plus $48", limits 5/10/12.
  - Snapshot of 2026-09-01 07:48 UTC: Essentials $24 / Team $48 / Advanced $72, limits 5/8/10/12.
  - Pricing FAQ: "Essentials is the new name for Pro, and Team is the new name for Pro Plus."
  - Sources: https://web.archive.org/web/20260826153724/https://www.coderabbit.ai/pricing, https://web.archive.org/web/20260901074856/https://www.coderabbit.ai/pricing, https://www.coderabbit.ai/pricing (retr. 2026-09-17).
- **Prices:**
  - **Free:** $0. Unlimited public and private repos, but PR *summarization only*; code review only through the IDE extension and CLI. New orgs start with a 14-day **Advanced** trial.
  - **Open Source:** free on public repos with Team features; rate limits vary with repo popularity.
  - **Essentials:** $24/dev/month billed annually, $30 month-to-month.
  - **Team:** $48 annually, $60 monthly.
  - **Advanced:** $72 annually (pricing page), $90 monthly (docs).
  - **Enterprise:** contact sales.
  - Sources: https://docs.coderabbit.ai/management/plans, https://www.coderabbit.ai/pricing (retr. 2026-09-17).
- **What each tier adds:**
  - **Essentials:** AI review, Autofix, docstrings, MCP, built-in pre-merge checks, linters/SAST, Jira/Linear, learnings.
  - **Team:** adds Triage, custom pre-merge checks (10), unit-test generation, merge-conflict resolution, the CI fixer, CodeRabbit Plan/issue planning, post-merge actions, and Change Stack AI chat.
  - **Advanced:** adds continuous PR security review, blast radius and architectural impact analysis.
  - **Enterprise:** adds SSO/RBAC/audit logs, API, self-hosting, multi-org, SLA, and EU SaaS deployment.
  - Sources: same pages as above.
- **Legacy plans:** Lite and "Pro Legacy" were retired on **2026-06-08**; affected customers moved to Pro at no extra cost until their term ended. Source: changelog entry "Legacy plan sunset" (2026-06-15), https://docs.coderabbit.ai/changelog.
- **Pro+ history:** Pro+ was introduced on **2026-04-16**. Source: changelog "Pro+ plan", https://docs.coderabbit.ai/changelog.

### Seats: who is billed
- **Pricing FAQ:** "You will only be charged for developers who create pull requests." Seats can be reassigned at any time. Source: https://www.coderabbit.ai/pricing, https://www.coderabbit.ai/faq (retr. 2026-09-17).
- **Automatic seat assignment happens when a user *opens* a PR.** Pushes to an existing PR do not assign a seat. On non-Enterprise plans CodeRabbit can provision an extra license automatically and charge it prorated. A seat idle for 30+ days is reallocated. Source: https://docs.coderabbit.ai/management/seat-assignment (retr. 2026-09-17).
- **Bots:** the docs mention "bot users or external users that have seats", so bot accounts *can* take seats. `ignore_usernames` keeps a user from getting a seat. There is **no explicit rule about AI-agent-authored PRs**; seats follow the git identity that opens the PR. If Claude Code opens PRs with our own gh account, that is one seat. Source: seat-assignment page above.
- **Unseated authors** still get free-tier reviews unless `enable_free_tier: false`. Source: seat-assignment page above.

### Rate limits (per developer, rolling window)
- **Limits table** (docs, retr. 2026-09-17, https://docs.coderabbit.ai/management/plans):

  | Plan | PR/hr | IDE/hr | CLI/hr | Files per review | Chat/hr |
  |---|---|---|---|---|---|
  | Free | 1 (summary only) | 3 | 3 | 150 | none |
  | OSS | 1–10 (by stars) | 1 | 3 | 100–300 | 25 |
  | Essentials | 5 | 5 | 5 | 150 | 50 |
  | Team | 8 | 8 | 8 | 300 | 75 |
  | Advanced | 10 | 10 | 10 | 300 | 100 |
  | Enterprise | 12 | 12 | 12 | 300 | 100 |

  Customers grandfathered from Pro+ into Team keep 10/hour. Pro and Pro+ subscriptions also keep their previous adaptive schedules.
- **What counts as one review event:**
  - PR opened.
  - Each push; several commits in one push count once.
  - Each web-UI edit, and each "Update branch" or "Resolve conflicts" click.
  - Each `@coderabbitai review` or `@coderabbitai full review`.
  - A force-push, rebase, reopen, or a draft marked ready.
  - A review superseded by a newer push is still counted.

  Draft PRs are skipped by default. Source: https://docs.coderabbit.ai/management/rate-limits (retr. 2026-09-17).
- **Fair Usage adaptive bands** (reviews in the last 7 days → refill rate):

  | Plan | Full rate | Middle bands | Floor: 1/hr, one at a time |
  |---|---|---|---|
  | Essentials | 0–29 → 5/hr | 30–39 → 4, 40–49 → 3, 50–59 → 2 | 60+ |
  | Team | 0–39 → 8/hr | 40–49 → 6, 50–59 → 4, 60–69 → 2 | 70+ |
  | Advanced | 0–49 → 10/hr | 50–59 → 8, 60–69 → 4, 70–79 → 2 | 80+ |

  - Enterprise uses separate bands (0–59 → 12/hr, down to 90+ → 1/hr), and only for new contracts that explicitly enroll.
  - The docs warn that one "coding-agent account" authoring every PR concentrates all reviews on that one identity, and that "Adding seats does not help here."
  - Source: rate-limits page above.
- **Usage-based add-on:** $1 per credit = 4 files, i.e. **$0.25 per reviewed file**. Available on Essentials, Team and Advanced; not on INR or marketplace subscriptions.
  - Continuation modes: Automatic, On demand (a seated developer confirms the price for each review), or Off.
  - A monthly spending cap is supported.
  - Over-limit PR reviews are free during the initial trial.
  - Large PRs up to 300 files can be reviewed "on demand using usage pricing" (GitHub only); above 300 files a PR is not reviewable.
  - UNVERIFIED: whether an incremental review bills only the changed files or the whole PR.
  - Sources: https://docs.coderabbit.ai/management/usage-based-addon (retr. 2026-09-17); changelog "PR Usage-based Add-on" (2026-04-08), "CLI Usage-based Add-On" (2026-03-04), "Review continuation modes" (2026-08-18), "Large PR file limits" (2026-07-15).
- **Seeing your usage:** `@coderabbitai rate limit` shows the remaining quota (changelog 2026-04-28). A Review Usage dashboard exists (changelog 2026-09-01). `cr usage` works in the CLI (CLI v0.7.3, 2026-08-14). Source: https://docs.coderabbit.ai/changelog.

### Trials, open source, startups
- **Trial:** 14 days on all plans, no credit card. The default trial runs at Advanced level. Sources: pricing page and plans docs (retr. 2026-09-17).
- **Open source:** "install CodeRabbit on a public repository, and receive free reviews forever". Includes Security and Change Stack. Public repos with fewer than 10 stars need reviews triggered manually. The company pledges $10M+ to open source. Sources: https://www.coderabbit.ai/oss, plans docs (retr. 2026-09-17).
- **Startup program:** "50% off CodeRabbit Team for 6 months" on an annual Team plan, for VC- or accelerator-backed startups with under $25M in funding. We likely don't qualify. Source: https://www.coderabbit.ai/startup-program (retr. 2026-09-17).

## 2. How the review works now

- **Walkthrough comment** (on by default, collapsible). It contains:
  - a changed-files summary;
  - **Mermaid sequence diagrams** (`sequence_diagrams`, default true);
  - review effort on a 1–5 scale;
  - related issues and PRs, linked-issue assessment, suggested labels and reviewers;
  - an optional poem and a "fortune" message while the review runs.

  A high-level summary is written into the PR description by default (`high_level_summary`). Sources: https://docs.coderabbit.ai/pr-reviews/walkthroughs, https://docs.coderabbit.ai/reference/configuration (retr. 2026-09-17).
- **Inline comments:**
  - Each carries a category badge (Security, Stability, Data Integrity, Functional Correctness, Performance, Maintainability) and a severity (Critical, Major, Minor, Trivial, Info).
  - "One-click fixes" apply suggestions straight to the PR.
  - Every inline comment includes a "🤖 Prompt for AI Agents" block (`enable_prompt_for_ai_agents`, default true).

  Sources: https://docs.coderabbit.ai/guides/code-review-overview, configuration reference (retr. 2026-09-17). Committable suggestion blocks also reached Bitbucket Cloud (changelog 2026-07-07).
- **Autofix** (Essentials+): `@coderabbitai autofix` commits fixes to the branch; `@coderabbitai autofix stacked pr` opens a stacked PR instead. It runs as a cloud "coding agent" task and builds from the "Prompt for AI Agents" blocks. Posted in a thread, it fixes only that thread (changelog 2026-08-25). Source: https://docs.coderabbit.ai/finishing-touches/autofix (retr. 2026-09-17).
- **Learnings:**
  - Replies to `@coderabbitai` become learnings (scope local, global or auto) and show up in a "Learnings added" section.
  - Admin approval delay is optional (changelog 2026-06-11).
  - A file can be imported with `@coderabbitai add a learning using <file>`.
  - Opt out with `knowledge_base.opt_out: true`, which irrevocably deletes stored learnings.

  Sources: https://docs.coderabbit.ai/knowledge-base/learnings, https://docs.coderabbit.ai/knowledge-base (retr. 2026-09-17).
- **Configuration:**
  - `.coderabbit.yaml`, plus `path_instructions` (glob-based), AST-grep instructions, central configuration and global overrides (Enterprise, 2026-04-16).
  - **`.coderabbit.config.ts`** with type checking arrived 2026-09-16.
  - `cr config validate` checks a config file.

  Sources: configuration reference; changelog.
- **Guideline files picked up automatically** (`knowledge_base.code_guidelines`, on by default): `**/AGENTS.md`, `**/CLAUDE.md`, `**/GEMINI.md`, `.cursorrules`, `.cursor/rules/*`, `.github/copilot-instructions.md`, `.windsurfrules`, `.clinerules/*`, `.rules/*`, `AGENT.md`.
  - The config reference also lists `REVIEW.md`, but the guidelines page table does not.
  - Each file applies to its own directory subtree; `{files, applyTo}` maps a file to other paths.
  - Guidelines can come from another repo in the same org (2026-08-18).
  - **No size limit is documented. Our root CLAUDE.md is about 112 KB. UNVERIFIED how much of it is actually used.**
  - Source: https://docs.coderabbit.ai/knowledge-base/code-guidelines (retr. 2026-09-17).
- **Linters/SAST** ("50+", almost all on by default, chosen by file type):
  - JS/TS: ESLint (uses the repo config; the e18e plugin since 2026-07-22), Biome, Oxlint, React Doctor.
  - Multipurpose and secrets: Semgrep, OpenGrep, ast-grep; **Betterleaks replaced Gitleaks** on 2026-03-19 (the `gitleaks` config key now controls Betterleaks); TruffleHog; OSV-Scanner.
  - SQL: SQLFluff and **Squawk** (Postgres migration linter).
  - CI: actionlint, zizmor.
  - Prose and docs: markdownlint, LanguageTool (default on), Vale (on changed markdown since 2026-08-24).
  - Presidio (PII); SkillSpector (agent skills and MCP configs, 2026-06-11).
  - Sources: https://docs.coderabbit.ai/tools, https://docs.coderabbit.ai/tools/list, configuration reference, changelog (retr. 2026-09-17).
- **Pre-merge checks:**
  - Built in: docstring coverage (80% threshold), PR title, PR description, linked-issue assessment. Each runs in off, warning or error mode.
  - Custom checks: 0 on Essentials, 10 on Team, 20 on Advanced; natural-language instructions up to 10k characters.
  - Overrides can be restricted to requested reviewers (2026-09-10).
  - Sources: configuration reference, plans docs, changelog.
- **Docstrings** (Essentials+) and **unit-test generation** (Team+) are "Finishing Touches"; both open a follow-up PR or commit. Also Team+: Simplify, merge-conflict resolution, **Fix CI** (`@coderabbitai fix-ci`, beta, 2026-07-16), and custom recipes. Sources: plans docs, https://docs.coderabbit.ai/finishing-touches/docstrings, changelog.
- **Incremental review:**
  - Every push is reviewed incrementally (`auto_incremental_review`, default true).
  - Reviews **auto-pause after 5 reviewed commits** (`auto_pause_after_reviewed_commits`, since 2026-02-12).
  - Filters: `ignore_title_keywords`, `labels` (opt in or out), `drafts` (default false), `ignore_usernames`, `base_branches`.
  - Source: configuration reference; changelog 2026-02-12.
- **Commands:**
  - `@coderabbitai pause` and `resume`; `@coderabbitai ignore` in the PR description.
  - `review` (incremental) and `full review`.
  - `resolve`, `approve` (needs `request_changes_workflow`), `summary`, `generate sequence diagram`, `generate project vocabulary` (2026-09-09).
  - Source: https://docs.coderabbit.ai/guides/commands (retr. 2026-09-17).
- **Review profiles:** `quiet` (new 2026-07-02: only critical or major high-impact comments inline, the rest collapsed), `chill` (default), `assertive` ("may feel nitpicky"). Sources: configuration reference; changelog 2026-07-02.
- **Other 2026 surfaces:**
  - **Change Stack**, a layered PR review UI: launched 2026-05-07; core on Essentials, AI chat on Team+.
  - **Triage**, which prioritizes agent-generated PRs: Team+, beta, 2026-08-13.
  - **Slop Detection**: private repos on Pro+ since 2026-08-21.
  - **CodeRabbit Security**: 2026-07-09; per-PR security review on Advanced+; AI Deep Scan billed by usage.
  - Sources: plans docs; changelog.

## 3. Language (Russian)

- **Russian output is supported.** `language` accepts ISO codes including `ru-RU` and `ru`; the default is `en-US`. Docstrings have their own `docstrings.language`. `tone_instructions` allows up to 250 characters. Source: https://docs.coderabbit.ai/reference/configuration (retr. 2026-09-17).
- **Only programming languages are discussed in the docs.** They say nothing about natural-language input such as Russian PR descriptions. **UNVERIFIED:** quality of Russian output and handling of Russian descriptions and comments. No independent review found.
- **Our own evidence:** the nemo git log has commits fixing CodeRabbit findings, e.g. 8c45b8b, b64e857, 2dffcc7 ("Замечания CodeRabbit: …"). CodeRabbit worked on this Russian-language repo in Aug 2026.
- **Possible noise:** LanguageTool and Vale are on by default and run on changed markdown and text. UNVERIFIED whether this produces noise on Russian docs.

## 4. Integrations

- **Git platforms:** GitHub.com, GitHub Enterprise Server, GitLab.com, GitLab self-managed, Azure DevOps, Bitbucket Cloud, Bitbucket Data Center. A reverse tunnel reaches private-network GHES and GitLab.
  - **No Gitea, Forgejo, Gerrit or plain-git support** found anywhere in the docs.
  - The FAQ confirms installation on one of the hosted platforms is required.
  - Sources: https://docs.coderabbit.ai/platforms/overview, https://docs.coderabbit.ai/faq (retr. 2026-09-17).
- **CLI (`coderabbit` / `cr`, "Open Beta"):**
  - Reviews local committed, staged and unstaged changes (`--base`, `--committed`, `--uncommitted`).
  - `--agent` gives JSON-lines output for agents.
  - **`--prompt-only` was deprecated in v0.5.1 (2026-05-20) and removed in v0.7.0 (2026-07-22)**; use `--agent`.
  - `--light` gives a faster review.
  - `cr review --remote owner/repo` reviews without a checkout (GitHub Cloud only, v0.7.7, 2026-09-15).
  - Agentic API keys cover headless use.
  - Limits: 3/hr on Free, 5/8/10/12 per hour on paid plans. Over the limit it bills through the same usage add-on.
  - A repo not matched to an installed org gets "limited/free review behavior".
  - Sources: https://docs.coderabbit.ai/cli, https://docs.coderabbit.ai/cli/reference (retr. 2026-09-17); changelog.
- **Claude Code:**
  - Official plugin (`/plugin install coderabbit`, then `/coderabbit:review`) since 2026-02-03.
  - `cr skills` installs verified skills for Claude Code, Codex, Cursor, Gemini CLI and Copilot (skills since 2026-02-27; command in v0.7.0).
  - Codex plugin since 2026-04-14.
  - CodeRabbit joined Anthropic's Claude Marketplace on 2026-05-27.
  - Sources: https://docs.coderabbit.ai/cli/claude-code-integration (retr. 2026-09-17); changelog; https://www.coderabbit.ai/newsroom (retr. 2026-09-17).
- **IDE extension:** VS Code, Cursor and Windsurf. Reviews uncommitted changes and hands fixes to agents (Claude Code, Copilot, Codex, Cline and others). 3 reviews/hr on Free. Sources: https://docs.coderabbit.ai/ide, plans docs (retr. 2026-09-17).
- **MCP:** CodeRabbit *consumes* MCP servers as review context (5/10/15/20 connections by plan; deny-by-default tool selection). **No official CodeRabbit MCP server for agents to read reviews was found**; only community ones (e.g. github.com/bradthebeeble/coderabbitai-mcp). Sources: plans docs, https://docs.coderabbit.ai/connections/mcp-servers, search 2026-09-17.
- **Jira and Linear** are on all paid plans (pricing page, retr. 2026-09-17). **Slack and Discord Agent** is billed per usage at $0.40 per agent minute; Slack Agent launched 2026-04-22. Sources: pricing page; newsroom.

## 5. Security and privacy

- **Training:** "CodeRabbit never uses customer code for training", whether or not data retention is on. Code is "shared with OpenAI and/or Anthropic for reviewing purposes only". Source: https://docs.coderabbit.ai/faq (retr. 2026-09-17).
- **What is stored:**
  - encrypted cache of code and dependency archives, expiring within **7 days** max (can be disabled with `reviews.disable_cache`);
  - vector embeddings of code for context;
  - learnings (opt out with `knowledge_base.opt_out`).
  - On self-hosted deployments all retention can be turned off.
  - Model-output logging for support is off by default.
  - Sources: https://docs.coderabbit.ai/faq, https://docs.coderabbit.ai/reference/caching (retr. 2026-09-17).
- **Marketing FAQ wording:** "does not retain your source code after a review completes, except when review caching is enabled". The docs are more precise: embeddings and learnings are stored too. Source: https://www.coderabbit.ai/faq (retr. 2026-09-17).
- **Certifications:** marketing FAQ says "SOC 2 Type II certified and GDPR compliant" (https://www.coderabbit.ai/faq, retr. 2026-09-17). ISO 27001:2022 appears only in a search snippet of trust.coderabbit.ai/compliance, which did not render. UNVERIFIED.
- **Self-hosted:** Enterprise only, **500+ seats**; GHES, GitLab self-managed, Azure DevOps and Bitbucket DC; bring-your-own LLM. EU SaaS deployment is Enterprise only. Sources: https://docs.coderabbit.ai/self-hosted/overview (retr. 2026-09-17); AWS Marketplace listing "minimum 500 users"; pricing page.
- **Past incident:** Kudelski Security got RCE through a malicious `.rubocop.yml`, leaking secrets and gaining potential write access to about 1M repos. Reported and fixed in **Jan 2025**, published **2025-08-19**. Source: https://research.kudelskisecurity.com/2025/08/19/how-we-exploited-coderabbit-from-a-simple-pr-to-rce-and-write-access-on-1m-repositories/.

## 6. Independent evidence of quality

- **Martian Code Review Bench, online leaderboard** (independent lab, open methodology; LLM judge checks whether a bot comment led to a code change).
  - Read live on **2026-09-17**, "Last month" view, 16,699 scored PRs.
  - **CodeRabbit #6:** F1 61.3%, precision 67.0%, recall 56.4%, 2,123 PRs sampled.
  - **Greptile #7:** F1 61.2%, precision 79.8%, recall 49.6%, 1,460 PRs sampled.
  - #1 was Kody AI (69.9%); GitHub Copilot 63.4%; Claude 62.7%.
  - Reading: the two are tied on F1. Greptile is less noisy (higher precision); CodeRabbit catches more (higher recall).
  - Sources: https://codereview.withmartian.com/ (rendered in browser, 2026-09-17); methodology https://github.com/withmartian/code-review-benchmark.
- **Rankings move over time and vendors cite their best snapshot:**
  - CodeRabbit (vendor) claimed #1 on 2026-03-03: F1 51.2%, P 49.2%, R 53.5%. https://www.coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark
  - Greptile (vendor) claimed #1 on 2026-07-30: Greptile 60.8% F1 / 76.2% P, CodeRabbit 57.5% / 64.9% P. https://www.greptile.com/content-library/greptile-martian-code-review-benchmark
- **Vendor benchmarks (treat with caution):**
  - Greptile's own 50-PR benchmark (undated, ~2025) claims Greptile catches far more bugs by severity. https://www.greptile.com/greptile-vs-coderabbit
  - Tenki (a competitor), updated 2026-05-20, 122 bugs: CodeRabbit 28.7% recall / 25.0% precision; Greptile 36.1% / 15.9%. https://tenki.cloud/benchmarks/code-reviewer
  - Many 2026 SEO comparison posts recycle the "82% vs 44%" figure; ignore them.
- **Noise and praise:**
  - **Greptile's "There is an AI code review bubble" thread** (~Jan 2026; HN showed "7 months ago" on 2026-09-17), https://news.ycombinator.com/item?id=46766961:
    - The_Fox: CodeRabbit "regularly finds problems, including subtle but important problems".
    - The_Fox also: it complains about things "possible in theory but impossible in practice".
    - sebra found Greptile "pretty much pure noise" and CodeRabbit useful because it learned from feedback. https://news.ycombinator.com/item?id=46777079
  - **Martin Zoeller** (consultant, several weeks at a client, 2026-07-30): catches real edge cases but posts 20+ comments even on clean PRs, stores incorrect learnings, and the guidelines UI was broken for weeks. Verdict: not recommended for high-bar teams. https://www.martinzoeller.com/en/blog/coderabbit-ai-review-is-it-worth-it
  - **Trustpilot:** 2.4/5 from 7 reviews. 2026 complaints: "sold as unlimited, throttled in practice" (Jul 2026), constant rate limiting (Aug 2026), billing and support problems. Small sample. https://www.trustpilot.com/review/coderabbit.ai (retr. 2026-09-17)
- **High-volume agent PRs:**
  - The vendor's own docs name the single-identity trap (rate-limits page).
  - A community gist (2026-07-26) describes parallel agent sessions draining one developer's pool. Its fix: open PRs with `@coderabbitai ignore`, then request one deliberate review per PR, with a shared budget ledger across sessions. https://gist.github.com/Tatendaz/3c1adbc2b88c353142b675a1ef6fdac2
  - HN "Ask HN: tools for human review of AI-assisted code" (~Aug 2026): the GitHub UI is drowning in AI review noise; a CodeRabbit staffer points to Change Stack. https://news.ycombinator.com/item?id=49321400

## 7. 2026 news

- 2026-02-03: Claude Code plugin.
- 2026-03-04: CLI usage add-on.
- 2026-03-19: Betterleaks replaces Gitleaks.
- 2026-04-08: PR usage add-on.
- 2026-04-16: Pro+ plan.
- 2026-04-22: Slack Agent.
- 2026-05-07: Change Stack.
- 2026-05-27: Claude Marketplace.
- 2026-06-08: Lite and Pro Legacy retired.
- 2026-07-02: Quiet profile.
- 2026-07-09: CodeRabbit Security.
- 2026-07-22: CLI v0.7.0 removes `--prompt-only`.
- 2026-08-13: Triage.
- 2026-09-16: TypeScript config.

Sources for the entries above: https://docs.coderabbit.ai/changelog; https://www.coderabbit.ai/newsroom.

- **2026-08-12: Series C.** $143M at a $1.5B valuation (Atomico and Smash Capital), plus launch of "Agentic Change Management" (Triage + Change Stack + Security). Company figures: 2M+ reviews/week, 17k+ customers, revenue up more than 5x year over year. https://www.businesswire.com/news/home/20260812311754/en/, https://www.coderabbit.ai/blog/introducing-agentic-change-management
- **Late Aug 2026: pricing overhaul.** Rename to Essentials/Team, new Advanced tier, Team limit cut from 10 to 8/hr for new customers. Wayback snapshots 2026-08-26 and 2026-09-01; plans docs.
- **Outages:** third-party trackers list short incidents (e.g. a 12-minute App/Reviews outage in Mar 2026). https://isdown.app/status/coderabbit (retr. 2026-09-17). No 2026 security incident found.
