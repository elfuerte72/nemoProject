# Образ админ-панели.
#
# Здесь и только здесь живёт приватный ключ расшифровки реквизитов
# (docs/adr/0002): в клиентском деплое его нет физически, поэтому
# компрометация клиентской части не открывает базу номеров карт.
#
# Миграции применяет этот образ, а не клиентский: владелец схемы должен
# быть один, иначе два приложения станут накатывать её одновременно.
# Пока экземпляр один, этого достаточно; при нескольких понадобится
# отдельный шаг развёртывания — миграции не берут блокировку.
#
# Про отсутствие самодостаточной сборки — см. docker/miniapp.Dockerfile.

FROM node:22-alpine
RUN corepack enable
WORKDIR /app

COPY --chown=node:node . .
USER node

RUN pnpm install --frozen-lockfile

# Имя бота нужно на сборке: из него виджет Telegram Login собирает
# кнопку входа, а всё `NEXT_PUBLIC_*` Next подставляет в клиентский код
# в момент сборки.
ARG NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
ENV NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=$NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

RUN pnpm --filter @nemo/admin build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000
# Схема и код едут одним образом: приложение, поднявшееся раньше своей
# миграции, отвечало бы ошибками по половине экранов.
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @nemo/admin start"]
