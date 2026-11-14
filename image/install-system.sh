#!/bin/sh
set -eu
root=/opt/conductive
system="$root/current/system"
for unit in "$system"/*.service "$system"/*.socket "$system"/*.timer; do
  install -m 644 "$unit" "/etc/systemd/system/$(basename "$unit")"
done
install -d -m 755 /etc/udev/rules.d /usr/local/bin
install -m 644 "$system/60-conductive-disk-cache.rules" /etc/udev/rules.d/60-conductive-disk-cache.rules
ln -sfn "$root/current/conductive" /usr/local/bin/conductive
ln -sfn "$system/github-cli.sh" /usr/local/bin/gh
ln -sfn "$root/current/conductive" /usr/local/bin/conductive-git-credential
git config --system --replace-all credential.helper /usr/local/bin/conductive-git-credential
git config --system credential.useHttpPath true
rm -f /etc/systemd/system/conductive-update-confirm.service
systemctl daemon-reload
systemctl enable conductive-runner.service conductive-preview-relay.socket conductive-preview-relay.service conductive-update-check.timer conductive-terminal.service
