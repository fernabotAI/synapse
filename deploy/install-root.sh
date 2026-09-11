#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo."
  exit 1
fi

nginx_site=/etc/nginx/sites-available/moodle
service_source=/home/deploy/synapse/current/deploy/synapse.service
scheduler_service_source=/home/deploy/synapse/current/deploy/synapse-scheduler.service
scheduler_timer_source=/home/deploy/synapse/current/deploy/synapse-scheduler.timer
patcher=/home/deploy/synapse/current/deploy/patch-nginx.py
static_source=/home/deploy/synapse/current/dist/client/synapse/app/_next/static
static_target=/var/www/synapse/_next/static
landing_source=/home/deploy/synapse/current/deploy/landing.html
landing_target=/var/www/synapse/landing/index.html
privacy_source=/home/deploy/synapse/current/deploy/privacy.html
privacy_target=/var/www/synapse/landing/privacidad/index.html
deletion_source=/home/deploy/synapse/current/deploy/data-deletion.html
deletion_target=/var/www/synapse/landing/eliminacion-de-datos/index.html
environment_file=/home/deploy/synapse/shared/.env.production
workspace_directory=/home/deploy/synapse/shared/data/workspaces
credential_directory=/home/deploy/synapse/shared/data/credentials
gmail_directory=/home/deploy/synapse/shared/data/gmail
schedule_directory=/home/deploy/synapse/shared/data/schedules
whatsapp_job_directory=/home/deploy/synapse/shared/data/whatsapp-jobs
conversation_memory_directory=/home/deploy/synapse/shared/data/conversation-memory
backup_dir=/home/deploy/synapse/backups
backup_file="${backup_dir}/moodle.before-synapse.$(date -u +%Y%m%dT%H%M%SZ)"

install -d -o deploy -g deploy -m 0750 "${backup_dir}"
install -d -o deploy -g deploy -m 0700 "${workspace_directory}"
install -d -o deploy -g deploy -m 0700 "${credential_directory}"
install -d -o deploy -g deploy -m 0700 "${gmail_directory}"
install -d -o deploy -g deploy -m 0700 "${schedule_directory}"
install -d -o deploy -g deploy -m 0700 "${whatsapp_job_directory}"
install -d -o deploy -g deploy -m 0700 "${conversation_memory_directory}"
if ! grep -Eq '^SYNAPSE_SESSION_SECRET=.+$' "${environment_file}"; then
  printf '\nSYNAPSE_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" >> "${environment_file}"
fi
if ! grep -Eq '^SYNAPSE_CREDENTIAL_SECRET=.+$' "${environment_file}"; then
  printf 'SYNAPSE_CREDENTIAL_SECRET=%s\n' "$(openssl rand -hex 32)" >> "${environment_file}"
fi
if ! grep -Eq '^SYNAPSE_SCHEDULER_SECRET=.+$' "${environment_file}"; then
  printf 'SYNAPSE_SCHEDULER_SECRET=%s\n' "$(openssl rand -hex 32)" >> "${environment_file}"
fi
if ! grep -Eq '^SYNAPSE_DATA_DIR=.+$' "${environment_file}"; then
  printf 'SYNAPSE_DATA_DIR=/home/deploy/synapse/shared/data\n' >> "${environment_file}"
fi
chown deploy:deploy "${environment_file}"
chmod 0600 "${environment_file}"
cp -a "${nginx_site}" "${backup_file}"
install -m 0644 "${service_source}" /etc/systemd/system/synapse.service
install -m 0644 "${scheduler_service_source}" /etc/systemd/system/synapse-scheduler.service
install -m 0644 "${scheduler_timer_source}" /etc/systemd/system/synapse-scheduler.timer
systemctl daemon-reload
systemctl enable synapse.service
systemctl restart synapse.service
systemctl enable --now synapse-scheduler.timer

if [[ ! -d ${static_source} ]]; then
  echo "Synapse static assets were not found. Nginx was not changed."
  exit 1
fi
if [[ ! -f ${landing_source} ]]; then
  echo "Synapse landing page was not found. Nginx was not changed."
  exit 1
fi
if [[ ! -f ${privacy_source} || ! -f ${deletion_source} ]]; then
  echo "Synapse privacy pages were not found. Nginx was not changed."
  exit 1
fi
install -d -o root -g root -m 0755 "${static_target}"
cp -a "${static_source}/." "${static_target}/"
install -d -o root -g root -m 0755 "$(dirname "${landing_target}")"
install -o root -g root -m 0644 "${landing_source}" "${landing_target}"
install -d -o root -g root -m 0755 "$(dirname "${privacy_target}")" "$(dirname "${deletion_target}")"
install -o root -g root -m 0644 "${privacy_source}" "${privacy_target}"
install -o root -g root -m 0644 "${deletion_source}" "${deletion_target}"
chown -R root:root /var/www/synapse
chmod -R a+rX /var/www/synapse

synapse_ready=no
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS http://127.0.0.1:3020/synapse/app/api/gmail/status >/dev/null 2>&1; then
    synapse_ready=yes
    break
  fi
  sleep 1
done

if [[ ${synapse_ready} != yes ]]; then
  echo "Synapse did not answer on its private port. Nginx was not changed."
  exit 1
fi

python3 "${patcher}" "${nginx_site}"
if ! nginx -t; then
  cp -a "${backup_file}" "${nginx_site}"
  nginx -t
  echo "Nginx validation failed; the original configuration was restored."
  exit 1
fi

systemctl reload nginx
echo "Synapse is available at https://www.faria.cl/synapse/app/"
