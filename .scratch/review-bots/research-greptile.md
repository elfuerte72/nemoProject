# Greptile: research notes (all sources retrieved 2026-09-17)

Legend: (pub. = publish date given on the page; "ret." = retrieved 2026-09-17 unless stated).
UNVERIFIED = not confirmed by a primary source, or my inference.

---

## 1. TREX (T-Rex, "Test, Run, EXecute")

**What it is**
- Greptile's "execution layer for code review": on top of the normal (read-only) review it runs the PR branch in a sandbox to find bugs that only show up at runtime. Source: https://www.greptile.com/blog/trex (pub. 2026-06-15, Daksh Gupta, co-founder).
- Docs name it "Runtime validation with T-Rex (Beta)": "Writes targeted tests for the PR, including changes and edge cases; runs tests in an isolated sandbox against your repo's services, dependencies, and framework; attaches logs, screenshots, traces, scripts, or videos to failed PR comments." https://www.greptile.com/docs/code-review/key-features
- Landing page: "starts services, mocks inputs, clicks through UI flows"; "spins up dev servers, and uses browser agents to click through your UI". https://www.greptile.com/trex

**When announced**
- Changelog entry 2026-06-15: "TREX is now available in public beta." https://www.greptile.com/changelog
- Before that the site nav (archived 2026-06-13) already showed "TREX: Test Generation Early Access". http://web.archive.org/web/20260613172119/https://www.greptile.com/pricing
- Engineering deep-dive: https://www.greptile.com/blog/trex-code-execution (pub. 2026-06-17, Shlok Mehrotra).

**How it works (per Greptile)**
- The main reviewer is an orchestrator: it "reads the diff, identifies issues worth investigating, and spins up a dedicated TREX agent per issue, all running in parallel". Sub-agents inherit the orchestrator's context. (blog/trex-code-execution, 2026-06-17)
- So TREX runs *per suspected issue*, not as a blanket "run the whole test suite". It checks hypotheses raised by the review.
- Sandbox: "an isolated compute instance per review, started fresh in milliseconds, thrown away when the run is done"; "reusable base images and per-repository snapshots… Each review still fetches the exact PR commits and rotates credentials before execution begins." (same post)
- Model-agnostic harness; the orchestrator and sub-agents may use different providers. (same post)
- Known failure mode, admitted by Greptile: "an early version of the agent would sometimes hallucinate about how thoroughly it had tested something, claiming to have tried something it hadn't". Their fix was attaching artifacts to every finding. (same post)
- Claim: "~20% more bugs caught in evals"; "most of the new bugs caught could not have been caught with more inference". Vendor eval, no methodology published. (changelog 2026-06-15; https://www.greptile.com/trex). An independent essay notes Greptile "did not publish numbers behind that": https://victorinollc.com/thinking/trex-verification-by-execution (pub. 2026-06-18).
- Real example (Greptile's own public test repo): TREX ran a focused Jest test with yarn, reproduced a `1000ms → "0s"` boundary bug, posted a P1 finding and a "T-Rex Logs" block with a link to `app.greptile.com/trex/runs/<id>/artifacts`. https://github.com/greptileai/test-trex-OpenMetadata/pull/1 (comments 2026-07-13 and 2026-07-22). In that PR a staff member triggered it with the comment `@greptileai trex`. This command is not in the public docs: UNVERIFIED.
- Since 2026-09-16 the review summary no longer has a "T-Rex Logs section" (removed in the summary redesign). https://www.greptile.com/changelog

**Cost**
- At launch: "TREX is in public beta, and available for free to all Greptile users till the end of June. After that it will cost $2 per run on top of the review cost." Archived https://www.greptile.com/blog/trex as of 2026-06-16: http://web.archive.org/web/20260616195339/https://www.greptile.com/blog/trex . The live post no longer has this sentence (checked 2026-09-17).
- Current pricing: "1 credit = 1 standard review · 3 credits = 1 trex review"; extra credits cost $1. https://www.greptile.com/pricing , https://www.greptile.com/docs/code-review-bot/billing-seats . First seen on the pricing page in the archive of 2026-07-23 (not there on 2026-06-28).
- In practice a TREX review uses 3 credits instead of 1. That is about $3 per review once the included credits run out, which matches "+$2 on top". Whether a TREX review can use more than 3 credits when it spawns many sub-agents is not documented: UNVERIFIED.

**How to enable / beta limits**
- "Turn it on in T-Rex settings" (dashboard `…/review#trex`). The screenshot's alt text reads "enable runtime validation, choose when it runs, and filter which PRs run T-Rex". https://www.greptile.com/docs/code-review/key-features
- Docs changelog 2026-07-24: T-Rex moved to "Settings → T-Rex". https://www.greptile.com/docs/changelog . The "Agent Config → TREX Beta" sidebar the user sees is newer than any doc I found: UNVERIFIED how it maps.
- Still labelled Beta in the docs (ret. 2026-09-17).
- Not documented anywhere public:
  - concrete beta limits (run time, concurrency, runs/month)
  - which languages or stacks it supports
  - how to supply env vars or secrets
  - whether it can start Postgres or docker-compose services
  - whether the sandbox has network egress
  - whether it runs on self-hosted Greptile

  Greptile only says "no setup or workflow changes required" and "zero setup". UNVERIFIED for a pnpm/turbo + Postgres monorepo.
- Greptile claims "within weeks of launch, t-rex is testing thousands of commits per hour" (X post, https://x.com/greptile/status/2074523984738296093; X returned 402, text taken from the search snippet: UNVERIFIED wording).

---

## 2. Pricing (current)

- **Starter: Free.** 1 active developer, unlimited repos, 50 credits/month, no team creation. Added 2026-06-29. https://www.greptile.com/changelog , https://www.greptile.com/pricing
  - The docs say "the free plan includes pull request reviews only"; CLI reviews need a trial or a paid plan. https://www.greptile.com/docs/code-review/cli-onboarding
  - What happens after the 50 credits are used up on Starter (reviews skipped?) is not documented: UNVERIFIED.
- **Pro: $30/seat/month.**
  - 50 credits per seat, then $1/credit ("flex usage"), unlimited users, custom rules, external apps.
  - A seat = "any developer who has gotten a review done by Greptile in that billing period".
  - Reviews are billed to the PR author. Flex is per author, not a pooled team allowance.
  - Billing counts completed reviews, not PRs; skipped reviews are free.
  - You can set a flex $ cap (a $0 cap disables flex).
  - Sources: https://www.greptile.com/pricing , https://www.greptile.com/docs/code-review-bot/billing-seats
- **Enterprise: custom.** Self-host, SSO/SAML, GitHub Enterprise, dedicated Slack channel. Self-hosted "requires a license" (contact sales). Per the self-host page: annual contracts, 15% off for upfront payment, "No free trials", 100% refund in the first 30 days. https://www.greptile.com/docs/security/selfhost
- **Trial:** "14-day free trial", "No payment method required"; "New organizations start a 14-day trial automatically." https://www.greptile.com/docs/code-review/cli-onboarding , https://www.greptile.com/pricing
- **Open source:** "free for qualified non-commercial projects with MIT or Apache licenses". https://www.greptile.com/pricing
- **Startups:** 50% off for pre-Series A companies with under $2M revenue in the past 12 months. https://www.greptile.com/pricing
- **History:**
  - 2026-03-05: moved from a flat $30/dev to "$30/developer/month, which includes 50 reviews, after which reviews cost $1 each". Claim: "Less than 10% of active users will exceed the included usage." https://www.greptile.com/blog/greptile-v4
  - Reviews became "credits" by 2026-06-28 (archive).
  - Starter and the TREX credit price appear by 2026-07-23 (archive).
- **Pushback on agent-heavy workflows:**
  - A critic site computes that 50 reviews is about 42 PRs/month, using the 1.2 reviews/PR figure it attributes to Greptile.
  - It cites a user with 571 PRs in 30 days: "$30 → $500+".
  - Source: https://greptile-fail.vercel.app/ , HN thread https://news.ycombinator.com/item?id=47966075 (2026-04-30, 17 points). Opinion piece: the math is theirs.
  - Matt Galligan: "$1/review past 50/mo will be blown past in less than 3 days". https://x.com/mg/status/2029751037716836478 (snippet only; X blocked: UNVERIFIED wording)

**What the user's "$0 subscription" plausibly is (inference, UNVERIFIED)**
1. Most likely the **free Starter plan** (since 2026-06-29), or
2. the automatic **14-day Pro trial**, which needs no card, so it shows as $0.

The OSS programme does not fit: it is for non-commercial MIT/Apache projects. Check Settings → Billing → "Billing Portal (plan status…)" (https://www.greptile.com/docs/code-review-bot/billing-seats).

After a trial ends: not documented publicly. It presumably falls back to Starter (50 credits, 1 developer, PR reviews only) or asks for a card: UNVERIFIED.

**Rough cost at our volume (my arithmetic, UNVERIFIED assumptions)**
- Assumptions: about 1.2 reviews/PR, and every PR authored by one GitHub user (one seat).
- ~94 PRs/month in one repo ≈ 113 credits:
  - Starter covers ~40 PRs.
  - Pro ≈ $30 + $63 ≈ $93/month.
- Both repos (~260 PRs/month if the 230 PRs were also over ~6 weeks) ≈ 312 credits:
  - Pro ≈ $290/month.
  - With TREX on every review (×3) ≈ 936 credits ≈ $900/month.
- `autoReview: ["open","push"]` increases the count further.

---

## 3. How the review works now

- **Engine:** Greptile Agent **v5** (2026-08-05). "A swarm of narrowly scoped agents in parallel", one bug hypothesis per agent. Vendor A/B test: median review time 5:04 → 2:25 (min:sec); share of comments addressed by the author 52% → 66%. https://www.greptile.com/changelog , https://www.greptile.com/blog/greptile-v5 (pub. 2026-08-05). Before that: v4 (2026-03-06), v3 "agentic" (2025-09-22).
- **Codebase graph:** Greptile "builds a graph of your repository (functions, classes, imports, dependencies)" to reason about ripple effects beyond the diff. https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context
  - Repo Clusters read up to 7 related repos (changelog 2026-06-02), or `context.repos` in config.
- **Model Inversion** (experimental, 2026-07-22): it detects agent-authored PRs from commit trailers such as `Co-authored by: Claude Opus 4.7`, `[codex]` title prefixes and `codex/` branch prefixes, then reviews Claude-written code with GPT and GPT-written code with Claude.
  - Models named: Claude Opus 4.7 and GPT 5.5.
  - Default on/off and how to toggle it: not stated (UNVERIFIED).
  - Relevant for us: our commits carry `Co-Authored-By: Claude …` trailers.
  - Sources: https://www.greptile.com/blog/model-inversion (pub. 2026-07-21), changelog.
- **Security agent** (2026-07-28): Opengrep patterns, an SCA dependency check and an AI exploit agent; "Enabled by default". https://www.greptile.com/changelog
- **Output:**
  - Summary with a **confidence score 0–5** (5 = "Production ready" … 0–1 = "Critical problems").
  - Auto diagrams (sequence, ER, class, flow).
  - Inline comments with P0/P1/P2 badges and suggested fixes.
  - Source: https://www.greptile.com/docs/code-review/first-pr-review
  - 2026-09-16 redesign:
    - verdict and score at the top
    - findings sorted by severity
    - unresolved findings persist across re-reviews
    - a separate comment for issues outside the diff
    - one "Fix All" button

    https://www.greptile.com/changelog
- **Triggers:**
  - `autoReview` defaults to `["open"]`; options are `open`, `push` (adds commits) and `rebase`. `[]` means manual only.
  - Draft PRs are skipped by default (`triggerOnDrafts`).
  - Manual trigger: `@greptileai` plus an optional instruction.
  - There is also a "Re-trigger Greptile" button.
  - Filters by labels, authors, branches, title/description keywords and `ignorePatterns`.
  - Sources: https://www.greptile.com/docs/code-review/greptile-json-reference , https://www.greptile.com/docs/code-review/developer-essentials , docs changelog.
- **Custom rules / config:**
  - `.greptile/` folder (recommended since 2026-05-12) with `config.json` (structured rules with `scope` globs, `severity`, `id`), `rules.md` (prose, scoped to its directory) and `files.json` (repo files to read as context).
  - Cascades root → leaf, strictest wins.
  - Policy is read from the PR's **base** branch, so a PR cannot loosen its own config.
  - Legacy `greptile.json` still works.
  - Dashboard rules live under **Memory → Custom rules**.
  - Sources: https://www.greptile.com/docs/code-review/greptile-config-reference , https://www.greptile.com/docs/code-review/custom-standards
- **CLAUDE.md / AGENTS.md:**
  - `greptile onboard` imports `CLAUDE.md`, `.claude/rules/**/*.md`, `AGENTS.md`, `.cursorrules` and `.cursor/rules/**/*.mdc` as org-wide custom context. "There is no picker — anything it finds, it takes."
  - The import is **one-time at onboarding**, not kept in sync.
  - Needs CLI ≥ 3.2.0 and Node 22+.
  - Sources: https://www.greptile.com/docs/code-review/cli-onboarding , changelog 2026-07-15
  - To keep CLAUDE.md live, point to it in `files.json` / `customContext.files`. That is my suggestion, based on the documented file-context feature.
- **Memory / learning** (improved 2026-05-12). It learns from:
  - team PR comments
  - replies to Greptile
  - 👍/👎 reactions
  - whether comments were addressed between the first and last commit

  It also infers suggested rules and suppresses a comment category after about "3 ignores". Docs say about "2-3 weeks of consistent reactions" are needed, with a "Week 9+" timeline to highly personalised reviews. Sources: https://www.greptile.com/docs/how-greptile-works/memory-and-learning , https://www.greptile.com/docs/code-review/developer-essentials
- **Auto-approve** (beta, 2026-06-26): approves after a clean 5/5 review under a configurable risk ceiling, and dismisses the approval on new pushes. https://www.greptile.com/docs/code-review/auto-approve-prs

---

## 4. Language (Russian)

- Greptile documents a "Multi-language reviews" recipe:
  - put "Always respond in Japanese" in the dashboard Custom Instructions and/or `instructions` in greptile.json;
  - or ask inline;
  - "Set language in **both** dashboard and greptile.json for consistent results."
  - Source: https://www.greptile.com/docs/code-review/tips-recipes
- By analogy, "Всегда отвечай на русском" should work. I found no public example of Russian specifically: UNVERIFIED.
- Fixed template labels ("Confidence Score", badges, "Findings") are likely to stay English: UNVERIFIED.
- No source says anything about reading Russian PR descriptions or docs as context. The underlying models are frontier Claude/GPT (model-inversion post), which handle Russian well. Quality on Russian context: UNVERIFIED.
- "All languages supported" in the docs refers to *programming* languages. https://www.greptile.com/docs/introduction

---

## 5. Integrations

- **Code hosts (cloud):** GitHub (Cloud, Enterprise Cloud, Enterprise Server) and GitLab (Cloud, Self-Managed). https://www.greptile.com/docs/introduction , https://www.greptile.com/docs/quickstart
  - The config reference also mentions Bitbucket (Cloud and Data Center), Gitea, "Origin" and Perforce for status checks and auto-approve. https://www.greptile.com/docs/code-review/greptile-config-reference
  - There is no public setup guide for Bitbucket or Gitea; third-party sites still say "no Bitbucket". Treat as UNVERIFIED or Enterprise-only.
- **Plain git / bare mirror: not supported** as a review source. Reviews are webhook-driven PR/MR reviews on a supported host.
  - The CLI (`greptile review`) reviews a local branch against its base without a PR.
  - But onboarding needs "a remote on GitHub or GitLab", `review status` fails when "the repository has no origin", and CLI reviews are not on the free plan.
  - Sources: https://www.greptile.com/docs/code-review/greptile-cli , cli-onboarding.
  - So without GitHub the realistic paths are a GitLab (self-managed) instance, or the CLI against a repo connected on a supported host. Whether a Gitea instance works on the cloud plan: UNVERIFIED.
- **CLI:** `greptile review` with `--json`, `--agent` (plain text for agents), `--instructions`, `--resume`, `review status` exit codes for hooks, and `greptile config <path>` to show the effective rules. Current version v3.2.3. https://www.greptile.com/docs/code-review/greptile-cli
- **MCP server** (since 2025-09-15). Tools:
  - fetch unaddressed comments
  - review status
  - search feedback patterns
  - manage custom context
  - knowledge base

  OAuth; works in Claude Code, Cursor, VS Code and Codex. https://www.greptile.com/docs/mcp-v2/overview
- **Claude Code:**
  - Official plugin (`/plugin marketplace add greptileai/claude-plugin`), bundling the MCP server and CLI; `/greptile:review` runs a "headless" review with no PR needed. https://www.greptile.com/docs/integrations/claude-code (plugin since 2026-01-05)
  - Open-source skills `check-pr` etc., which loop fixes until checks are clean; they need `gh`. https://github.com/greptileai/skills , https://www.greptile.com/docs/mcp-v2/skills
  - "Fix with your Agent / Fix All" button sends findings to Claude Code, Codex, Conductor, Cursor or Devin through a local "Greptile Bridge" CLI. https://www.greptile.com/docs/integrations/fix-with-your-agent
- **IDE:** the VS Code extension is "**deprecated** until further notice" (repo README, ret. 2026-09-17). https://github.com/greptileai/greptile-vscode . The IDE path is now MCP.
- **Jira/Confluence and Linear:** yes; PRs are reviewed against linked tickets. https://www.greptile.com/docs/jira-integration , https://www.greptile.com/docs/linear-integration
- **Slack:** no Slack integration in the docs; Slack appears only as an Enterprise support channel. https://www.greptile.com/pricing

---

## 6. Security / privacy

- SOC 2 Type II. https://www.greptile.com/security (page "last updated January 2026"), https://www.greptile.com/docs/introduction ; trust center https://trust.greptile.com/ (JS-rendered, could not read).
- Code "remains cached on our machines until access is revoked in GitHub or GitLab, at which point it is deleted".
  - Stored on an encrypted filesystem.
  - Embeddings of paths, docs and generated docstrings live in a vector database.
  - Hard delete within 24 hours of admin deletion; backups within 30 days.
  - LLM inference goes through OpenAI and Anthropic APIs.
  - Hosted on AWS and Azure.
  - Source: https://www.greptile.com/security
- **Training:** the security page says Greptile may use anonymized customer data for model improvement, with an opt-out in settings. The Organization Settings toggle **"Help us improve Greptile" is ON by default** and learns from review activity (comments, replies, reactions). https://www.greptile.com/docs/account/organization-settings . Turn it off if needed.
- Self-hosted: Docker Compose (up to 100 devs) or Kubernetes/Helm, air-gapped, your own LLMs (OpenAI, Anthropic, Bedrock, Azure OpenAI, Vertex). Enterprise licence only. https://www.greptile.com/docs/deployment-options , https://www.greptile.com/docs/security/selfhost

---

## 7. Evidence of quality (flag: most numbers are vendor-produced)

- **Greptile's own benchmark:** July 2025; 50 bug-fix PRs from Sentry, Cal.com, Grafana, Keycloak and Discourse. Catch rates: Greptile 82%, Bugbot 58%, Copilot 54%, CodeRabbit 44%, Graphite 6%.
  - "Scoring considered only detection of the original bug; false positives… did not affect the catch rate". So it measures recall only, not noise.
  - **Vendor-run.**
  - Sources: https://www.greptile.com/benchmarks ; same data on https://www.greptile.com/greptile-vs-coderabbit
- **Martian Code Review Bench:**
  - Independent, open-source, MIT; online precision/recall from what developers actually fixed, plus an offline set of 50 PRs from the same five repos.
  - Leaderboard is live: https://codereview.withmartian.com/ (JS-rendered, not read directly); method at https://github.com/withmartian/code-review-benchmark (last commit 2026-08-30).
  - Both vendors quote it at different moments:
    - CodeRabbit (2026-03-03): #1 by F1 51.2% (precision 49.2%, recall 53.5%) over ~300k PRs in Jan–Feb 2026. https://www.coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark
    - Greptile (2026-07-30): #1 by F1 60.8% (precision 76.2%, recall 50.6%) vs CodeRabbit F1 57.5% (precision 64.9%, recall 51.6%). https://www.greptile.com/content-library/greptile-martian-code-review-benchmark
  - Read: the two are close. As of late July, Greptile is quoted as more precise and CodeRabbit as slightly higher recall. The live board moves.
- **"11 false positives vs CodeRabbit's 2" and "independent re-evaluation ≈45%":** repeated by SEO/comparison blogs, e.g. https://dev.to/jovan_chan_9500711396d4e6/greptile-review-2026-82-bug-catch-rate-the-1review-trap-and-who-should-pay-30month-4jao . No traceable primary source found: **UNVERIFIED, low credibility**.
- **Noise complaint:** HN comment (2026-01-27): "pretty much pure noise… ran it for 3 PRs and then gave up".
  - Examples: suggested silencing an exception; flagged Python 3.14 as "does not exist yet"; a vague async remark; a misleading 4/5 confidence score.
  - The same person says CodeRabbit "worked really well" and its learnings stopped repeats.
  - Pre-v4/v5, n=1.
  - https://news.ycombinator.com/item?id=46777079
- **Scale claim:** about 2,000 companies (PostHog, Brex, …), "a billion lines of code… every month". Co-founder on HN, 2025-12-17. https://news.ycombinator.com/item?id=46301887
- **Pricing backlash** (see §2): greptile-fail.vercel.app; HN 2026-04-30.

---

## Open questions to check in the app (cannot be answered from public sources)
1. Billing → plan status: is it Starter or a Pro trial, and what is the end date?
2. T-Rex settings:
   - per-PR filters and "when it runs"
   - whether a TREX run needs env vars or services (Postgres), and whether the sandbox can start them
   - the credit cost shown per run
3. Whether Model Inversion is on for the org.
4. Test one PR with `instructions: "Always respond in Russian"` and look at which parts stay English.
5. How GitHub account suspension affects things: Greptile has no documented path for a plain git mirror.
