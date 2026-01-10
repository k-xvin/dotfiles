# Stow
Apply config using `stow`. It will create a symlink to the files in the "package" using the parent directory as the root.

For example,
```
cd .dotfiles
stow amethyst
```
will take whatever is in .dotfiles/amethyst and symlink it all in the parent folder of .dotfiles.

# VS Code
In macOS.
```
stow vscode -t ~/Library/Application\ Support/Code/User
```

In Linux.
```
stow vscode -t ~/.config/Code/User
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

