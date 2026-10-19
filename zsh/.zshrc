# Based on https://github.com/dreamsofautonomy/zensh/blob/main/.zshrc

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

typeset -U path PATH
pi_bin_dirs=("$HOME"/.local/share/pi-node/*/bin(N))
path=("$HOME/.local/bin" "$HOME/.cargo/bin" "$HOME/.bun/bin" "$HOME/.fzf/bin" $pi_bin_dirs $path)
export PATH
unset pi_bin_dirs

if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

ZINIT_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/zinit/zinit.git"
if [[ ! -d "$ZINIT_HOME" ]] && command -v git >/dev/null 2>&1; then
  mkdir -p "${ZINIT_HOME:h}"
  git clone --depth=1 https://github.com/zdharma-continuum/zinit.git "$ZINIT_HOME"
fi

if [[ -r "$ZINIT_HOME/zinit.zsh" ]]; then
  source "$ZINIT_HOME/zinit.zsh"
  zinit ice depth=1
  zinit light romkatv/powerlevel10k
  zinit light zsh-users/zsh-completions
  zinit snippet OMZL::git.zsh
  zinit snippet OMZP::git
fi

ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=#93a1a1'
[[ -r "$HOME/.p10k.zsh" ]] && source "$HOME/.p10k.zsh"

if ls --color=auto -d . >/dev/null 2>&1; then
  _ls_color_cmd='ls --color=auto'
else
  _ls_color_cmd='ls -G'
fi
autoload -Uz compinit
compinit
if (( $+functions[zinit] )); then
  zinit cdreplay -q
  zinit light Aloxaf/fzf-tab
fi
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' menu no
zstyle ':fzf-tab:complete:cd:*' fzf-preview "$_ls_color_cmd \\$realpath"
zstyle ':fzf-tab:complete:__zoxide_z:*' fzf-preview "$_ls_color_cmd \\$realpath"

bindkey -e
bindkey '^p' history-search-backward
bindkey '^n' history-search-forward
bindkey '^[w' kill-region
bindkey '^[[1;5D' backward-word
bindkey '^[[1;5C' forward-word
bindkey '^[[1;3D' backward-word
bindkey '^[[1;3C' forward-word
bindkey '^[^?' backward-kill-word
bindkey '^[[27;3;127~' backward-kill-word

HISTSIZE=5000
SAVEHIST=$HISTSIZE
HISTFILE="$HOME/.zsh_history"
setopt appendhistory sharehistory hist_ignore_space hist_ignore_all_dups
setopt hist_save_no_dups hist_ignore_dups hist_find_no_dups

if command -v fzf >/dev/null 2>&1; then
  source <(fzf --zsh)
fi
[[ -r "$HOME/.iterm2_shell_integration.zsh" ]] && source "$HOME/.iterm2_shell_integration.zsh"

alias ls="$_ls_color_cmd"
unset _ls_color_cmd
alias c='clear'

if [[ -d "$HOME/.bun/bin" ]]; then
  export BUN_INSTALL="$HOME/.bun"
fi

# Put machine-specific settings in this untracked file.
[[ -r "$HOME/.config/zsh/local.zsh" ]] && source "$HOME/.config/zsh/local.zsh"

# Register widget hooks after completion and other shell integrations.
if (( $+functions[zinit] )); then
  zinit light zsh-users/zsh-autosuggestions
  zinit light zsh-users/zsh-syntax-highlighting
fi
