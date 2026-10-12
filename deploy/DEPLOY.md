# Деплой на VPS (Docker Compose)

> Весь функционал сейчас в ветке `claude/elegant-pascal-i21xym` (PR #1,
> не смёржен в `main`) — клонировать и обновлять нужно именно её, пока PR
> не смёржен.

Схема: `chat.<домен>` — API + статика виджета (widget.js, /public/*) + WebSocket.
`admin.<домен>` — админка (SPA). Оба за Cloudflare (proxied), TLS до origin —
через Cloudflare Origin Certificate.

## 1. Docker

```
curl -fsSL https://get.docker.com | sh
```

## 2. Код на сервере

Через deploy-ключ (SSH, read-only) — надёжнее токена на сервере:

```
ssh-keygen -t ed25519 -C "vps-deploy" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
```

Публичный ключ добавить в GitHub: репозиторий → Settings → Deploy keys → Add
deploy key (без Write access хватит).

```
mkdir -p ~/.ssh
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  IdentitiesOnly yes
EOF
git clone -b claude/elegant-pascal-i21xym git@github.com:arionel07/vizaje-chat.git /opt/vizaje-chat
cd /opt/vizaje-chat
```

## 3. Cloudflare Origin Certificate

Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate.
Hostnames: `chat.vizaje-nica.com`, `admin.vizaje-nica.com` (или `*.vizaje-nica.com`).
Format: PEM. Сохранить оба файла на сервере:

```
mkdir -p deploy/certs
nano deploy/certs/cloudflare-origin.pem      # вставить Origin Certificate
nano deploy/certs/cloudflare-origin-key.pem  # вставить Private Key
```

В Cloudflare: SSL/TLS → Overview → режим **Full (strict)**.

## 4. .env

```
cp deploy/.env.example .env
openssl rand -hex 32   # вставить как JWT_SECRET
openssl rand -hex 24   # вставить как DB_PASSWORD
nano .env
```

## 5. Запуск

```
docker compose up -d --build
docker compose logs -f api   # проверить, что поднялся
```

## 6. Схема БД и первый админ (один раз)

```
docker compose exec api bunx drizzle-kit push
docker compose exec api bun run src/scripts/create-admin.ts admin@vizaje-nica.com '<пароль>'
```

## 7. Проверка

```
curl https://chat.vizaje-nica.com/health
```

Открыть `https://admin.vizaje-nica.com` в браузере.

## Обновление после новых коммитов

```
cd /opt/vizaje-chat
git pull
docker compose up -d --build
```
