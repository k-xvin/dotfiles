# Stow
Apply config using `stow`. It will create a symlink to the files in the "package" using the parent directory as the root.

For example,
```
stow amethyst
```
will take whatever is in .dotfiles/amethyst and symlink it all in the parent folder of .dotfiles.

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
