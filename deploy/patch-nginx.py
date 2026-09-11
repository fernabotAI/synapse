#!/usr/bin/env python3
from pathlib import Path
import os
import sys
import tempfile


MARKER = "# SYNAPSE_APP_MANAGED_LOCATION"
V2_MARKER = "# SYNAPSE_APP_MANAGED_LOCATION_V2"
V3_MARKER = "# SYNAPSE_APP_MANAGED_LOCATION_V3"
V4_MARKER = "# SYNAPSE_APP_MANAGED_LOCATION_V4"
V5_MARKER = "# SYNAPSE_APP_MANAGED_LOCATION_V5"
VERSION_MARKER = "# SYNAPSE_APP_MANAGED_LOCATION_V6"
NEEDLE = """server {
    listen 80;
    server_name faria.cl www.faria.cl;
    client_max_body_size 500M;

"""
LEGACY_SYNAPSE_LOCATIONS = """    # SYNAPSE_APP_MANAGED_LOCATION
    location = /synapse/app {
        return 308 /synapse/app/;
    }

    location ^~ /synapse/app/_next/static/ {
        alias /var/www/synapse/_next/static/;
        access_log off;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /synapse/app/ {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

"""
SYNAPSE_LOCATIONS = """    # SYNAPSE_APP_MANAGED_LOCATION
    # SYNAPSE_APP_MANAGED_LOCATION_V6
    location = /synapse {
        return 308 https://$host/synapse/;
    }

    location /synapse/ {
        alias /var/www/synapse/landing/;
        index index.html;
        add_header Cache-Control "no-store";
    }

    location = /synapse/app {
        return 308 https://$host/synapse/app/;
    }

    location ^~ /synapse/app/_next/static/ {
        alias /var/www/synapse/_next/static/;
        access_log off;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # OAuth entry points and the shared Google callback must remain public.
    location ^~ /synapse/app/api/auth/ {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
    }

    location = /synapse/app/api/gmail/callback {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
    }

    # Public machine-to-machine entry point. Authentication is handled by the
    # per-webhook Bearer secret in the application.
    location = /synapse/app/api/webhook {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Public Meta callback. Verification uses the per-node token and incoming
    # events are authenticated with X-Hub-Signature-256 in the application.
    location = /synapse/app/api/whatsapp/webhook {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location = /_synapse_auth {
        internal;
        proxy_pass http://127.0.0.1:3020/synapse/app/api/auth/check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie $http_cookie;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    }

    location @synapse_login {
        return 302 https://$host/synapse/;
    }

    location /synapse/app/ {
        auth_request /_synapse_auth;
        error_page 401 = @synapse_login;
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

"""


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-nginx.py /path/to/nginx-site")

    target = Path(sys.argv[1])
    original = target.read_text()
    if VERSION_MARKER in original:
        print("Synapse Nginx location already present")
        return
    if V5_MARKER in original:
        anchor = "    location = /_synapse_auth {\n"
        if original.count(V5_MARKER) != 1 or original.count(anchor) != 1:
            raise SystemExit("Existing V5 Synapse location is not the expected version; no changes made")
        whatsapp_location = """    # Public Meta callback. Verification uses the per-node token and incoming
    # events are authenticated with X-Hub-Signature-256 in the application.
    location = /synapse/app/api/whatsapp/webhook {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

"""
        updated = original.replace(V5_MARKER, VERSION_MARKER, 1)
        updated = updated.replace(anchor, whatsapp_location + anchor, 1)
    elif V4_MARKER in original:
        webhook_location = """    # Public machine-to-machine entry point. Authentication is handled by the
    # per-webhook Bearer secret in the application.
    location = /synapse/app/api/webhook {
        proxy_pass http://127.0.0.1:3020;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /synapse/app;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

"""
        anchor = "    location = /_synapse_auth {\n"
        if original.count(V4_MARKER) != 1 or original.count(anchor) != 1:
            raise SystemExit("Existing V4 Synapse location is not the expected version; no changes made")
        updated = original.replace(V4_MARKER, VERSION_MARKER, 1)
        updated = updated.replace(anchor, webhook_location + anchor, 1)
    elif V3_MARKER in original:
        replacements = [
            (V3_MARKER, VERSION_MARKER),
            ("location = /synapse/ {", "location /synapse/ {"),
        ]
        updated = original
        for old, new in replacements:
            if updated.count(old) != 1:
                raise SystemExit(f"Expected exactly one V3 fragment {old!r}; no changes made")
            updated = updated.replace(old, new, 1)
    elif V2_MARKER in original:
        replacements = [
            (V2_MARKER, VERSION_MARKER),
            ("return 308 /synapse/;", "return 308 https://$host/synapse/;"),
            ("location = /synapse/ {", "location /synapse/ {"),
            ("alias /var/www/synapse/landing/index.html;", "alias /var/www/synapse/landing/;\n        index index.html;"),
            ("return 308 /synapse/app/;", "return 308 https://$host/synapse/app/;"),
            ("return 302 /synapse/;", "return 302 https://$host/synapse/;"),
        ]
        updated = original
        for old, new in replacements:
            if updated.count(old) != 1:
                raise SystemExit(f"Expected exactly one V2 fragment {old!r}; no changes made")
            updated = updated.replace(old, new, 1)
    elif MARKER in original:
        if original.count(LEGACY_SYNAPSE_LOCATIONS) != 1:
            raise SystemExit("Existing Synapse location is not the expected version; no changes made")
        updated = original.replace(LEGACY_SYNAPSE_LOCATIONS, SYNAPSE_LOCATIONS, 1)
    else:
        if original.count(NEEDLE) != 1:
            raise SystemExit("Expected faria.cl Flask location was not found exactly once; no changes made")
        updated = original.replace(NEEDLE, NEEDLE + SYNAPSE_LOCATIONS, 1)
    stat = target.stat()
    descriptor, temporary_name = tempfile.mkstemp(prefix=".synapse-nginx-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w") as temporary:
            temporary.write(updated)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_name, stat.st_mode)
        os.chown(temporary_name, stat.st_uid, stat.st_gid)
        os.replace(temporary_name, target)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    print(f"Updated Synapse location in {target}")


if __name__ == "__main__":
    main()
