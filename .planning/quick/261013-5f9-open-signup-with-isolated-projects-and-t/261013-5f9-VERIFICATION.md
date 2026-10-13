---
status: passed
---
# PASS

- Public signup создаёт отдельный проект без приглашения; actual headed-browser registration и вход прошли.
- Владелец создаёт приглашение; новый участник вступает в его проект с ролью member. SQLite duplicate/reuse guards прошли.
- Второй проект не видит первую команду; первая команда не видит опубликованную пробную задачу второго проекта, прямое чтение её ID возвращает 404.
- Footer открыл публичный https://github.com/megamen32/contribution-ledger в том же браузере.
- Миграция сохранила прежние данные/триггеры; собственные QA-данные очищены без изменения финансовых записей.

Артефакты: локальные .tmp/projects-signup/{owner-project,project-invitation,public-repository}.png и screenshots same-owned-session на server-44 в ~/.local/state/vklad-acceptance-01a1314f/. Никакие пользовательские данные и credentials не публикуются.
