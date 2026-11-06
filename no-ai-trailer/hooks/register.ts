import type { EngineInterface, Register } from 'claude-code'

// Four git guards on Bash commands: AI co-author trailers, commit subject format,
// force pushes, and secret files or keys in what is about to be added or committed.

// `git <sub>`, also with global options before it (`git -C path commit`).
const gitSub = (sub: string) => new RegExp(String.raw`\bgit\b(\s+-[cC]\s+\S+)*\s+${sub}\b`)
const COMMIT = gitSub('commit')
const PUSH = gitSub('push')
const ADD = gitSub('add')

// A co-author line naming a known AI tool; human co-authors pass.
// ponytail: fixed name list, add a name when a new tool slips through.
const AI_TRAILER = /co-authored-by:[^\n]*\b(claude|anthropic|copilot|cursor|codex|chatgpt|openai|gemini|aider|devin)\b/i

// True when `command` is a commit (or amend) whose message would carry an
// AI co-author trailer. Only sees the command text: `-F file` is not read.
export function hasAiTrailer(command: string): boolean {
  return COMMIT.test(command) && AI_TRAILER.test(command)
}

const TYPES = ['feat', 'fix', 'refactor', 'docs', 'style', 'perf', 'test', 'chore', 'build', 'ci']
const CONVENTIONAL = new RegExp(String.raw`^(${TYPES.join('|')})(\([^()\s]+\))?!?: \S`)
// Subjects git or a rebase writes, not the author.
const GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/
const MAX_SUBJECT = 50

// The subject a commit command sets: the first line of a heredoc message
// (`-F - <<'EOF'` or `-m "$(cat <<'EOF'`), else of the first `-m`. Null when
// the command sets none (editor, `-F file`, `--amend --no-edit`).
export function commitSubject(command: string): string | null {
  const heredoc = /<<-?\s*['"]?(\w+)['"]?\s*\n([^\n]*)/.exec(command)
  if (heredoc) return heredoc[2]!.trim()
  const m = /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(command)
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\n/g, '\n').split('\n')[0]!.trim()
}

// Why a commit subject breaks Conventional Commits, or null when it is fine.
export function subjectProblem(subject: string): string | null {
  if (GENERATED.test(subject)) return null
  if (!CONVENTIONAL.test(subject)) return `subject "${subject}" is not \`type(scope): description\` with type one of ${TYPES.join(', ')}`
  if (subject.length > MAX_SUBJECT) return `subject is ${subject.length} characters; keep it to ${MAX_SUBJECT}`
  return null
}

// True for a push that can overwrite remote history: --force (and
// --force-with-lease, --force-if-includes), -f in any short-flag group, `+ref`.
export function isForcePush(command: string): boolean {
  const at = PUSH.exec(command)
  if (!at) return false
  // The push's own words, up to the next shell separator.
  const words = command.slice(at.index + at[0].length).split(/[;&|\n]/)[0]!.trim().split(/\s+/)
  return words.some(w => w.startsWith('--force') || /^-[a-zA-Z0-9]*f/.test(w) || /^\+\S/.test(w))
}

// Files that hold secrets by their name. Examples and templates pass.
const SECRET_FILE = /(^|\/)(\.env(\.[\w-]+)?|[^/]*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?|\.npmrc|\.pypirc|\.netrc|secrets?\.(json|ya?ml|toml))$/i
const SAFE_FILE = /\.(example|sample|template|dist|pub)$/i
export const isSecretFile = (path: string) => SECRET_FILE.test(path) && !SAFE_FILE.test(path)

// Key formats in added lines. ponytail: common formats only; the plugin-authoring scan knows more.
const KEY = /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-(ant-|or-v1-|proj-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})/

// What a `git add` or `git commit` would put in history that looks like a secret.
// ponytail: runs git in the session folder; a `cd x && git add` or `git -C` elsewhere is not followed,
// and in `git add . && git commit` only the add's file names are seen, not their content.
async function secretsIn($: EngineInterface, command: string): Promise<string[]> {
  const cwd = await $.session.cwd()
  const git = async (...args: string[]) => (await $.process.run(['git', ...args], { cwd })).stdout
  const found: string[] = []

  if (ADD.test(command)) {
    // `git add -n` lists what the real add would stage: `add 'path'`.
    const args = command.slice(ADD.exec(command)!.index).split(/[;&|\n]/)[0]!.trim().split(/\s+/).slice(2)
    const paths = [...(await git('add', '--dry-run', ...args.map(a => a.replace(/^['"]|['"]$/g, '')))).matchAll(/^add '(.+)'$/gm)].map(m => m[1]!)
    found.push(...paths.filter(isSecretFile).map(p => `${p} (secret file)`))
  }
  if (COMMIT.test(command)) {
    const all = /\s(-a|--all|-\w*a\w*)\b/.test(command.slice(COMMIT.exec(command)!.index))
    const names = (await git('diff', '--cached', '--name-only')).split('\n').concat(all ? (await git('diff', '--name-only')).split('\n') : [])
    found.push(...names.filter(n => n && isSecretFile(n)).map(n => `${n} (secret file)`))
    const diff = await git('diff', ...(all ? ['HEAD'] : ['--cached']), '-U0')
    let file = ''
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ b/')) file = line.slice(6)
      else if (line.startsWith('+') && KEY.test(line)) found.push(`${file} (key: ${KEY.exec(line)![0].slice(0, 8)}…)`)
    }
  }
  return [...new Set(found)]
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const deny = (why: string) => ({ deny: `${$.plugin.name}: ${why}` })
    const { command } = e

    if (hasAiTrailer(command)) return deny('commit message has an AI co-author trailer. Remove it and commit again.')
    if (COMMIT.test(command)) {
      const subject = commitSubject(command)
      const problem = subject === null ? null : subjectProblem(subject)
      if (problem) return deny(`${problem} (Conventional Commits). Fix the subject and commit again.`)
    }
    if (isForcePush(command)) {
      return deny('force push refused: it can overwrite commits on the remote. Push without force; if history must be rewritten, ask the user to push it themselves.')
    }
    if (ADD.test(command) || COMMIT.test(command)) {
      const secrets = await secretsIn($, command)
      if (secrets.length > 0) {
        return deny(`this would put secrets in git history:\n${secrets.map(s => `- ${s}`).join('\n')}\n`
          + 'Leave them out (unstage with `git restore --staged <file>`, add to .gitignore). If one is a false alarm, ask the user to run the command themselves.')
      }
    }
    return next(e)
  }).catch(($, e, next) =>
    // If a check itself throws, let the command run instead of blocking all Bash.
    next(e),
  )
}
