# Luder — экранный AI-ассистент для Windows

Электрон-приложение: хоткей → выделение области экрана → ответ AI. Проект ориентирован только на Windows (x64). Распространение — NSIS-установщик, обновления — через собственный сервер, удаление — с полной очисткой следов (реестр, автозапуск, данные).

---

## 1. Архитектура

```
Luder/
├── luder-program/          # Electron-клиент (основной продукт)
│   ├── main.js             # точка входа: хоткеи, трей, окна, IPC, апдейтер
│   ├── config.js           # SERVER_URL (env → tailscale-домен по умолчанию)
│   ├── ai_config.js        # конфигурация моделей AI
│   ├── model_router.js     # маршрутизация запросов по провайдерам
│   ├── modelValidator.js   # валидация конфигурации моделей
│   ├── errorMapper.js      # маппинг ошибок провайдеров
│   ├── src/                # рендереры и разделяемая логика
│   │   ├── chat/           # окно чата
│   │   ├── home/           # главное окно (настройки)
│   │   ├── overlay/        # оверлей выделения области
│   │   └── shared/         # updater, storage, providers, chat_manager и т.д.
│   ├── assets/             # иконки (icon.ico, icon.png, tray-icon.png)
│   ├── build/installer.nsh # кастомные NSIS-хуки установки/удаления
│   ├── scripts/            # verify-build.js, audit-install.ps1
│   └── test/               # юнит-тесты + E2E-тест установщика
├── luder-server/           # Node-сервер обновлений и метаданных
│   ├── server.js           # HTTP-сервер: манифест, /download, /api/update
│   ├── config/release.json # манифест релиза (версия, URL, sha256)
│   ├── scripts/            # publish-release.sh, verify-release.js
│   └── test/               # серверные тесты
├── release/                # готовые артефакты (Setup-*.exe, portable.zip)
└── .github/workflows/      # CI: сборка и проверка на реальном Windows
```

Клиент и сервер — отдельные пакеты со своими `package.json` и `package-lock.json`.

---

## 2. Требования

- Node.js 18+ (используется в CI — Node 20)
- Windows 10/11 x64 для целевой сборки (см. раздел 4 — почему)
- Linux + wine — только для отладки NSIS-синтаксиса, не для релизной сборки

---

## 3. Разработка (клиент)

```bash
cd luder-program
npm ci                       # 1. установка зависимостей по lock-файлу
npm start                    # 2. запуск Electron в dev-режиме
npm test                     # 3. прогон всех тестов (8 тестов: клиент + сервер)
```

Сервер:

```bash
cd luder-server
npm ci
node server.js               # поднимает HTTP на 127.0.0.1:3000 (PORT/HOST переопределяются)
npm test                     # тесты сервера и E2E-цикла обновления
```

---

## 4. Сборка установщика Windows

**Шаг 1 — правильная версия.** Версия берётся из `luder-program/package.json` (`version`). Обнови её перед релизом (см. раздел 10).

**Шаг 2 — сборка на Windows.** Обязательное правило: релизный установщик собирается только на реальной Windows (локально или в CI). Причина: финальный NSIS-установщик содержит деинсталлятор как обычный файл `Uninstall Luder.exe` — он генерируется инструкцией `WriteUninstaller` при запуске промежуточного установщика. На Linux-машине запуска нет, и electron-builder кладёт в установщик пустой файл-заглушку → «невозможно удалить» у пользователя. Это же правило изложено в AGENTS.md.

```bash
cd luder-program
npm run build                # rimraf dist → electron-builder --win --x64 → verify-build
```

Артефакты в `dist/`:

| Файл | Назначение |
|---|---|
| `Luder-Setup-<version>-x64.exe` | установщик (NSIS, assisted) |
| `Luder-Setup-<version>-x64.exe.blockmap` | карта блоков для апдейтера |
| `win-unpacked/` | распакованная сборка (промежуточная) |

`postbuild` запускает `scripts/verify-build.js`: проверяет, что `.exe` собран и имя содержит arch.

**Шаг 3 — локальная отладка NSIS (опционально, Linux+wine).** Правишь `build/installer.nsh` и гоняешь `npm run build` — makensis скомпилирует include и отловит синтаксические ошибки. Винную установку использовать как результат не стоит: поведение wine отличается от реального Windows.

---

## 5. CI/CD (GitHub Actions)

Файл: `.github/workflows/build.yml`. Запускается на push в `luder-program/**` или вручную (`workflow_dispatch`).

Шаги workflow:

1. `checkout` — забрать код
2. `setup-node@v4` (Node 20, кэш npm)
3. `npm ci` — чистые зависимости
4. `npm run build` — сборка установщика на **windows-latest** (настоящая Windows)
5. `node test/test-uninstaller.js` — E2E-проверка установки и удаления
6. `upload-artifact` — отдать `Luder-Setup-*.exe` из Actions

---

## 6. Установка и удаление (Windows)

Конфиг NSIS (`build.nsis` в package.json):

| Опция | Значение | Смысл |
|---|---|---|
| `oneClick` | `false` | мастер установки (не one-click) |
| `perMachine` | `false` | установка в `%LOCALAPPDATA%\Programs\Luder` (per-user, без прав админа) |
| `allowToChangeInstallationDirectory` | `true` | пользователь выбирает папку |
| `uninstallDisplayName` | `Luder AI Assistant` | имя в «Программы и компоненты» |
| `deleteAppDataOnUninstall` | `true` | удаление данных приложении при деинсталляции |
| `createDesktopShortcut` / `createStartMenuShortcut` | `true` | ярлыки |
| `installerLanguages` | `ru_RU`, `en_US` | языки мастера |
| `include` | `build/installer.nsh` | кастомные хуки |
| `artifactName` | `Luder-Setup-${version}-${arch}.exe` | имя артефакта |

Кастомный хуки `build/installer.nsh` (`customUnInstall`) при удалении:

1. `taskkill /F /IM Luder.exe` — убить работающее приложение (в silent-режиме шаблонный `un.checkAppRunning` не вызывается)
2. Удалить Run-ключи автозапуска `HKCU\...\Run\Luder` и `\luder`
3. Удалить ярлыки автозапуска из `$SMSTARTUP`
4. Удалить `$APPDATA\Luder`, `$LOCALAPPDATA\Luder`
5. Удалить орфан-папки старых версий: `Programs\LudrClone`, `Programs\ludr-clone`, `Programs\luder`
6. Удалить рабочий стол-ярлыки и ключи `HKCU\Software\Luder`, `HKCU\Software\ludr-clone`

Записи реестра установки (per-user): `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.luder.app` — `DisplayName`, `DisplayVersion`, `UninstallString`. Штатные (ярлыки, key для деинсталляции) удаляет сам шаблон NSIS.

---

## 7. Автозапуск

Правила (закреплены в AGENTS.md):

- Автозапуск НЕ добавляется без явного согласия пользователя (переключатель в интерфейсе приложения)
- В приложении есть простой toggle «выключить автозапуск»
- Старт с задержкой, один процесс, иконка в трее обязательна
- При удалении Run-ключ гарантированно чистится `installer.nsh`

---

## 8. Автообновление

### Клиент (`luder-program/src/shared/updater.js`)

1. Проверка каждые 6 часов (`CHECK_INTERVAL`): `GET {SERVER_URL}/api/update/latest?platform=win32&arch=x64&current=<version>`
2. Сравнение версий SemVer; `mandatory` = новая версия И (`mandatory` в манифесте ИЛИ клиент старше `minSupportedVersion`)
3. Скачивание установщика в temp с прогрессом в UI
4. Проверка `sha256` из манифеста — при несовпадении файл удаляется (анти-подмена)
5. Лог всех событий в `%APPDATA%\Luder\update.log`

### Сервер

- `luder-server/config/release.json` — манифест: `version`, `minSupportedVersion`, `mandatory`, `releaseNotes`, `builds.<platform-arch>` с `url` и `sha256`
- `GET /api/update/latest` — отдаёт манифест для запрошенной платформы/архитектуры
- `GET /download/<file>` — отдаёт файлы билдов

---

## 9. Публикация релиза (шаги)

1. Собрать установщик на Windows (раздел 4) или скачать из CI (раздел 5)
2. Прогнать тесты: `npm test` в `luder-program` и `luder-server`
3. Скормить установщик скрипту публикации:

```bash
cd luder-server
./scripts/publish-release.sh ../luder-program/dist/Luder-Setup-<version>-x64.exe <version>
```

Скрипт делает 4 шага: (1) копирует `.exe` в `dist/`, (2) бэкапит `release.json`, (3) обновляет манифест с новым sha256, (4) гоняет `verify-release.js` — при провале откатывает манифест и удаляет файл.

4. Закоммитить манифест/файлы, поставить git-тег `v<version>`
5. (Опционально) продублировать установщик в `release/` репозитория

---

## 10. Версионирование

- Semantic Versioning: `Major.Minor.Patch`
- Источник истины: `version` в `luder-program/package.json` (из него электрон-билдер делает имя артефакта и версию в реестре)
- Манифест сервера — зеркало той же версии
- Windows видит версию в «Программы и компоненты» (реестр Uninstall, `DisplayVersion`)
- Тег в git: `v0.17.0` и т.п.

---

## 11. Конфигурация и секреты

Файл `luder-program/.env` (не в git):

```
OPENROUTER_KEY=sk-...
LUDR_SERVER_URL=https://...
```

- Ключи читаются в `config.js`/провайдерах через `process.env`
- `.env` **исключён из сборки**: `build.files: ["**/*", "!build/**", "!.env", "!.env.example"]` — иначе ключ попадёт в `app.asar` и в установщик
- Правило: скомпрометированный ключ (попавший в публичный билд) немедленно ротируется

---

## 12. Тестирование

```bash
cd luder-program && npm test     # updater, mandatory-логика, checksum, legacy-schema, детальный апдейтер
cd luder-server && npm test      # server-integration, e2e-update-cycle, detailed-server
```

Итого 8 тестов, run-all собирает их в один проход (клиент и сервер вместе).

E2E установщика (`luder-program/test/test-uninstaller.js`, только Windows — CI):
1. Silent-установка `/S /currentuser`
2. Проверка: `Luder.exe` на месте, `Uninstall Luder.exe` существует и **непустой** (размер > 100 КБ) и валидный PE (MZ)
3. Проверка реестра: `DisplayName`, `DisplayVersion`, `UninstallString`
4. `taskkill` (приложение могло стартовать после установки)
5. Silent-удаление и проверка: папки установки нет, ключ реестра удалён, `%APPDATA%\Luder` удалён

---

## 13. Правила работы с репозиторием (кратко)

Полные правила — в `AGENTS.md`. Главное:

- Коммиты только по явной просьбе; коммитить только изменённые файлы; сообщения по-человечески
- Перед каждой задачей агента — коммит, фичи — в отдельной ветке
- Запрет push в main/master без review
- Не трогать `.csproj`/`.sln`/версии зависимостей без разрешения
- Прогон тестов перед merge, бэкап конфигов перед правками

---

## 14. Известные особенности

- **Сборка на Linux даёт битый деинсталлятор** (0-байтовый `Uninstall Luder.exe`) — релизный билд только с Windows/CI
- Wine-проверка установки ненадёжна (искажает поведение NSIS-плагинов) — только для отладки синтаксиса
- Сервер по умолчанию доступен через tailscale-домен (`*.ts.net`) без TLS-сертификата
- `deleteAppDataOnUninstall: true` — данные удаляются при удалении; при обновлении (update) данные сохраняются (шаблон проверяет флаг `isUpdated`)
