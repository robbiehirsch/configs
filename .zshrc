# ~/.zshrc — canonical copy lives at ~/configs/.zshrc; ~/.zshrc is a symlink.
#
# ORDER MATTERS in three places, all learned the hard way:
#   1. p10k instant prompt stays at the top.
#   2. EDITOR must be exported BEFORE the first `bindkey` anywhere — zsh picks
#      its initial keymap (emacs vs viins) from EDITOR/VISUAL when ZLE first
#      initializes. Setting it late = custom bindings land in the wrong keymap
#      in fresh terminals but "work after exec zsh".
#   3. Custom bindkeys go AFTER oh-my-zsh loads — the vi-mode plugin replaces
#      the keymap, orphaning anything bound earlier.

# ── p10k instant prompt (keep first) ──────────────────────────────────────
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi
# p10k lives in different places per machine — take the first that exists
for _p10k in /opt/homebrew/opt/powerlevel10k/powerlevel10k.zsh-theme \
             /usr/local/opt/powerlevel10k/powerlevel10k.zsh-theme \
             "$HOME/powerlevel10k/powerlevel10k.zsh-theme"; do
  [[ -r "$_p10k" ]] && { source "$_p10k"; break }
done
unset _p10k

# ── editor (before any bindkey — see header) ──────────────────────────────
export EDITOR='nvim'
export VISUAL='nvim'

# ── PATH ──────────────────────────────────────────────────────────────────
export PATH="$HOME/.cargo/bin:$HOME/.codeium/windsurf/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/usr/local/go/bin:$HOME/go/bin:$HOME/Library/Python/3.9/bin:$PATH"
[[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
export PATH="/Applications/Blender.app/Contents/MacOS:$PATH"
# bob (nvim version manager) must be prepended LAST so its nvim beats
# homebrew's — this is what makes `bob use <version>` actually take effect.
# (.zshenv also sources bob's env.sh; this prepend is the tiebreaker.)
export PATH="$HOME/.local/share/bob/nvim-bin:$PATH"

# ── oh-my-zsh ─────────────────────────────────────────────────────────────
export ZSH="$HOME/.oh-my-zsh"

# ZSH_THEME="powerlevel10k/powerlevel10k"
ZSH_THEME="robbyrussell"

ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#ff00ff,bg=white,bold,underline"
ZSH_AUTOSUGGEST_STRATEGY=(completion history match_prev_cmd)

CASE_SENSITIVE="false"
HYPHEN_INSENSITIVE="true"
ENABLE_CORRECTION="true"
COMPLETION_WAITING_DOTS="true"

plugins=(
    git npm yarn macos dotenv
    tmux
    vi-mode dircycle
    zsh-navigation-tools zsh-autosuggestions zsh-interactive-cd
    vscode
    jsontools copybuffer copyfile copypath
)
# note: zsh-syntax-highlighting was in the old repo copy but not the live
# file — re-add to the list above if you miss it.

# vi-mode plugin configs
VI_MODE_RESET_PROMPT_ON_MODE_CHANGE=true
VI_MODE_SET_CURSOR=true

# fnm (node version manager) — guarded so a missing fnm can't break startup
command -v fnm >/dev/null && eval "$(fnm env --use-on-cd)"

source $ZSH/oh-my-zsh.sh
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# ── key bindings (AFTER oh-my-zsh — see header) ───────────────────────────
# Ctrl-F → project sessionizer. Bound in both keymaps so vi-mode can't hide it.
bindkey -M viins -s '^f' 'tmux-sessionizer\n'
bindkey -M emacs -s '^f' 'tmux-sessionizer\n'

# Accept autosuggestion. NOTE: Ctrl-Space is the tmux prefix, so inside tmux
# this key never reaches zsh — use Ctrl-Y (or →) there.
bindkey -M viins '^ ' autosuggest-accept
bindkey -M emacs '^ ' autosuggest-accept
bindkey -M viins '^y' autosuggest-accept
bindkey -M emacs '^y' autosuggest-accept

# ── aliases ───────────────────────────────────────────────────────────────
alias c=clear
alias pc='pwd | pbcopy'
alias python=python3
alias pip=pip3
alias vi='nvim'
alias rc='nvim ~/.zshrc'
alias tmuxreload='tmux source ~/.tmux.conf'

# ── fzf: bat-powered previews (only when bat exists) ──────────────────────
if command -v bat >/dev/null; then
  export FZF_DEFAULT_OPTS="--cycle --extended --multi --preview-window=wrap --preview 'bat --color=always {}'"
fi
alias fzgit="git grep --line-number '' | fzf --delimiter : --preview 'nl {1}' --preview-window '+{2}-5'"

# ── functions ─────────────────────────────────────────────────────────────
function check_domains {
  local domains=("$@")
  local tlds=("com" "io" "ai" "net" "org")
  for domain in "${domains[@]}"; do
    for tld in "${tlds[@]}"; do
      tldx "$domain" -t "$tld"
    done
  done
}

# ── machine-local overrides (NOT in git): proxies, certs, tokens ──────────
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"
