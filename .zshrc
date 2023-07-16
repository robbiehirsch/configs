source /opt/homebrew/opt/powerlevel10k/powerlevel10k.zsh-theme

if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

export PATH=$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH
export ZSH="/Users/robbiehirsch/.oh-my-zsh"


# ZSH_THEME="powerlevel10k/powerlevel10k"
ZSH_THEME="robbyrussell"

ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#ff00ff,bg=cyan,bold,underline"
ZSH_AUTOSUGGEST_STRATEGY=(completion history match_prev_cmd)
bindkey  '^ ' autosuggest-accept

CASE_SENSITIVE="false"
HYPHEN_INSENSITIVE="true"
ENABLE_CORRECTION="true"
COMPLETION_WAITING_DOTS="true"

plugins=(
    vi-mode
    tmux  
    git npm yarn macos 
    dircycle 
    dotenv 
    zsh-navigation-tools zsh-autosuggestions zsh-interactive-cd zsh-syntax-highlighting
    vscode
)


# # vi-mode plugin configs:
# MODE_INDICATOR="%F{white}+%f"
# INSERT_MODE_INDICATOR="%F{yellow}+%f"
VI_MODE_RESET_PROMPT_ON_MODE_CHANGE=true
VI_MODE_SET_CURSOR=true


source $ZSH/oh-my-zsh.sh
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi
