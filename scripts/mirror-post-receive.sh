#!/bin/bash
# Автодеплой из зеркала: push в ветку зеркала ставит в очередь Dokploy
# сборку приложений, которые собираются из этой ветки.
#
# Живёт на сервере в `hooks/post-receive` зеркала
# (`/etc/dokploy/git/nemoProject.git`), устройство — README, «Выкат без
# GitHub». Какие приложения собирать, решает не список в этом файле, а
# настройки Dokploy: источник — это зеркало, ветка совпала, автодеплой
# включён. Флаг уважается затем, чтобы выкат миграции по порядку работал,
# как при GitHub: снять автодеплой с Mini App, push, дождаться панели,
# собрать Mini App руками.
#
# Панель ставится в очередь первой: миграции накатывает она при старте, а
# Dokploy собирает по одному.
#
# Push хук не отменяет — git вызывает его после записи веток. Поэтому
# отказ Dokploy печатается тому, кто пушил, а не глотается: иначе ветка
# ушла бы, а контур остался на прежнем коммите молча.
#
# Не собирать:            git push -o no-deploy server <ветка>
# Посмотреть без сборки:  echo "<old> <new> refs/heads/dev" | DRY_RUN=1 hooks/post-receive

set -uo pipefail

MIRROR_URL='git@172.18.0.1:/etc/dokploy/git/nemoProject.git'
DOKPLOY='http://localhost:3000/api'
KEY_FILE='/root/.dokploy-key'
LOG='/var/log/nemo-mirror-deploy.log'
ZERO='0000000000000000000000000000000000000000'

say() {
  echo "автодеплой: $*"
  echo "$(date -u +%FT%TZ) $*" >>"$LOG" 2>/dev/null || true
}

for ((i = 0; i < ${GIT_PUSH_OPTION_COUNT:-0}; i++)); do
  option="GIT_PUSH_OPTION_$i"
  if [[ "${!option}" == 'no-deploy' ]]; then
    say "пропущен по -o no-deploy"
    exit 0
  fi
done

if [[ ! -r "$KEY_FILE" ]]; then
  say "нет ключа Dokploy ($KEY_FILE) — ничего не собрано"
  exit 0
fi
KEY=$(cat "$KEY_FILE")

# Приложения ветки: id, имя, окружение, автодеплой — панель первой.
# Список проектов отдаёт приложения без источника и ветки, поэтому каждое
# дочитывается по одному. Секреты окружения в этих ответах есть — отсюда
# наружу уходят только четыре поля.
apps_of_branch() {
  DOKPLOY="$DOKPLOY" KEY="$KEY" MIRROR_URL="$MIRROR_URL" BRANCH="$1" python3 -c '
import json, os, urllib.parse, urllib.request

def get(endpoint):
    request = urllib.request.Request(os.environ["DOKPLOY"] + "/" + endpoint,
                                     headers={"x-api-key": os.environ["KEY"]})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)

order = {"admin": 0, "cabinet": 1, "miniapp": 2}
found = []
for project in get("project.all"):
    for env in project.get("environments") or []:
        for brief in env.get("applications") or []:
            query = urllib.parse.urlencode({"applicationId": brief["applicationId"]})
            app = get("application.one?" + query)
            if (app.get("sourceType") == "git"
                    and app.get("customGitUrl") == os.environ["MIRROR_URL"]
                    and app.get("customGitBranch") == os.environ["BRANCH"]):
                found.append((order.get(app.get("name"), 9), app["applicationId"],
                              app.get("name"), env.get("name"), bool(app.get("autoDeploy"))))
for _, app_id, name, env, auto in sorted(found):
    print(app_id, name, env, "on" if auto else "off", sep="\t")
'
}

while read -r _old new ref; do
  [[ "$ref" == refs/heads/* ]] || continue
  if [[ "$new" == "$ZERO" ]]; then
    continue
  fi
  branch=${ref#refs/heads/}
  short=$(git rev-parse --short "$new")
  subject=$(git log -1 --format=%s "$new")

  if ! apps=$(apps_of_branch "$branch"); then
    say "$branch $short: Dokploy не ответил списком приложений — ничего не собрано"
    continue
  fi
  if [[ -z "$apps" ]]; then
    say "$branch $short: из этой ветки ничего не собирается"
    continue
  fi

  while IFS=$'\t' read -r app_id name env auto; do
    if [[ "$auto" != 'on' ]]; then
      say "$branch $short: $env/$name пропущен — автодеплой выключен"
      continue
    fi
    if [[ -n "${DRY_RUN:-}" ]]; then
      say "$branch $short: $env/$name был бы поставлен в очередь (DRY_RUN)"
      continue
    fi
    body=$(APP_ID="$app_id" TITLE="$subject" DESCRIPTION="push $short в $branch" python3 -c '
import json, os
print(json.dumps({"applicationId": os.environ["APP_ID"],
                  "title": os.environ["TITLE"][:200],
                  "description": os.environ["DESCRIPTION"]}))')
    answer=$(mktemp)
    code=$(curl -s -m 20 -o "$answer" -w '%{http_code}' -X POST "$DOKPLOY/application.deploy" \
      -H "x-api-key: $KEY" -H 'content-type: application/json' -d "$body")
    if [[ "$code" == 200 ]]; then
      say "$branch $short: $env/$name поставлен в очередь"
    else
      say "$branch $short: $env/$name НЕ поставлен — Dokploy ответил $code: $(head -c 200 "$answer")"
    fi
    rm -f "$answer"
  done <<<"$apps"
done

exit 0
