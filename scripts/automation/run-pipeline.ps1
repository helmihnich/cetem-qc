<#
.SYNOPSIS
  CETEM-QC automated BMAD pipeline.

  For every remaining story, in order, it runs separate fresh Claude Code sessions:
    spec -> build -> code review -> pipeline gates -> regression review -> gates -> commit + push
  After each epic: retrospective (+ commit + push).
  At the end: full gates, full-project bug hunt, Expo exports, final report (+ commit + push).

  It NEVER skips a story. When something needs a human decision, or fails twice,
  it stops, writes .automation/NEEDS-YOU.md and exits. Rerun the same command to resume.

.EXAMPLES
  # see the queue and what is already done
  powershell -ExecutionPolicy Bypass -File scripts\automation\run-pipeline.ps1 -DryRun

  # first run: only one story, to watch it
  powershell -ExecutionPolicy Bypass -File scripts\automation\run-pipeline.ps1 -MaxStories 1

  # full run (resumes where it stopped)
  powershell -ExecutionPolicy Bypass -File scripts\automation\run-pipeline.ps1
#>
[CmdletBinding()]
param(
  [int]$MaxStories = 0,            # 0 = no limit
  [switch]$DryRun,
  [string]$PermissionMode = 'auto', # use 'acceptEdits' if 'auto' is not available on your plan
  [string]$Model = '',             # '' = Claude Code default
  [int]$MaxTurns = 300,
  [int]$RateLimitWaitMinutes = 30, # used only when the limit message has no reset time
  [int]$RateLimitMaxWaits = 400    # keeps waiting through session and weekly limits (Ctrl+C to stop)
)

$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------- paths / constants
$Root = (git rev-parse --show-toplevel 2>$null)
if (-not $Root) { Write-Host 'Run this from inside the cetem-qc git repository.' -ForegroundColor Red; exit 1 }
$Root = $Root.Trim()
Set-Location $Root

$Auto        = Join-Path $Root '.automation'
$LogDir      = Join-Path $Auto 'logs'
$AnswersDir  = Join-Path $Auto 'answers'
$DoneFile    = Join-Path $Auto 'done.txt'
$CurrentFile = Join-Path $Auto 'current.txt'
$ResultFile  = Join-Path $Auto 'result.json'
$TaskFile    = Join-Path $Auto 'task.md'
$RulesFile   = Join-Path $Auto 'rules.md'
$GateFile    = Join-Path $Auto 'gate-failure.md'
$NeedsYou    = Join-Path $Auto 'NEEDS-YOU.md'
$RunLog      = Join-Path $LogDir 'run.log'
$SprintFile  = Join-Path $Root '_bmad-output\implementation-artifacts\sprint-status.yaml'

$LocalDbUrl  = 'postgresql://cetem:cetem@127.0.0.1:5432/cetem_qc'
$PgContainer = 'cetem-qc-postgres'

foreach ($d in @($Auto, $LogDir, $AnswersDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }
if (-not (Test-Path $DoneFile)) { New-Item -ItemType File -Path $DoneFile | Out-Null }

function Write-Utf8([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Log([string]$Msg, [string]$Color = 'Gray') {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
  Write-Host $line -ForegroundColor $Color
  Add-Content -Path $RunLog -Value $line -Encoding UTF8
}

# ---------------------------------------------------------------- the queue (order matters, nothing is skipped)
$Brief67 = @'
NEW STORY (add it to epics.md under Epic 6 and to sprint-status.yaml).
Title: Harden the test harness and recover unreadable local drafts.
This story makes the pipeline's safety net real before the remaining stories are built:
1. Every test file in every workspace runs under `pnpm -r test` (today only 3 of the 16 apps/api test files run).
   PostgreSQL-backed tests use the local Docker database from DATABASE_URL
   (postgresql://cetem:cetem@127.0.0.1:5432/cetem_qc), apply the migrations to an isolated test
   database or schema, and clean up after themselves. They must never touch a non-local database.
2. `pnpm -r typecheck` also type-checks every package under packages/* including their test files.
3. Mobile: on the draft-compatibility notice, add a confirmed « Supprimer le brouillon local » action that
   deletes a draft row the app can no longer parse (repository method scoped to employee + task, no parsing).
   After any explicit delete, reset the form values and re-seed the paper-form defaults.
4. Fix _bmad-output/implementation-artifacts/epic-6-context.md so tolerance ownership matches Story 6.6.
5. Review the open `action_items` in sprint-status.yaml: implement the small ones, mark them done;
   leave larger ones open with a note.
'@

$Brief24 = @'
NEW STORY (add it to epics.md under Epic 2 and to sprint-status.yaml; set epic-2 to in-progress,
then back to done when this story is done; its retrospective is already done).
Title: Reset a forgotten password through the Responsable (no email).
- Web (Responsable): « Réinitialiser le mot de passe » for an Employé of their own team. It generates a
  one-time temporary credential shown once (reuse the Story 3.2 hand-over mechanism), forces a password
  change at next login (Story 2.3 flow) and revokes the Employé's existing sessions. Not allowed for a
  deactivated Employé and never across teams.
- Responsable who forgot their own password: an operator-only CLI script (pnpm script, run on the server)
  that sets a temporary password for a Responsable account, forces the change and revokes sessions. Document it.
- Login screens: web « Mot de passe oublié ? Contactez votre administrateur. », mobile
  « Mot de passe oublié ? Contactez votre Responsable. »
- Log/audit the reset without ever logging the credential. Server-side role checks; tests for all of it.
'@

function New-StoryItem([string]$Key, [int]$Epic, [string]$Brief = '') { @{ Type = 'story'; Key = $Key; Epic = $Epic; Brief = $Brief } }
function New-RetroItem([int]$Epic) { @{ Type = 'retro'; Key = "epic-$Epic-retrospective"; Epic = $Epic; Brief = '' } }

$Queue = @(
  (New-StoryItem '6-7-harden-the-test-harness-and-recover-unreadable-drafts' 6 $Brief67),
  (New-StoryItem '2-4-reset-a-forgotten-password-through-the-responsable' 2 $Brief24),
  (New-StoryItem '6-3-display-authorized-calculation-results-in-the-employe-form' 6),
  (New-StoryItem '6-4-display-authorized-calculation-results-in-responsable-review' 6),
  (New-StoryItem '6-5-separate-formula-regression-fixtures-from-approved-acceptanc' 6),
  (New-RetroItem 6),
  (New-StoryItem '7-1-queue-durable-synchronization-operations' 7),
  (New-StoryItem '7-2-show-synchronization-and-submission-state-distinctly' 7),
  (New-StoryItem '7-3-accept-submissions-transactionally-and-idempotently' 7),
  (New-StoryItem '7-4-freeze-accepted-measurements-and-comments' 7),
  (New-RetroItem 7),
  (New-StoryItem '8-1-resolve-a-synchronization-conflict-explicitly' 8),
  (New-StoryItem '8-2-create-a-correction-draft-after-validation-rejection' 8),
  (New-StoryItem '8-3-create-a-responsable-only-replacement-after-acceptance' 8),
  (New-StoryItem '8-4-handle-unfinished-tasks-after-employee-deactivation' 8),
  (New-RetroItem 8),
  (New-StoryItem '9-1-review-accepted-audit-evidence-read-only' 9),
  (New-StoryItem '9-2-generate-deterministic-insight-proposals-from-approved-rules' 9),
  (New-StoryItem '9-3-retain-or-discard-proposed-insights-with-provenance' 9),
  (New-StoryItem '9-4-add-a-manual-insight' 9),
  (New-RetroItem 9),
  (New-StoryItem '10-1-request-an-ai-assisted-summary-draft' 10),
  (New-StoryItem '10-2-write-edit-and-explicitly-confirm-a-summary' 10),
  (New-StoryItem '10-3-reopen-a-confirmed-summary-before-official-designation' 10),
  (New-StoryItem '10-4-record-the-explicit-human-machine-conformity-decision' 10),
  (New-RetroItem 10),
  (New-StoryItem '11-1-generate-an-inspectable-word-report-candidate' 11),
  (New-StoryItem '11-2-validate-scan-and-store-a-manual-pdf-file' 11),
  (New-StoryItem '11-3-create-a-report-candidate-from-a-ready-pdf' 11),
  (New-StoryItem '11-4-designate-exactly-one-current-report-official' 11),
  (New-StoryItem '11-5-view-and-download-authorized-completed-history' 11),
  (New-StoryItem '11-6-keep-report-candidates-current-through-asynchronous-processi' 11),
  (New-RetroItem 11),
  (New-StoryItem '12-1-configure-a-controlled-pov-deployment-environment' 12),
  (New-StoryItem '12-2-emit-useful-security-and-workflow-diagnostics' 12),
  (New-StoryItem '12-3-demonstrate-account-provisioning-through-assigned-mobile-wor' 12),
  (New-StoryItem '12-4-demonstrate-offline-persistence-through-server-acceptance' 12),
  (New-StoryItem '12-5-demonstrate-conflict-and-validation-correction-recovery' 12),
  (New-StoryItem '12-6-demonstrate-review-summary-and-human-decision-gates' 12),
  (New-StoryItem '12-7-demonstrate-report-candidates-through-authorized-history' 12),
  (New-StoryItem '12-8-demonstrate-post-acceptance-replacement-and-deactivation-rec' 12),
  (New-StoryItem '12-9-record-performance-and-platform-acceptance-conditions' 12),
  (New-RetroItem 12),
  @{ Type = 'final'; Key = 'final'; Epic = 0; Brief = '' }
)

# ---------------------------------------------------------------- rules appended to every session's system prompt
$Rules = @'
# CETEM-QC automated pipeline - rules for this session

You are running UNATTENDED inside an automated pipeline. Nobody can answer questions during the run.

## Output contract (mandatory)
Before you finish, write the file `.automation/result.json` (UTF-8, valid JSON, nothing else in it):
{"status": "ok" | "needs_human" | "failed" | "regression_found", "summary": "2-6 sentences of what you did", "questions": ["..."]}
- "ok": the task in .automation/task.md is fully done and every gate you were asked to run passes.
- "needs_human": a decision only a human can make blocks the task (see "Never invent"). Put each question in "questions", phrased so the user can answer it. Leave the working tree in a sensible state.
- "failed": you could not complete it (explain why in summary).
- "regression_found": only for regression reviews, when you found and fixed a regression.

## Git
Never run git commit, git push, git reset, git checkout/switch, git stash, git clean or git rebase.
The pipeline commits and pushes. Leave your changes uncommitted in the working tree.

## Secrets
Never open, print or copy `.env` or any secret. Code reads secrets from environment variables only
(GEMINI_API_KEY, NEON_DATABASE_URL, DATABASE_URL ...). Provide `.env.example` entries with empty values when you add a variable.

## Never invent (stop with needs_human instead)
Never invent CETEM BH business rules: formulas, tolerances, boundaries, regulatory/legal rules.
The official paper form (docs/product/source/formulaire-cetem/) is the authority for the QC form and calculations.
Never invent external accounts, credentials or paid services. Use what the code, approved specs,
the paper form and the decisions below already settle - record such resolutions as decisions in the spec.

## Decisions already made by the Product Owner (Helmi) - apply them, do not ask again
- Final machine conformity is ALWAYS an explicit human decision by the Responsable. No automatic overall conformity.
- Per-test verdicts follow Story 6.6 (rule cetem-paper-form 2.0.0). Light-field tolerance is unknown: verdict « indisponible ».
- Forgotten password: reset by the Responsable (Employé) or an operator CLI (Responsable). No email server.
- AI summary (Epic 10): provider adapter with two implementations: "mock" (default; fixed French text; used by ALL tests)
  and "gemini" (Google Gemini API, key from env GEMINI_API_KEY, enabled by env AI_PROVIDER=gemini). AI failure never blocks
  the workflow; the Responsable can always write the summary by hand. Never send real client names in tests.
- Word report (Epic 11): build a .docx template that reproduces the official paper report
  « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie N° …/LCQ » from the photos in
  docs/product/source/formulaire-cetem/ (same sections, tables, order and French labels), with the logo
  docs/product/source/cetem-logo.png in the header. Fill measurements, calculated values with their per-test verdict,
  comments, « Conclusion générale », « Contrôle effectué par ». Leave the « Signature » cells empty (signed by hand).
- Uploaded PDF (Epic 11): verify it is a real PDF (magic bytes %PDF, size limit 20 MB). Antivirus behind an adapter:
  "none" (default, records « analyse antivirus non effectuée (PoV) ») and "clamav" (optional, Docker). Tests use "none".
- Deployment (Epic 12): prepare docker-compose for local demo, env templates, and a French deployment guide for
  web on Vercel, API on Render, PostgreSQL on Neon (connection string from env NEON_DATABASE_URL on the server only).
  Do NOT deploy anything and do not require accounts. Demonstration stories are proven with automated end-to-end tests.
- No migration of old local drafts (PoV, no deployed users); unreadable drafts can be deleted locally.
- UI text in French. Mobile works offline. Mobile and API calculations only delegate to packages/domain.

## Quality
Follow the existing BMAD workflow and the conventions of this repository. Never delete, skip (.skip/.only/todo) or
weaken a test to make a gate pass, and never edit the gate scripts to make them pass. Fix root causes.
Gates the pipeline runs itself (all must pass):
  pnpm -r test | pnpm -r typecheck | pnpm boundaries:check | pnpm contracts:check | git diff --check
DATABASE_URL is already set to the local Docker PostgreSQL. Do not start long-running dev servers and leave them running.
'@

# ---------------------------------------------------------------- task templates
$TplHeader = @'
# Automated pipeline task - {{STEP}} - {{KEY}}

Story key: `{{KEY}}` (epic {{EPIC}}). Use this exact key in sprint-status.yaml.
{{BRIEF}}
{{ANSWERS}}
{{RETRY}}
'@

$TplSpec = @'
## Task: create (or refresh) the story spec - do not implement code
Use the bmad-spec skill in non-interactive (headless) mode.
- Find the story in _bmad-output/planning-artifacts/epics.md. If it is a NEW story (see brief), add a short entry under its epic in the same format.
- If an older spec for this story exists (for example in _bmad-output/implementation-artifacts/), refresh it against the CURRENT code,
  identity versions and decisions instead of trusting it.
- Read the current code, the specs of the stories it depends on, the paper-form photos and deferred-work.md items that concern this story.
- Resolve questions yourself only when the answer follows from the code, approved specs, the paper form, or the decisions in your rules.
  Record each such resolution as a decision in the spec. A real business decision left open => status needs_human.
- When the spec is complete: mark it approved, set the story to ready-for-dev in sprint-status.yaml (add the key if missing, set its epic to in-progress).
'@

$TplBuild = @'
## Task: implement the story
Use the bmad-build skill. Implement `{{KEY}}` from its approved spec (read every companion file listed in its frontmatter).
Follow the spec exactly; write the tests from its test plan. Run all gates and fix failures until they pass.
Set the story to review in sprint-status.yaml. Do not run a code review in this session.
'@

$TplReview = @'
## Task: fresh code review
Use the bmad-code-review skill on story `{{KEY}}` against its approved spec. You did not write this code - review it critically.
Decide each finding yourself (non-interactive): patch confirmed findings, defer only what is truly out of scope
(write it to _bmad-output/implementation-artifacts/deferred-work.md), reject the rest with a one-line reason in the spec.
Rerun all gates. Set the story to done in sprint-status.yaml ONLY if all gates pass and no blocking finding remains.
A finding that needs a business decision => status needs_human.
'@

$TplRegression = @'
## Task: regression review (not a re-review of the story)
Story `{{KEY}}` is implemented and reviewed; its changes are uncommitted (see git status and git diff).
Check whether these changes broke or weakened anything ELSEWHERE: other modules, packages/domain, API contracts and types,
auth/sessions/roles, mobile offline drafts and authorization, version identity, and the acceptance criteria of stories already done.
Check that no test was deleted, skipped (.skip/.only/todo) or weakened.
If you find a regression: fix it, add a test that would have caught it, rerun all gates, status regression_found.
If you find nothing: status ok.
'@

$TplFix = @'
## Task: fix failing gates
The pipeline's own gate run failed. The failing commands and the end of their output are in `.automation/gate-failure.md`.
Find the root cause and fix the code. Never delete, skip or weaken tests and never edit the gate scripts.
Rerun the failing commands until they pass. status ok if all pass, failed otherwise.
'@

$TplBugHunt = @'
## Task: full-project bug hunt
Review the WHOLE project, not only recent changes: apps/api, apps/web, apps/mobile, packages/*.
Look for real bugs: logic errors, unhandled errors, broken offline/sync/conflict behaviour, auth or role gaps, cross-team data
leaks, version-identity mistakes, calculation or tolerance mismatches with the paper form and Story 6.6, wrong French UI text,
missing tests on critical paths. Use subagents to cover areas in parallel when useful.
Fix each confirmed bug with a regression test. Write what you found and fixed to
_bmad-output/implementation-artifacts/bug-hunt-{{DATE}}.md. Rerun all gates. status ok when all gates pass.
'@

$TplRetro = @'
## Task: epic retrospective
Use the bmad-retrospective skill for epic {{EPIC}} in autonomous/headless mode (no questions).
Base it on the epic's specs, review findings, deferred-work.md and the git history of the epic.
Write the retrospective file, append its action items to sprint-status.yaml, set epic-{{EPIC}}-retrospective to done
and epic-{{EPIC}} to done (only if all its stories are done; otherwise status failed and explain).
'@

$TplFinal = @'
## Task: final verification
1. In sprint-status.yaml, every story must be done. List any that is not (status failed if any).
2. Verify the Android and iOS Expo JavaScript exports of apps/mobile, as earlier stories did (--no-bytecode is acceptable).
3. Write _bmad-output/automation/FINAL-REPORT.md in French: what was built per epic, gate results, known limitations
   (deferred-work.md), what still needs the user (deployment accounts, light-field tolerance, Gemini key for the demo),
   and a step-by-step manual test guide for the web app and the mobile app.
'@

function New-TaskText([string]$Step, [hashtable]$Item, [string]$Body, [string]$RetryNote = '') {
  $answersPath = Join-Path $AnswersDir ($Item.Key + '.md')
  $answers = ''
  if (Test-Path $answersPath) {
    $answers = "## Answers from the Product Owner (authoritative)`n" + (Get-Content $answersPath -Raw -Encoding UTF8)
  }
  $brief = ''
  if ($Item.Brief) { $brief = "## Story brief`n" + $Item.Brief }
  $retry = ''
  if ($RetryNote) { $retry = "## Previous attempt`nA previous session for this step did not finish: $RetryNote`nContinue from the current working tree." }
  $t = $TplHeader + "`n" + $Body
  $t = $t.Replace('{{STEP}}', $Step).Replace('{{KEY}}', $Item.Key).Replace('{{EPIC}}', [string]$Item.Epic)
  $t = $t.Replace('{{BRIEF}}', $brief).Replace('{{ANSWERS}}', $answers).Replace('{{RETRY}}', $retry)
  $t = $t.Replace('{{DATE}}', (Get-Date -Format 'yyyy-MM-dd-HHmm'))
  return $t
}

# ---------------------------------------------------------------- state helpers
function Test-StepDone([string]$Id) { return @(Get-Content $DoneFile -Encoding UTF8) -contains $Id }
function Set-StepDone([string]$Id) { Add-Content -Path $DoneFile -Value $Id -Encoding UTF8; Log "done: $Id" 'Green' }

function Get-StoryStatus([string]$Key) {
  $m = Select-String -Path $SprintFile -Pattern ('^\s*' + [regex]::Escape($Key) + ':\s*([A-Za-z-]+)') | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value }
  return ''
}

function Stop-NeedsYou([string]$Key, [string]$Reason, $Questions) {
  $q = ''
  foreach ($x in @($Questions)) { if ($x) { $q += "- $x`n" } }
  $text = @"
# The pipeline stopped and needs you

Story / step: $Key
Reason: $Reason

## Questions
$q
## How to continue
1. Write your answers in: .automation/answers/$Key.md   (plain text, one answer per question)
2. Delete this file (.automation/NEEDS-YOU.md)
3. Rerun the same command. The pipeline resumes at the same step and passes your answers to Claude.

Logs: .automation/logs/
"@
  Write-Utf8 $NeedsYou $text
  Log "STOPPED: $Key - $Reason" 'Yellow'
  Write-Host $text -ForegroundColor Yellow
  exit 2
}

# ---------------------------------------------------------------- Claude session
$Allowed = @(
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'Agent', 'Task', 'TodoWrite',
  'Bash(pnpm *)', 'Bash(npx *)', 'Bash(node *)', 'Bash(tsx *)', 'Bash(uv *)', 'Bash(python *)',
  'Bash(git status)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git diff)', 'Bash(git log *)', 'Bash(git show *)',
  'Bash(git ls-files *)', 'Bash(git rev-parse *)', 'Bash(git check-ignore *)', 'Bash(git blame *)',
  'Bash(docker ps *)', 'Bash(docker exec *)', 'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)',
  'Bash(grep *)', 'Bash(find *)', 'Bash(wc *)', 'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)', 'Bash(sed *)', 'Bash(perl *)'
) -join ','
$Denied = @(
  'Bash(git commit *)', 'Bash(git push *)', 'Bash(git push)', 'Bash(git reset *)', 'Bash(git checkout *)', 'Bash(git switch *)',
  'Bash(git stash *)', 'Bash(git clean *)', 'Bash(git rebase *)', 'Bash(rm -rf *)',
  'Read(./.env)', 'Read(.env)', 'Bash(cat .env*)', 'Bash(type .env*)'
) -join ','

function Get-LimitWaitSeconds([string]$Text) {
  # "You've hit your session limit · resets 2:40pm (Africa/Tunis)" -> wait until 2:40pm + 2 min
  if ($Text -match '(?i)resets\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)') {
    $h = [int]$Matches[1]; $m = 0
    if ($Matches[2]) { $m = [int]$Matches[2] }
    $ampm = $Matches[3].ToLower()
    if ($ampm -eq 'pm' -and $h -lt 12) { $h += 12 }
    if ($ampm -eq 'am' -and $h -eq 12) { $h = 0 }
    $now = Get-Date
    $t = $now.Date.AddHours($h).AddMinutes($m)
    # reset time just passed (or clocks differ a bit): retry in 2 minutes; long past: it means tomorrow
    if ($t -le $now -and ($now - $t).TotalMinutes -lt 60) { return 120 }
    if ($t -le $now) { $t = $t.AddDays(1) }
    return [int]($t - $now).TotalSeconds + 120
  }
  return $RateLimitWaitMinutes * 60
}

function Invoke-ClaudeStep([string]$StepId, [string]$SkillPrompt, [string]$TaskText) {
  Write-Utf8 $TaskFile $TaskText
  if (Test-Path $ResultFile) { Remove-Item $ResultFile -Force }

  $prompt = "$SkillPrompt Read the task file .automation/task.md and follow it exactly. Finish by writing .automation/result.json as your rules require."
  $cliArgs = @('-p', $prompt,
            '--output-format', 'json',
            '--permission-mode', $PermissionMode,
            '--permission-prompts', 'none',
            '--max-turns', [string]$MaxTurns,
            '--append-system-prompt-file', $RulesFile,
            '--allowedTools', $Allowed,
            '--disallowedTools', $Denied)
  if ($Model) { $cliArgs += @('--model', $Model) }

  $safeId = ($StepId -replace '[^A-Za-z0-9._-]', '_')
  $waits = 0
  while ($true) {
    $logPath = Join-Path $LogDir ('{0}_{1}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $safeId)
    Log "claude session: $StepId" 'Cyan'
    $raw = (& claude @cliArgs 2>&1 | Out-String)
    $code = $LASTEXITCODE
    Write-Utf8 $logPath $raw

    $res = $null
    foreach ($line in ($raw -split "`r?`n" | Sort-Object -Property Length -Descending)) {
      $l = $line.Trim()
      if ($l.StartsWith('{') -and $l.Contains('"type"')) { try { $res = $l | ConvertFrom-Json; break } catch { } }
    }
    $isError = ($code -ne 0) -or ($res -and $res.is_error)
    if ($res -and $res.total_cost_usd) { Log ('  session cost estimate: ${0:N2}' -f $res.total_cost_usd) }

    if ($isError) {
      $errText = $raw
      if ($res -and $res.result) { $errText = [string]$res.result }
      if ($errText -match '(?i)failed to authenticate|oauth|not logged in|/login|invalid api key|authentication_failed|credentials') {
        Stop-NeedsYou $StepId ("Claude Code is not logged in: " + $errText.Trim()) @(
          'Run: claude setup-token   then save the token:  [Environment]::SetEnvironmentVariable(''CLAUDE_CODE_OAUTH_TOKEN'', ''<token>'', ''User'')  and reopen VS Code',
          'Or run: claude   then type /login   then exit',
          'Check with: claude auth status   (must say loggedIn true), then delete NEEDS-YOU.md and rerun')
      }
    }
    $limitHit = $false
    if ($isError) {
      if ($res -and ($res.api_error_status -eq 429 -or $res.api_error_status -eq 529)) { $limitHit = $true }
      if ($raw -match '(?i)hit your .{0,20}limit|session limit|weekly limit|usage limit|rate.?limit|limit reached|overloaded|try again later|resets\s') { $limitHit = $true }
    }
    if ($limitHit) {
      $waits++
      if ($waits -gt $RateLimitMaxWaits) { Stop-NeedsYou $StepId 'Usage limit still reached after many waits.' @('Rerun later when your usage limit has reset.') }
      $limitText = $raw
      if ($res -and $res.result) { $limitText = [string]$res.result }
      $sec = Get-LimitWaitSeconds $limitText
      Log ("  usage limit reached: '{0}' - waiting {1} min until {2:ddd HH:mm} ({3}/{4})" -f ($limitText.Trim() -replace '\s+',' '), [int]($sec/60), (Get-Date).AddSeconds($sec), $waits, $RateLimitMaxWaits) 'Yellow'
      $until = (Get-Date).AddSeconds($sec)
      while ((Get-Date) -lt $until) {
        Start-Sleep -Seconds ([Math]::Min(1800, [Math]::Max(1, [int]($until - (Get-Date)).TotalSeconds)))
        if ((Get-Date) -lt $until) { Log ("  still waiting for the usage limit (until {0:ddd HH:mm})" -f $until) }
      }
      continue
    }
    break
  }

  if (Test-Path $ResultFile) {
    try {
      $r = Get-Content $ResultFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if (-not $r.status) { $r = [pscustomobject]@{ status = 'failed'; summary = 'result.json has no status'; questions = @() } }
      Log ("  result: {0} - {1}" -f $r.status, $r.summary)
      return $r
    } catch { }
  }
  $why = 'no valid .automation/result.json (exit code ' + $code + ')'
  if ($res -and $res.subtype) { $why += ', ' + $res.subtype }
  Log "  result: failed - $why" 'Red'
  return [pscustomobject]@{ status = 'failed'; summary = $why; questions = @() }
}

# runs a Claude step with one retry; returns the result object ('ok' or 'regression_found')
function Invoke-AgentStep([string]$Id, [hashtable]$Item, [string]$StepName, [string]$SkillPrompt, [string]$Body) {
  $retryNote = ''
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $task = New-TaskText $StepName $Item $Body $retryNote
    $r = Invoke-ClaudeStep $Id $SkillPrompt $task
    switch ($r.status) {
      'ok'               { return $r }
      'regression_found' { return $r }
      'needs_human'      { Stop-NeedsYou $Item.Key "$StepName needs a human decision: $($r.summary)" $r.questions }
      default            { $retryNote = $r.summary; Log "  attempt $attempt failed" 'Red' }
    }
  }
  Stop-NeedsYou $Item.Key "$StepName failed twice. Last reason: $retryNote" @('Look at the newest log in .automation/logs/ and tell Claude (or me) what to do, or rerun to try again.')
}

# ---------------------------------------------------------------- gates (run by the script itself)
function Invoke-Gates([string]$Label) {
  $env:DATABASE_URL = $LocalDbUrl
  $cmds = @('pnpm -r test', 'pnpm -r typecheck', 'pnpm boundaries:check', 'pnpm contracts:check', 'git diff --check')
  $failures = ''
  Log "gates: $Label" 'Cyan'
  foreach ($c in $cmds) {
    $out = (cmd /c "$c 2>&1" | Out-String)
    $code = $LASTEXITCODE
    Add-Content -Path (Join-Path $LogDir 'gates.log') -Value ("==== {0} | {1} | {2} | exit {3}`n{4}" -f (Get-Date), $Label, $c, $code, $out) -Encoding UTF8
    if ($code -ne 0) {
      Log "  FAIL: $c (exit $code)" 'Red'
      $tail = ($out -split "`r?`n" | Select-Object -Last 150) -join "`n"
      $fence = '```'
      $failures += "### $c (exit $code)`n$fence`n$tail`n$fence`n`n"
    } else { Log "  pass: $c" 'Green' }
  }
  if ($failures) { Write-Utf8 $GateFile ("# Gate failures ($Label)`n`n" + $failures); return $false }
  return $true
}

# gates, and if they fail: up to 2 fix sessions
function Assert-Gates([hashtable]$Item, [string]$Label) {
  if (Invoke-Gates $Label) { return }
  for ($i = 1; $i -le 2; $i++) {
    Invoke-AgentStep ($Item.Key + ':fix-' + $Label + '-' + $i) $Item 'fix failing gates' '' $TplFix | Out-Null
    if (Invoke-Gates "$Label-after-fix-$i") { return }
  }
  Stop-NeedsYou $Item.Key "Gates still failing after 2 fix attempts ($Label)." @('See .automation/gate-failure.md and .automation/logs/gates.log.')
}

# ---------------------------------------------------------------- commit + push with secret protection
function Test-StagedSecrets {
  # Returns a list of problems (empty = safe). Messages never contain the secret itself.
  $bad = @()
  foreach ($n in @(git diff --cached --name-only)) {
    if ($n -match '(^|/)\.env($|\.)' -and $n -notmatch '\.env\.example$') { $bad += "secret file staged: $n" }
  }
  $file = ''
  foreach ($line in @(git diff --cached -U0)) {
    if ($line -match '^\+\+\+ b/(.+)$') { $file = $Matches[1]; continue }
    if (-not $line.StartsWith('+')) { continue }
    if ($line -match 'AIza[0-9A-Za-z_\-]{30,}')     { $bad += "Google API key in $file" }
    if ($line -match 'AQ\.[0-9A-Za-z_\-]{30,}')      { $bad += "Google API key (AQ.) in $file" }
    if ($line -match 'sk-ant-[0-9A-Za-z_\-]{20,}')   { $bad += "Anthropic key in $file" }
    # database URL with a real-looking password (10+ chars) on a non-local, non-example host
    foreach ($m in [regex]::Matches($line, 'postgres(?:ql)?://[^\s:/@"''`]+:([^\s@"''`]+)@([^\s/:?"''`]+)')) {
      $pw = $m.Groups[1].Value; $hostName = $m.Groups[2].Value.ToLower()
      if ($pw -match '^(\$|<|\*|\{)' -or $pw.Length -lt 10) { continue }
      if ($hostName -match '^(127\.|localhost$|\[::1\]$|postgres$|db$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { continue }
      if ($hostName -match '(^|\.)(example\.(com|org|net)|example|test|invalid|local)$') { continue }
      $bad += "database URL with a password for host $hostName in $file"
    }
  }
  # the strongest check: no value from your real .env may appear in the commit
  $diff = (git diff --cached -U0 | Out-String)
  $envFile = Join-Path $Root '.env'
  if (Test-Path $envFile) {
    foreach ($envLine in (Get-Content $envFile -Encoding UTF8)) {
      if ($envLine -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$') {
        $v = $Matches[2].Trim('"').Trim("'")
        if ($v.Length -ge 12 -and $diff.Contains($v)) { $bad += "the value of $($Matches[1]) from .env appears in the staged changes" }
      }
    }
  }
  return $bad
}

function Invoke-CommitPush([string]$Key, [string]$Message) {
  git add -A 2>&1 | Out-Null
  $bad = Test-StagedSecrets
  if ($bad.Count -gt 0) {
    git reset -q 2>&1 | Out-Null
    Stop-NeedsYou $Key 'Secret protection blocked the commit.' $bad
  }
  $staged = @(git diff --cached --name-only)
  if ($staged.Count -eq 0) { Log "nothing to commit for $Key" 'Yellow'; return }
  git commit -q -m $Message 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-NeedsYou $Key 'git commit failed.' @('Run git status and check what blocks the commit.') }
  $out = (git push origin HEAD 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Log $out 'Red'
    Stop-NeedsYou $Key 'git push failed (the commit is saved locally).' @('Check your internet / GitHub login, run git push yourself, then rerun.')
  }
  Log "committed and pushed: $Message" 'Green'
}

# ---------------------------------------------------------------- pipeline steps
function Invoke-Story([hashtable]$Item) {
  $k = $Item.Key
  Write-Utf8 $CurrentFile $k
  Log "===== STORY $k =====" 'Magenta'

  if (-not (Test-StepDone "$k|spec")) {
    Invoke-AgentStep "$k|spec" $Item 'spec' '/bmad-spec' $TplSpec | Out-Null
    $st = Get-StoryStatus $k
    if ($st -ne 'ready-for-dev' -and $st -ne 'in-progress' -and $st -ne 'review') {
      Stop-NeedsYou $k "After the spec step the story status is '$st' (expected ready-for-dev)." @('Check the spec and sprint-status.yaml.')
    }
    Set-StepDone "$k|spec"
  }
  if (-not (Test-StepDone "$k|build")) {
    Invoke-AgentStep "$k|build" $Item 'build' '/bmad-build' $TplBuild | Out-Null
    $st = Get-StoryStatus $k
    if ($st -ne 'review' -and $st -ne 'done') { Stop-NeedsYou $k "After build the story status is '$st' (expected review)." @('Check the build log.') }
    Set-StepDone "$k|build"
  }
  if (-not (Test-StepDone "$k|review")) {
    Invoke-AgentStep "$k|review" $Item 'code review' '/bmad-code-review' $TplReview | Out-Null
    $st = Get-StoryStatus $k
    if ($st -ne 'done') { Stop-NeedsYou $k "After code review the story status is '$st' (expected done)." @('Check the review log and the Review Findings section of the spec.') }
    Set-StepDone "$k|review"
  }
  if (-not (Test-StepDone "$k|gates")) {
    Assert-Gates $Item 'after-review'
    Set-StepDone "$k|gates"
  }
  if (-not (Test-StepDone "$k|regression")) {
    $r = Invoke-AgentStep "$k|regression" $Item 'regression review' '' $TplRegression
    if ($r.status -eq 'regression_found') {
      Log '  regression found -> full-project bug hunt' 'Yellow'
      Invoke-AgentStep "$k|bughunt" $Item 'full-project bug hunt' '' $TplBugHunt | Out-Null
    }
    Assert-Gates $Item 'after-regression'
    Set-StepDone "$k|regression"
  }
  if (-not (Test-StepDone "$k|commit")) {
    Invoke-CommitPush $k ("feat: Story $k (automated pipeline)")
    Set-StepDone "$k|commit"
  }
  if (Test-Path $CurrentFile) { Remove-Item $CurrentFile -Force }
}

function Invoke-Retro([hashtable]$Item) {
  $k = $Item.Key
  Write-Utf8 $CurrentFile $k
  Log "===== RETROSPECTIVE epic $($Item.Epic) =====" 'Magenta'
  if (-not (Test-StepDone "$k|retro")) {
    Invoke-AgentStep "$k|retro" $Item 'retrospective' '/bmad-retrospective' $TplRetro | Out-Null
    Set-StepDone "$k|retro"
  }
  if (-not (Test-StepDone "$k|gates")) { Assert-Gates $Item 'retro'; Set-StepDone "$k|gates" }
  if (-not (Test-StepDone "$k|commit")) { Invoke-CommitPush $k ("docs: Epic $($Item.Epic) retrospective (automated pipeline)"); Set-StepDone "$k|commit" }
  if (Test-Path $CurrentFile) { Remove-Item $CurrentFile -Force }
}

function Invoke-Final([hashtable]$Item) {
  $k = 'final'
  Write-Utf8 $CurrentFile $k
  Log '===== FINAL VERIFICATION =====' 'Magenta'
  if (-not (Test-StepDone "$k|gates1"))  { Assert-Gates $Item 'final-1'; Set-StepDone "$k|gates1" }
  if (-not (Test-StepDone "$k|bughunt")) { Invoke-AgentStep "$k|bughunt" $Item 'final full-project bug hunt' '' $TplBugHunt | Out-Null; Set-StepDone "$k|bughunt" }
  if (-not (Test-StepDone "$k|gates2"))  { Assert-Gates $Item 'final-2'; Set-StepDone "$k|gates2" }
  if (-not (Test-StepDone "$k|report"))  { Invoke-AgentStep "$k|report" $Item 'final verification and report' '' $TplFinal | Out-Null; Set-StepDone "$k|report" }
  if (-not (Test-StepDone "$k|gates3"))  { Assert-Gates $Item 'final-3'; Set-StepDone "$k|gates3" }
  if (-not (Test-StepDone "$k|commit"))  { Invoke-CommitPush $k 'chore: final verification, bug hunt and report (automated pipeline)'; Set-StepDone "$k|commit" }
  if (Test-Path $CurrentFile) { Remove-Item $CurrentFile -Force }
}

function Test-ItemDone([hashtable]$Item) {
  if ($Item.Type -eq 'final') { return Test-StepDone 'final|commit' }
  return Test-StepDone ($Item.Key + '|commit')
}

# ---------------------------------------------------------------- dry run
if ($DryRun) {
  Write-Host "`nPipeline queue:" -ForegroundColor Cyan
  $i = 0
  foreach ($it in $Queue) {
    $i++
    $mark = '[ ]'; if (Test-ItemDone $it) { $mark = '[x]' }
    Write-Host ('{0,3}. {1} {2,-6} {3}' -f $i, $mark, $it.Type, $it.Key)
  }
  if (Test-Path $NeedsYou) { Write-Host "`nNEEDS-YOU.md is present - the pipeline is waiting for you." -ForegroundColor Yellow }
  exit 0
}

# ---------------------------------------------------------------- preflight
Log '===== PREFLIGHT =====' 'Magenta'
if (Test-Path $NeedsYou) {
  Write-Host (Get-Content $NeedsYou -Raw -Encoding UTF8) -ForegroundColor Yellow
  Write-Host 'Answer the questions, delete .automation/NEEDS-YOU.md, then rerun.' -ForegroundColor Yellow
  exit 2
}
git check-ignore -q '.automation/x' 2>$null
if ($LASTEXITCODE -ne 0) { Log 'Add the line .automation/ to .gitignore and commit it first.' 'Red'; exit 1 }
if (Test-Path (Join-Path $Root '.env')) {
  git check-ignore -q '.env' 2>$null
  if ($LASTEXITCODE -ne 0) { Log '.env is NOT ignored by git. Fix .gitignore first.' 'Red'; exit 1 }
}
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { Log "You are on branch '$branch'. Switch to main first." 'Red'; exit 1 }
$dirty = @(git status --porcelain)
if ($dirty.Count -gt 0 -and -not (Test-Path $CurrentFile)) {
  Log 'The working tree has uncommitted changes and no step is in progress. Commit or stash them first.' 'Red'
  $dirty | ForEach-Object { Write-Host "  $_" }
  exit 1
}
if (Test-Path $CurrentFile) { Log ('Resuming in-progress item: ' + (Get-Content $CurrentFile -Raw).Trim()) 'Yellow' }
$pg = (docker ps --filter "name=$PgContainer" --format '{{.Names}}' 2>$null | Out-String).Trim()
if (-not $pg) { Log "Docker container '$PgContainer' is not running. Start Docker Desktop and the container." 'Red'; exit 1 }
$authOut = (claude auth status 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $authOut -match '"loggedIn"\s*:\s*false') {
  Log 'Claude Code is not logged in. Run: claude setup-token (or claude then /login), then rerun.' 'Red'; exit 1
}
if ((Get-StoryStatus '6-6-align-calculation-rules-with-the-official-cetem-paper-form') -ne 'done') { Log 'Story 6.6 is not done in sprint-status.yaml.' 'Red'; exit 1 }

Write-Utf8 $RulesFile $Rules

# keep Windows awake while the pipeline runs
try {
  Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);' -ErrorAction Stop
  [Win32.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
} catch { Log 'Could not disable sleep automatically; set Windows sleep to Never.' 'Yellow' }

Log 'Preflight OK' 'Green'

# ---------------------------------------------------------------- main loop
$storiesRun = 0
foreach ($it in $Queue) {
  if (Test-ItemDone $it) { continue }
  if ($MaxStories -gt 0 -and $storiesRun -ge $MaxStories) { Log "MaxStories=$MaxStories reached - stopping here (rerun to continue)." 'Yellow'; exit 0 }
  switch ($it.Type) {
    'story' { Invoke-Story $it; $storiesRun++ }
    'retro' { Invoke-Retro $it }
    'final' { Invoke-Final $it }
  }
}

Log '===== PIPELINE COMPLETE =====' 'Green'
Log 'Read _bmad-output/automation/FINAL-REPORT.md, then test the app together with Claude.' 'Green'
exit 0
