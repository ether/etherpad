#!/usr/bin/with-contenv bashio
# ==============================================================================
# Home Assistant Add-on: Etherpad
# Renders a shell env file from /data/options.json so that Etherpad's built-in
# ${ENV_VAR:default} substitution in settings.json picks up user config.
# ==============================================================================
set -e

ENV_FILE=/etc/etherpad/env
mkdir -p "$(dirname "${ENV_FILE}")"

{
    echo "export TITLE=$(bashio::config 'title' | jq -Rr @sh)"
    echo "export REQUIRE_AUTHENTICATION=$(bashio::config 'require_authentication')"
    echo "export TRUST_PROXY=$(bashio::config 'trust_proxy')"
    echo "export LOGLEVEL=$(bashio::config 'log_level')"
    echo "export DEFAULT_PAD_TEXT=$(bashio::config 'default_pad_text' | jq -Rr @sh)"

    admin_pw=$(bashio::config 'admin_password')
    if bashio::var.has_value "${admin_pw}"; then
        echo "export ADMIN_PASSWORD=$(printf '%s' "${admin_pw}" | jq -Rr @sh)"
    else
        echo "export ADMIN_PASSWORD=null"
    fi

    user_pw=$(bashio::config 'user_password')
    if bashio::var.has_value "${user_pw}"; then
        echo "export USER_PASSWORD=$(printf '%s' "${user_pw}" | jq -Rr @sh)"
    else
        echo "export USER_PASSWORD=null"
    fi

    db_type=$(bashio::config 'db_type')
    echo "export DB_TYPE=${db_type}"
    if [ "${db_type}" = "dirty" ]; then
        # Persist the dirty DB under /data so pads survive restarts.
        echo "export DB_FILENAME=/data/dirty.db"
    else
        echo "export DB_HOST=$(bashio::config 'db_host')"
        echo "export DB_PORT=$(bashio::config 'db_port')"
        echo "export DB_NAME=$(bashio::config 'db_name')"
        echo "export DB_USER=$(bashio::config 'db_user')"
        echo "export DB_PASS=$(bashio::config 'db_password' | jq -Rr @sh)"
    fi

    # Ingress: HA proxies through a random base path; Etherpad picks up
    # X-Forwarded-* headers when trustProxy is true.
    echo "export PORT=9001"
    echo "export IP=0.0.0.0"
} > "${ENV_FILE}"

chmod 0600 "${ENV_FILE}"
bashio::log.info "Etherpad configuration rendered to ${ENV_FILE}"
