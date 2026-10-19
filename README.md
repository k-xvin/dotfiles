# Stow
Apply config using `stow`. It will create a symlink to the files in the "package" using the parent directory as the root.

For example,
```
cd .dotfiles
stow amethyst
```
will take whatever is in .dotfiles/amethyst and symlink it all in the parent folder of .dotfiles.

# VSCode or VSCodium

In Linux:
```
stow -t ~/.config/VSCodium/User vscodium
stow -t ~/.config/Code/User vscode
```

In macOS:
```
stow -t ~/Library/Application\ Support/VSCodium/User vscodium
stow -t ~/Library/Application\ Support/Code/User vscode
```

# Pi
Install Pi and Node.js with `pi` on `PATH`. Extensions target
`@earendil-works/pi-coding-agent` 0.85.1 and background jobs require `/bin/bash`.
The diagram helper uses Python 3; Herdr is optional.

```
stow -n -v pi
stow pi
```

Back up conflicting files in `~/.pi/agent` before linking, then restart Pi or
`/reload` when the run and subagents are idle. Keep credentials, models, runtime
state, and project configuration local. `settings.json` tracks UI preferences;
saving model defaults into it changes this repo.

# Herdr
```
stow herdr
```

# Alacritty
```
stow alacritty
```

# Git
```
git config --global user.name "Kevin Xu"
git config --global user.email "your_email@example.com"
```

# Generate a new SSH Key
```
ssh-keygen -t ed25519 -C "your_email@example.com"

eval "$(ssh-agent -s)"

pbcopy < ~/.ssh/id_ed25519.pub
```

# fzf
We need fzf 0.48.0 in order to have --zsh completions.

# iTerm2
1. Go to Settings > General > Settings.
2. Check "Load settings from a custom folder or URL"
3. Set to "/Users/kevin/.dotfiles/iterm2
