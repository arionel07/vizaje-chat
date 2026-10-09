/*
 * Виджет поддержки vizaje-chat.
 *
 *   <script src="widget.js" data-api="https://chat.example.com"></script>
 *
 * Необязательные атрибуты:
 *   data-theme  — auto (по умолчанию, системная тема посетителя) | light | dark
 *   data-title  — заголовок панели (по умолчанию «Поддержка Vizaje-Nica»)
 *   data-agent  — подпись сотрудника под сообщениями (по умолчанию «Поддержка»)
 *   data-lang   — язык диктовки (по умолчанию ru-RU); кнопка микрофона есть только
 *                 в браузерах с распознаванием речи (Chrome, Edge, Safari).
 *                 Также решает, на каком языке ответит бот при автоответах
 *                 (RO, если начинается с "ro", иначе RU)
 *   data-greeting      — приветствие в пустом чате (по умолчанию «Привет! 👋 Чем мы можем помочь?»)
 *   data-subtitle      — подзаголовок под заголовком в шапке панели
 *                        (по умолчанию «Наша команда также может помочь»)
 *   data-quick-replies — быстрые вопросы под приветствием через запятую, до 4 штук:
 *                        "Есть ли в наличии?,Сроки доставки,Как оформить возврат"
 *   data-privacy-url   — ссылка на политику конфиденциальности; если задана, под полем
 *                        ввода появляется строка «Отправляя сообщение, вы соглашаетесь
 *                        с ...» со ссылкой (без атрибута строка не показывается —
 *                        нечем её подкрепить)
 *   data-privacy-text  — текст ссылки в этой строке (по умолчанию «Политикой конфиденциальности»)
 *   data-proactive-message — текст приглашения, которое само всплывает рядом с кнопкой
 *                        чата через data-proactive-delay секунд; без него фича выключена.
 *                        Не показывается, если чат уже открывали в этой вкладке, у
 *                        посетителя уже есть сессия (писал раньше) или приглашение уже
 *                        закрывали крестиком в этом заходе на сайт (sessionStorage)
 *   data-proactive-delay   — задержка до показа приглашения, в секундах (по умолчанию 20)
 *   data-position      — bottom-right (по умолчанию) | bottom-left
 *   data-z-index       — z-index виджета (по умолчанию 999999)
 *   data-offset-bottom — отступ снизу в px (по умолчанию 20)
 *   data-offset-right / data-offset-left — отступ от края в px (по умолчанию 20);
 *                        действует тот, что соответствует data-position
 *
 * Сезонная тема (Classic / Winter) — не атрибут, а настройка в админке
 * (GET/PUT /admin/settings/theme); виджет сам забирает её через GET /widget/config
 * при загрузке страницы. Winter — поверх панели падают снежинки (CSS-анимация,
 * pointer-events: none), плюс статичные декорации: шапка снега на поле ввода,
 * сосульки и шапка Санты на тайле-«логотипе» в шапке панели, гирлянда над шапкой.
 * Classic — без эффектов.
 */
;(function () {
	if (window.__vizajeChatLoaded) return
	window.__vizajeChatLoaded = true

	const script =
		document.currentScript || document.querySelector('script[data-api]')
	const cfg = script?.dataset || {}
	const API_URL = (cfg.api || 'http://localhost:3001').replace(/\/$/, '')
	const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws'
	// база для статики (public/...) — папка, где лежит сам widget.js, не API
	const ASSET_BASE = (script?.src || '').replace(/[^/]*$/, '')
	const AVATAR_URL = `${ASSET_BASE}public/vizi-profili.png`
	const TITLE = cfg.title || 'Поддержка Vizaje-Nica'
	const AGENT = cfg.agent || 'Поддержка'
	const THEME = ['light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto'
	const LANG = cfg.lang || 'ru-RU'
	const BOT_LANG = LANG.toLowerCase().startsWith('ro') ? 'ro' : 'ru'
	const GREETING = (cfg.greeting || '').trim() || 'Привет! 👋 Чем мы можем помочь?'
	const SUBTITLE = (cfg.subtitle || '').trim() || 'Наша команда также может помочь'
	const PRIVACY_URL = (cfg.privacyUrl || '').trim()
	const PRIVACY_TEXT = (cfg.privacyText || '').trim() || 'Политикой конфиденциальности'
	const MAX_QUICK_REPLIES = 4
	const QUICK_REPLIES = (cfg.quickReplies || '')
		.split(',')
		.map(t => t.trim())
		.filter(Boolean)
		.slice(0, MAX_QUICK_REPLIES)
	const PROACTIVE_MESSAGE = (cfg.proactiveMessage || '').trim()
	const proactiveDelay = Number.parseFloat(cfg.proactiveDelay)
	const PROACTIVE_DELAY_MS =
		(Number.isFinite(proactiveDelay) && proactiveDelay >= 0 ? proactiveDelay : 20) * 1000
	const POSITION = cfg.position === 'bottom-left' ? 'bottom-left' : 'bottom-right'
	const cssPx = (value, fallback) => {
		const n = Number.parseFloat(value)
		return Number.isFinite(n) && n >= 0 ? n : fallback
	}
	const zIndex = Number.parseInt(cfg.zIndex, 10)
	const Z_INDEX = Number.isFinite(zIndex) ? zIndex : 999999
	const OFFSET_BOTTOM = cssPx(cfg.offsetBottom, 20)
	const OFFSET_SIDE = cssPx(POSITION === 'bottom-left' ? cfg.offsetLeft : cfg.offsetRight, 20)
	const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition

	const PAGE_SIZE = 50
	const SNOW_CHARS = ['❄', '❅', '❆']
	const SNOW_COUNT = 8 // 6-10 снежинок, как в задаче
	const ACK_TIMEOUT_MS = 10000 // подтверждение sent не пришло — перестаём отслеживать
	const TYPING_EMIT_MS = 3000 // не чаще, чем раз в 3 с сообщаем «печатаю»
	const TYPING_SHOW_MS = 5000 // «печатает» гаснет, если событий больше нет
	// автоответ бота приходит мгновенно (без события typing от сервера) — даём
	// индикатору время показаться перед тем, как подставить реальное сообщение
	const BOT_TYPING_DELAY_MS = 1300
	const TOAST_MS = 15000
	const MAX_INPUT_HEIGHT = 120
	// Набор эмодзи (тот же, что в админке: vizaje-chat-admin/src/chat/emoji-data.ts)
	const EMOJI_CATEGORIES = [
		{ id: 'smileys', label: 'Смайлы', icon: '😀', emojis: '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🥳 😏 😌 😔 😢 😭 😤 😡 🥺 😱 😳 🤔 🤗 🙄 😴 🤯 😬'.split(' ') },
		{ id: 'gestures', label: 'Жесты', icon: '👍', emojis: '👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 🙏 💪 👋 🤚 ✋ 🫡 🤙 👀 ☝️ 👇 👉 👈 🤷 🙋 🤦'.split(' ') },
		{ id: 'hearts', label: 'Сердца', icon: '❤️', emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💖 💗 💯 ✨ 🔥 ⭐ 🎉 🎊 🎁'.split(' ') },
		{ id: 'objects', label: 'Предметы', icon: '📦', emojis: '✅ ❌ ❗ ❓ ⚠️ 💬 📦 🚚 📞 📧 🕐 💳 💰 🛒 🎯 🔒 🔑 📌 ✏️ 📎 🎧 📷 💡'.split(' ') },
		{ id: 'nature', label: 'Еда и природа', icon: '☕', emojis: '☕ 🍕 🍔 🍰 🍎 🍓 🌞 🌙 🌈 🌸 🌹 🐶 🐱 🐻 🚗 ✈️ 🏠'.split(' ') }
	]
	const RECENT_KEY = 'widget_emoji_recent'
	const RECENT_MAX = 16
	const PROACTIVE_DISMISSED_KEY = 'widget_proactive_dismissed'
	const LONG_PRESS_MS = 450 // долгое нажатие на сообщение (телефон) — ответить
	const QUOTE_LENGTH = 200

	// --- иконки (lucide, inline: виджет без сборки и зависимостей) -----------
	const svg = (body, size = 24, extra = '') =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`
	// иконка лаунчера (закрытое состояние) — пузырь currentColor (белый на чёрной
	// кнопке), улыбка — вырез цветом кнопки, тот же приём, что у ICON_CHEVRON ниже
	const ICON_LAUNCHER = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 240 240" aria-hidden="true">
<path fill="currentColor" d="M18 12 L102 12 Q110 12 110 20 L110 112 Q110 120 102 120 L50 120 L34 140 Q32 143 32 139 L32 120 L18 120 Q10 120 10 112 L10 20 Q10 12 18 12 Z"/>
<path fill="none" stroke="var(--launcher-bg)" stroke-width="7" stroke-linecap="round" d="M40 84 Q60 96 80 84"/>
</svg>`
	const ICON_CHEVRON = svg('<path d="m6 9 6 6 6-6"/>', 26)
	const ICON_CLOSE = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 20)
	const ICON_SEND = svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 20)
	const ICON_SMILE = svg(
		'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
		22
	)
	const ICON_MIC = svg(
		'<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
		22
	)
	const ICON_STOP = svg('<rect width="12" height="12" x="6" y="6" rx="2"/>', 22)
	const ICON_REPLY = svg('<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', 16)
	const ICON_DOWNLOAD = svg(
		'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
		20
	)
	const ICON_MORE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>
<circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>`

	// --- разметка и стили (Shadow DOM: стили сайта и виджета не пересекаются) --
	const host = document.createElement('div')
	host.id = 'vizaje-chat-host'
	host.setAttribute('data-theme', THEME)
	// позиция и слой читаются один раз при инициализации и ложатся в inline-стили корня
	host.style.setProperty('--vz-z', String(Z_INDEX))
	host.style.setProperty('--vz-offset-x', OFFSET_SIDE + 'px')
	host.style.setProperty('--vz-offset-y', OFFSET_BOTTOM + 'px')
	const root = host.attachShadow({ mode: 'open' })

	root.innerHTML = `
<style>
  :host { all: initial;
    --bg: #ffffff; --fg: #18181b; --muted: #71717a; --surface: #f4f4f5; --border: #e4e4e7;
    --brand: #18181b; --brand-fg: #ffffff; --ring: #18181b; --danger: #dc2626;
    /* лаунчер и тайл-«логотип» всегда чёрные, независимо от темы — так на референсе */
    --launcher-bg: #000000; --launcher-fg: #ffffff; --shadow: 0 12px 48px rgba(0,0,0,.22);
    --snow-color: #0ea5e9;
    color-scheme: light; }
  :host([data-theme="dark"]) {
    --bg: #17181c; --fg: #f4f4f5; --muted: #a1a1aa; --surface: #2a2b31; --border: #2e2f36;
    --brand: #f4f4f5; --brand-fg: #17181c; --ring: #f4f4f5; --danger: #f87171;
    --shadow: 0 12px 48px rgba(0,0,0,.6); --snow-color: #bae6fd; color-scheme: dark; }
  @media (prefers-color-scheme: dark) {
    :host([data-theme="auto"]) {
      --bg: #17181c; --fg: #f4f4f5; --muted: #a1a1aa; --surface: #2a2b31; --border: #2e2f36;
      --brand: #f4f4f5; --brand-fg: #17181c; --ring: #f4f4f5; --danger: #f87171;
      --shadow: 0 12px 48px rgba(0,0,0,.6); --snow-color: #bae6fd; color-scheme: dark; } }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; border: 0; background: none; padding: 0; }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

  .root { font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; color: var(--fg); }
  .launcher, .toast, .panel, .proactive { position: fixed; z-index: var(--vz-z, 999999); }

  /* кнопка-лаунчер */
  .launcher { right: max(var(--vz-offset-x, 20px), env(safe-area-inset-right)); bottom: max(var(--vz-offset-y, 20px), env(safe-area-inset-bottom));
    width: 60px; height: 60px; border-radius: 50%; background: var(--launcher-bg); color: var(--launcher-fg);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.06); transition: transform .15s ease; }
  .launcher:hover { transform: scale(1.06); }
  .launcher .ic-chat { display: flex; width: 38px; height: 38px; }
  .launcher .ic-close { display: none; }
  .root.open .launcher .ic-chat { display: none; }
  .root.open .launcher .ic-close { display: block; }
  .badge { position: absolute; top: -4px; right: -4px; min-width: 22px; height: 22px; padding: 0 6px;
    border-radius: 11px; background: #ef4444; color: #fff; font-size: 12px; font-weight: 600; line-height: 1;
    display: flex; align-items: center; justify-content: center; border: 2px solid var(--launcher-bg); }

  /* превью нового сообщения над лаунчером */
  .toast { right: max(var(--vz-offset-x, 20px), env(safe-area-inset-right)); bottom: calc(max(var(--vz-offset-y, 20px), env(safe-area-inset-bottom)) + 76px);
    width: 320px; max-width: calc(100vw - 32px); display: flex; gap: 12px; text-align: left;
    padding: 14px 16px; border-radius: 20px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); box-shadow: var(--shadow); animation: pop .2s ease-out; }
  .toast-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .toast-title { font-weight: 600; }
  .toast-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; white-space: pre-wrap; }
  .toast-meta { font-size: 12px; color: var(--muted); }
  /* тайл-«логотип»: всегда чёрный, как лаунчер — независимо от темы; картинка поверх */
  .avatar { flex: none; width: 36px; height: 36px; border-radius: 10px; background: var(--launcher-bg); color: var(--launcher-fg);
    display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* проактивное приглашение над лаунчером (тот же слот, что у .toast — одновременно не показываются) */
  .proactive { right: max(var(--vz-offset-x, 20px), env(safe-area-inset-right)); bottom: calc(max(var(--vz-offset-y, 20px), env(safe-area-inset-bottom)) + 76px);
    width: 280px; max-width: calc(100vw - 32px); display: flex; align-items: flex-start; gap: 4px; text-align: left;
    padding: 14px 8px 14px 16px; border-radius: 20px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); box-shadow: var(--shadow); animation: pop .2s ease-out; }
  .proactive-text { flex: 1; min-width: 0; font-size: 14px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; }
  .proactive-close { flex: none; width: 28px; height: 28px; border-radius: 50%; color: var(--muted); }
  .proactive-close:hover { background: var(--surface); color: var(--fg); }

  /* панель */
  .panel { display: none; flex-direction: column; right: max(var(--vz-offset-x, 20px), env(safe-area-inset-right));
    bottom: calc(max(var(--vz-offset-y, 20px), env(safe-area-inset-bottom)) + 76px); width: 400px; max-width: calc(100vw - 32px);
    height: min(680px, calc(100dvh - 96px - var(--vz-offset-y, 20px))); background: var(--bg); color: var(--fg);
    border-radius: 24px; box-shadow: var(--shadow); overflow: hidden; }
  .root.open .panel { display: flex; animation: pop .2s ease-out; }
  .root.left .launcher, .root.left .toast, .root.left .panel, .root.left .proactive { right: auto; left: max(var(--vz-offset-x, 20px), env(safe-area-inset-left)); }
  .head { display: flex; align-items: center; gap: 12px; padding: 14px 12px 14px 16px; border-bottom: 1px solid var(--border); }
  .head-text { flex: 1; min-width: 0; }
  .title { font-weight: 600; font-size: 16px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 13px; color: var(--muted); }
  .icon-btn { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--muted); }
  .icon-btn:hover { background: var(--surface); color: var(--fg); }
  .menu { position: relative; }
  .menu-list { position: absolute; top: calc(100% + 4px); right: 0; min-width: 190px; padding: 6px; border-radius: 14px;
    background: var(--bg); border: 1px solid var(--border); box-shadow: var(--shadow); z-index: 1; }
  .menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 10px; border-radius: 9px;
    font-size: 14px; text-align: left; color: var(--fg); }
  .menu-item:hover { background: var(--surface); }
  .banner { padding: 8px 16px; font-size: 13px; text-align: center; color: var(--danger); background: var(--surface); }
  .offline-banner { padding: 8px 16px; font-size: 13px; text-align: center; color: var(--muted); background: var(--surface); border-bottom: 1px solid var(--border); }

  .messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 6px; overscroll-behavior: contain; }
  .row { display: flex; flex-direction: column; max-width: 85%; }
  .row.visitor { align-self: flex-end; align-items: flex-end; }
  .row.agent { align-self: flex-start; align-items: flex-start; }
  .bubble { padding: 12px 16px; border-radius: 20px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; }
  .row.visitor .bubble { background: var(--brand); color: var(--brand-fg); }
  .row.agent .bubble { background: var(--surface); }
  .row.failed .bubble { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
  .meta { margin: 3px 4px 0; font-size: 11px; color: var(--muted); }
  .row.failed .meta { color: var(--danger); }
  .row.system { align-self: center; max-width: 100%; margin: 8px 0; font-size: 12px; color: var(--muted); text-align: center; }
  /* typing-индикатор: слайм-аватар Vizi (чистый CSS, без SVG) + белый пузырь
     с тремя подпрыгивающими точками */
  /* .bubble наследует white-space:pre-wrap (нужен для текста сообщений) — здесь
     текста нет, зато есть отступы/переносы строк разметки, которые иначе рендерятся
     как видимые пробелы и раздувают пузырь вправо */
  .row.agent.typing .bubble { background: transparent; padding: 0; white-space: normal; }
  .typing .vizi-typing { display: inline-flex; align-items: center; gap: 3px; padding: 2px 0; isolation: isolate; }

  /* слайм уменьшен с исходных 150×140 до размера аватара в ленте (~36×34) —
     проценты у глаз и border-radius у формы остаются теми же, они не зависят от масштаба */
  .vizi-slime { position: relative; flex: 0 0 auto; width: 36px; height: 34px;
    background: #0d0d0d; border-radius: 50% 50% 48% 52% / 60% 58% 42% 44%;
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, .9), 0 0 10px rgba(255, 255, 255, .3),
      inset -2px -3px 6px rgba(255, 255, 255, .08);
    animation: vizi-slime-morph 6s ease-in-out infinite, vizi-slime-breathe 3.2s ease-in-out infinite;
    transform-origin: bottom center; }
  .vizi-slime-eye { position: absolute; top: 32%; width: 17%; height: 30%;
    background: #fff; border-radius: 50%; animation: vizi-slime-blink 4.6s infinite; }
  .vizi-slime-eye.left { left: 26%; }
  .vizi-slime-eye.right { right: 26%; }
  .vizi-slime-shadow { position: absolute; left: 16%; right: 16%; bottom: -6px; height: 5px;
    background: rgba(0, 0, 0, .35); border-radius: 50%; filter: blur(2px);
    animation: vizi-slime-shadow-breathe 3.2s ease-in-out infinite; }
  @keyframes vizi-slime-morph {
    0%, 100% { border-radius: 50% 50% 48% 52% / 60% 58% 42% 44%; }
    33% { border-radius: 46% 54% 52% 48% / 54% 62% 38% 46%; }
    66% { border-radius: 54% 46% 46% 54% / 58% 52% 48% 42%; }
  }
  @keyframes vizi-slime-breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.05, .95); } }
  @keyframes vizi-slime-blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.06); } }
  @keyframes vizi-slime-shadow-breathe { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(1.08); } }

  /* плоский белый пузырь с треугольным «хвостиком» — вдвое компактнее референса
     (12px/18px паддинг, 8px точки → 6px/9px и 5px). Непрозрачный белый фон + тень
     нужны, чтобы не потеряться на белой панели в светлой теме */
  .vizi-typing-bubble { position: relative; display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 9px; border-radius: 12px; background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .12), 0 2px 8px rgba(0, 0, 0, .16); }
  .vizi-typing-bubble::before { content: ''; position: absolute; left: -5px; top: 32%; transform: translateY(-50%);
    border: 5px solid transparent; border-right-color: #fff; border-left: 0; }
  .vizi-dot { width: 5px; height: 5px; border-radius: 50%; background: #0d0d0d;
    animation: vizi-dot-bounce 1.2s ease-in-out infinite; }
  .vizi-dot:nth-child(2) { animation-delay: .15s; }
  .vizi-dot:nth-child(3) { animation-delay: .3s; }
  @keyframes vizi-dot-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-3px); } }
  .line { display: flex; align-items: center; gap: 4px; max-width: 100%; }
  .bubble { min-width: 0; }
  .reply-btn { flex: none; width: 28px; height: 28px; border-radius: 50%; color: var(--muted);
    display: flex; align-items: center; justify-content: center; opacity: 0; }
  .row:hover .reply-btn, .reply-btn:focus-visible { opacity: 1; }
  .reply-btn:hover { background: var(--surface); color: var(--fg); }
  .row:not([data-id]) .reply-btn { display: none; }
  .quote { margin: -2px 0 6px; padding: 4px 8px; border-left: 3px solid currentColor; border-radius: 6px;
    background: rgba(127,127,127,.18); font-size: 13px; line-height: 1.35; cursor: pointer; text-align: left; }
  .quote-author { font-weight: 600; opacity: .85; }
  .quote-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; opacity: .85; }
  .row.flash .bubble { animation: flash 1.3s ease-out; }
  @keyframes flash { 0%, 50% { box-shadow: 0 0 0 3px var(--ring); } 100% { box-shadow: 0 0 0 3px transparent; } }
  .emoji-btn { flex: none; width: 34px; height: 34px; border-radius: 50%; color: var(--muted); display: flex; align-items: center; justify-content: center; }
  .emoji-btn:hover, .emoji-btn[aria-expanded="true"] { background: var(--surface); color: var(--fg); }
  .emoji-panel { display: flex; flex-direction: column; height: 240px; border-top: 1px solid var(--border); padding-bottom: env(safe-area-inset-bottom); }
  .emoji-tabs { display: flex; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .emoji-tab { flex: none; width: 38px; height: 32px; border-radius: 8px; font-size: 18px; }
  .emoji-tab[aria-selected="true"] { background: var(--surface); }
  .emoji-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(38px, 1fr)); align-content: start; padding: 8px; gap: 2px; }
  .emoji { height: 38px; border-radius: 8px; font-size: 24px; line-height: 1; }
  .emoji:hover { background: var(--surface); }
  .emoji-empty { grid-column: 1 / -1; padding: 24px 8px; text-align: center; font-size: 13px; color: var(--muted); }
  .root.emoji-open .composer { padding-bottom: 10px; }
  .root.emoji-open .privacy { display: none; }
  .mic-btn { flex: none; width: 34px; height: 34px; border-radius: 50%; color: var(--muted); display: flex; align-items: center; justify-content: center; }
  .mic-btn:hover { background: var(--surface); color: var(--fg); }
  .mic-btn .ic-stop { display: none; }
  .mic-btn.listening { background: #ef4444; color: #fff; animation: pulse 1.4s ease-out infinite; }
  .mic-btn.listening .ic-mic { display: none; }
  .mic-btn.listening .ic-stop { display: block; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,.5); } 100% { box-shadow: 0 0 0 12px rgba(239,68,68,0); } }
  .note { padding: 6px 16px; font-size: 12px; text-align: center; color: var(--muted); background: var(--surface); }
  .note.error { color: var(--danger); }
  .reply-bar { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; border-top: 1px solid var(--border); background: var(--surface); }
  .reply-bar-text { flex: 1; min-width: 0; border-left: 3px solid var(--ring); padding-left: 8px; }
  .reply-author { font-size: 12px; font-weight: 600; }
  .reply-snippet { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row.failed .quote { border-color: var(--danger); }
  .welcome { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .quick { display: flex; flex-wrap: wrap; gap: 8px; max-width: 100%; }
  .quick-btn { padding: 8px 14px; border-radius: 18px; border: 1px solid var(--border); background: var(--bg); color: var(--fg);
    font-size: 14px; line-height: 1.3; text-align: left; overflow-wrap: anywhere; }
  .quick-btn:hover { background: var(--surface); border-color: var(--ring); }
  .load-more { align-self: center; margin-bottom: 8px; padding: 6px 14px; border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 12px; }
  .load-more:disabled { opacity: .6; cursor: default; }

  .composer { padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); }
  .composer-box { position: relative; border: 1px solid var(--border); border-radius: 20px; padding: 10px 10px 8px 14px; transition: border-color .15s; }
  .composer-box:focus-within { border-color: var(--ring); }
  .input { display: block; width: 100%; resize: none; max-height: ${MAX_INPUT_HEIGHT}px; min-height: 24px; padding: 0;
    border: 0; background: transparent; color: var(--fg); font-size: 16px; line-height: 1.35; outline: none; }
  .input::placeholder { color: var(--muted); }
  .composer-row { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
  .composer-icons { display: flex; align-items: center; gap: 2px; }
  .send { flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--brand); color: var(--brand-fg);
    display: flex; align-items: center; justify-content: center; transition: opacity .15s; }
  .send:disabled { opacity: .35; cursor: default; }
  .privacy { margin: 0; padding: 0 16px calc(10px + env(safe-area-inset-bottom)); font-size: 11px; line-height: 1.4; text-align: center; color: var(--muted); }
  .privacy a { color: inherit; text-decoration: underline; }

  /* сезонная тема «Winter»: падающие снежинки поверх панели, кликов не перехватывают */
  .snow { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; }
  .flake { position: absolute; top: -10%; color: var(--snow-color); opacity: .55; line-height: 1;
    text-shadow: 0 0 3px rgba(0,0,0,.15); animation-name: snow-fall; animation-timing-function: linear; animation-iteration-count: infinite; }
  /* top (не transform) — его % считаются от высоты панели, а не от крошечного
     бокса самой снежинки; transform остаётся только для покачивания и вращения */
  @keyframes snow-fall {
    0%   { top: -10%; transform: translateX(0) rotate(0deg); }
    25%  { top: 15%; transform: translateX(8px) rotate(90deg); }
    50%  { top: 50%; transform: translateX(-8px) rotate(180deg); }
    75%  { top: 85%; transform: translateX(8px) rotate(270deg); }
    100% { top: 110%; transform: translateX(0) rotate(360deg); }
  }

  /* Winter: статичные декорации — снег на поле ввода, сосульки и шапка
     Санты на тайле-«логотипе», гирлянда над шапкой панели */
  .root.winter .composer-box::before {
    content: ''; position: absolute; left: 6px; right: 6px; top: -7px; height: 12px;
    background:
      radial-gradient(circle at 8px 10px, #fff 5px, transparent 6px),
      radial-gradient(circle at 20px 6px, #fff 6px, transparent 7px),
      radial-gradient(circle at 32px 9px, #fff 5px, transparent 6px);
    background-repeat: repeat-x; background-size: 28px 12px;
    filter: drop-shadow(0 1px 1px rgba(0,0,0,.15)); pointer-events: none; }
  .head .avatar { position: relative; }
  .icicles { position: absolute; left: 3px; right: 3px; bottom: -8px; line-height: 0; pointer-events: none; }
  .icicles svg { width: 100%; height: 8px; display: block; }
  .santa-hat { position: absolute; top: -8px; left: -3px; width: 18px; height: 14px; pointer-events: none;
    filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.35)); }
  .santa-hat .cap { position: absolute; inset: 0 0 5px 0; background: #dc2626; clip-path: polygon(0% 100%, 100% 100%, 85% 15%, 15% 35%); border-radius: 2px; }
  .santa-hat .band { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: #fff; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
  .santa-hat .pompom { position: absolute; top: -2px; right: 0; width: 6px; height: 6px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.15); }
  .root.winter .head { position: relative; }
  .garland { position: absolute; left: 0; right: 0; top: -1px; height: 8px; display: flex;
    justify-content: space-evenly; align-items: center; pointer-events: none; z-index: 1; }
  .garland .bulb { width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 4px currentColor; }

  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .toast, .proactive, .root.open .panel, .vizi-slime, .vizi-slime-eye, .vizi-slime-shadow, .vizi-typing-bubble, .vizi-dot, .row.flash .bubble, .mic-btn.listening { animation: none; } .launcher { transition: none; } .flake { animation: none; display: none; } }

  @media (hover: none) and (pointer: coarse) {
    .reply-btn { display: none; }
    .bubble { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  }

  /* телефон: панель на весь экран, лаунчер скрыт (закрытие — в шапке) */
  @media (max-width: 480px) {
    .panel, .root.left .panel { inset: 0; width: auto; max-width: none; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
    .root.open .launcher { display: none; }
    .head { padding-top: calc(14px + env(safe-area-inset-top)); }
  }
</style>
<div class="root">
  <button class="toast" type="button" hidden>
    <span class="avatar"><img class="avatar-img" src="${AVATAR_URL}" alt="" /></span>
    <span class="toast-body">
      <span class="toast-title"></span>
      <span class="toast-text"></span>
      <span class="toast-meta"></span>
    </span>
  </button>
  ${
		PROACTIVE_MESSAGE
			? `<div class="proactive" role="status" hidden>
    <button class="proactive-text" type="button"></button>
    <button class="icon-btn proactive-close" type="button" aria-label="Закрыть приглашение">${ICON_CLOSE}</button>
  </div>`
			: ''
	}
  <section class="panel" role="dialog" aria-label="${TITLE.replace(/"/g, '&quot;')}">
    <div class="snow" aria-hidden="true" hidden></div>
    <header class="head">
      <span class="avatar"><img class="avatar-img" src="${AVATAR_URL}" alt="" /></span>
      <div class="head-text"><div class="title"></div><div class="sub">${SUBTITLE}</div></div>
      <div class="menu">
        <button class="icon-btn menu-btn" type="button" aria-label="Ещё" aria-haspopup="menu" aria-expanded="false">${ICON_MORE}</button>
        <div class="menu-list" role="menu" hidden>
          <button class="menu-item download" type="button" role="menuitem">${ICON_DOWNLOAD} Скачать историю</button>
        </div>
      </div>
      <button class="icon-btn close" type="button" aria-label="Свернуть чат">${ICON_CLOSE}</button>
    </header>
    <div class="banner" role="status" hidden>Нет соединения. Переподключаемся…</div>
    <div class="offline-banner" role="status" hidden></div>
    <div class="messages" role="log" aria-live="polite"></div>
    <div class="note" role="status" hidden></div>
    <div class="reply-bar" hidden>
      <div class="reply-bar-text"><div class="reply-author"></div><div class="reply-snippet"></div></div>
      <button class="icon-btn reply-cancel" type="button" aria-label="Отменить ответ">${ICON_CLOSE}</button>
    </div>
    <form class="composer">
      <div class="composer-box">
        <textarea class="input" rows="1" placeholder="Задать вопрос…" aria-label="Сообщение"></textarea>
        <div class="composer-row">
          <div class="composer-icons">
            <button class="emoji-btn" type="button" aria-label="Эмодзи" aria-expanded="false" aria-controls="emoji-panel">${ICON_SMILE}</button>
            <button class="mic-btn" type="button" aria-label="Надиктовать сообщение" aria-pressed="false" title="Голосовой ввод: речь распознаёт ваш браузер" hidden><span class="ic-mic">${ICON_MIC}</span><span class="ic-stop">${ICON_STOP}</span></button>
          </div>
          <button class="send" type="submit" aria-label="Отправить" disabled>${ICON_SEND}</button>
        </div>
      </div>
    </form>
    <div class="emoji-panel" id="emoji-panel" hidden>
      <div class="emoji-tabs" role="tablist" aria-label="Категории эмодзи"></div>
      <div class="emoji-grid" role="tabpanel"></div>
    </div>
    ${
			PRIVACY_URL
				? `<p class="privacy">Отправляя сообщение, вы соглашаетесь с <a href="${PRIVACY_URL.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer"></a></p>`
				: ''
		}
  </section>
  <button class="launcher" type="button" aria-label="Открыть чат" aria-expanded="false">
    <span class="ic-chat">${ICON_LAUNCHER}</span><span class="ic-close">${ICON_CHEVRON}</span>
    <span class="badge" hidden></span>
  </button>
</div>`

	const $ = sel => root.querySelector(sel)
	const rootEl = $('.root')
	if (POSITION === 'bottom-left') rootEl.classList.add('left')
	const launcher = $('.launcher')
	const badge = $('.badge')
	const toast = $('.toast')
	const proactive = $('.proactive')
	const proactiveText = $('.proactive-text')
	const proactiveClose = $('.proactive-close')
	if (proactiveText) proactiveText.textContent = PROACTIVE_MESSAGE
	const panel = $('.panel')
	const closeBtn = $('.close')
	const menuWrap = $('.menu')
	const menuBtn = $('.menu-btn')
	const menuList = $('.menu-list')
	const downloadItem = $('.menu-item.download')
	const banner = $('.banner')
	const offlineBanner = $('.offline-banner')
	const snow = $('.snow')
	const messagesEl = $('.messages')
	const form = $('.composer')
	const replyBar = $('.reply-bar')
	const emojiBtn = $('.emoji-btn')
	const micBtn = $('.mic-btn')
	const note = $('.note')
	const emojiPanel = $('.emoji-panel')
	const emojiTabs = $('.emoji-tabs')
	const emojiGrid = $('.emoji-grid')
	const input = $('.input')
	const sendBtn = $('.send')
	const privacyLink = $('.privacy a')
	if (privacyLink) privacyLink.textContent = PRIVACY_TEXT
	$('.title').textContent = TITLE

	// --- состояние ------------------------------------------------------------
	let token = localStorage.getItem('widget_token')
	// до создания сессии — есть ли уже токен (писал раньше); для проактивного приглашения
	const hadExistingSession = !!token
	let ws = null
	let starting = false
	let reconnectDelay = 1000
	let isOpen = false
	let hasOpenedChat = false // чат открывали в этой вкладке — приглашение больше не нужно
	let oldestId = null
	let maxId = 0
	let hasMore = false
	let unread = 0
	let toastTimer
	let proactiveTimer
	let lastSeenId = Number(localStorage.getItem('widget_last_seen')) || 0
	const renderedIds = new Set()
	let sendSeq = 0
	let adminReadAt = null // когда оператор последний раз читал беседу (ISO)
	let maxAgentId = 0
	let readReported = 0 // id последнего сообщения сотрудника, о прочтении которого сообщили серверу
	let lastTypingSent = 0
	let replyTarget = null // { id, sender, text } — на что сейчас отвечаем
	let typingTimer

	const timeFmt = new Intl.DateTimeFormat('ru-RU', {
		hour: '2-digit',
		minute: '2-digit'
	})
	const isAgent = sender => sender === 'admin' || sender === 'bot'

	// --- сообщения ------------------------------------------------------------
	// приветствие и быстрые вопросы — чисто фронтовый рендер, в БД не пишутся
	const greeting = document.createElement('div')
	greeting.className = 'welcome'
	const greetingRow = document.createElement('div')
	greetingRow.className = 'row agent'
	const greetingBubble = document.createElement('div')
	greetingBubble.className = 'bubble'
	greetingBubble.textContent = GREETING
	const greetingMeta = document.createElement('div')
	greetingMeta.className = 'meta'
	greetingMeta.textContent = `${TITLE} • Только что`
	greetingRow.append(greetingBubble, greetingMeta)
	greeting.appendChild(greetingRow)
	if (QUICK_REPLIES.length) {
		const quick = document.createElement('div')
		quick.className = 'quick'
		for (const text of QUICK_REPLIES) {
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'quick-btn'
			btn.textContent = text
			btn.addEventListener('click', () => sendText(text))
			quick.appendChild(btn)
		}
		greeting.appendChild(quick)
	}
	function updateGreeting() {
		// пока в беседе нет сообщений
		if (renderedIds.size === 0 && !messagesEl.querySelector('.row.visitor')) {
			if (!greeting.isConnected) messagesEl.appendChild(greeting)
		} else {
			greeting.remove()
		}
	}

	// «печатает»: пузырь с тремя точками в конце ленты (не сообщение, в истории не хранится)
	const typingEl = document.createElement('div')
	typingEl.className = 'row agent typing'
	typingEl.setAttribute('aria-hidden', 'true')
	typingEl.innerHTML = `<div class="bubble">
		<div class="vizi-typing">
			<div class="vizi-slime">
				<div class="vizi-slime-eye left"></div>
				<div class="vizi-slime-eye right"></div>
				<div class="vizi-slime-shadow"></div>
			</div>
			<div class="vizi-typing-bubble" aria-label="Vizi печатает">
				<span class="vizi-dot"></span>
				<span class="vizi-dot"></span>
				<span class="vizi-dot"></span>
			</div>
		</div>
	</div>`
	const nearBottom = () =>
		messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120
	function hideTyping() {
		clearTimeout(typingTimer)
		typingEl.remove()
	}
	function showTyping() {
		if (!isOpen) return
		const stick = nearBottom()
		if (!typingEl.isConnected) messagesEl.appendChild(typingEl)
		if (stick) messagesEl.scrollTop = messagesEl.scrollHeight
		clearTimeout(typingTimer)
		typingTimer = setTimeout(hideTyping, TYPING_SHOW_MS)
	}

	const loadMoreBtn = document.createElement('button')
	loadMoreBtn.type = 'button'
	loadMoreBtn.className = 'load-more'
	loadMoreBtn.textContent = 'Загрузить ещё'
	function updateLoadMore() {
		if (hasMore) {
			if (!loadMoreBtn.isConnected) messagesEl.prepend(loadMoreBtn)
		} else {
			loadMoreBtn.remove()
		}
	}

	// --- ответ на сообщение (цитата) ---------------------------------------------
	const authorLabel = sender => (sender === 'visitor' ? 'Вы' : AGENT)

	function buildQuote(q) {
		const el = document.createElement('div')
		el.className = 'quote'
		el.tabIndex = 0
		el.setAttribute('role', 'button')
		el.setAttribute('aria-label', 'Перейти к исходному сообщению')
		const author = document.createElement('div')
		author.className = 'quote-author'
		author.textContent = authorLabel(q.sender)
		const text = document.createElement('div')
		text.className = 'quote-text'
		text.textContent = q.text
		el.append(author, text)
		el.dataset.target = String(q.id)
		return el
	}

	function startReply(row) {
		const id = Number(row.dataset.id)
		if (!id) return // сообщение ещё не подтверждено сервером
		const sender = row.classList.contains('visitor') ? 'visitor' : 'agent'
		replyTarget = {
			id,
			sender,
			text: row.querySelector('.bubble .text').textContent.slice(0, QUOTE_LENGTH)
		}
		$('.reply-author').textContent = authorLabel(sender)
		$('.reply-snippet').textContent = replyTarget.text
		replyBar.hidden = false
		input.focus()
	}
	function cancelReply() {
		replyTarget = null
		replyBar.hidden = true
	}

	const findRow = id => messagesEl.querySelector(`.row[data-id="${id}"]`)
	// прокрутка к исходному сообщению; если оно в ещё не загруженной истории — подгружаем
	async function scrollToMessage(id) {
		let row = findRow(id)
		for (let i = 0; !row && hasMore && i < 10; i++) {
			await loadOlder()
			row = findRow(id)
		}
		if (!row) return
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
		row.classList.remove('flash')
		void row.offsetWidth // перезапуск анимации
		row.classList.add('flash')
		setTimeout(() => row.classList.remove('flash'), 1400)
	}

	// message: { id?, sender, text, createdAt?, replyTo? }
	function renderMessage(m, prepend = false) {
		const row = document.createElement('div')
		if (m.sender === 'system') {
			row.className = 'row system'
			row.textContent = m.text
		} else {
			const mine = m.sender === 'visitor'
			row.className = `row ${mine ? 'visitor' : 'agent'}`
			const bubble = document.createElement('div')
			bubble.className = 'bubble'
			if (m.replyTo) bubble.appendChild(buildQuote(m.replyTo))
			const text = document.createElement('span')
			text.className = 'text'
			text.textContent = m.text
			bubble.appendChild(text)
			const meta = document.createElement('div')
			meta.className = 'meta'
			const time = timeFmt.format(m.createdAt ? new Date(m.createdAt) : new Date())
			meta.textContent = mine ? time : `${AGENT} · ${time}`
			// серверное время — для «Прочитано»; у только что отправленного оно придёт в sent
			row.dataset.ts = m.createdAt || ''
			row.dataset.time = time
			// кнопка «Ответить» — со стороны, противоположной краю чата
			const replyBtn = document.createElement('button')
			replyBtn.type = 'button'
			replyBtn.className = 'reply-btn'
			replyBtn.setAttribute('aria-label', 'Ответить на сообщение')
			replyBtn.innerHTML = ICON_REPLY
			const line = document.createElement('div')
			line.className = 'line'
			if (mine) line.append(replyBtn, bubble)
			else line.append(bubble, replyBtn)
			row.append(line, meta)
		}
		if (m.id) row.dataset.id = String(m.id)
		if (prepend) {
			// старые сообщения идут сразу под кнопкой «Загрузить ещё»
			messagesEl.insertBefore(
				row,
				loadMoreBtn.isConnected ? loadMoreBtn.nextSibling : messagesEl.firstChild
			)
		} else {
			// новые сообщения — перед индикатором «печатает»
			messagesEl.insertBefore(row, typingEl.isConnected ? typingEl : null)
			messagesEl.scrollTop = messagesEl.scrollHeight
		}
		if (m.id) {
			renderedIds.add(m.id)
			maxId = Math.max(maxId, m.id)
			if (isAgent(m.sender)) maxAgentId = Math.max(maxAgentId, m.id)
		}
		updateGreeting()
		return row
	}

	// сервер не подтверждает успех, шлёт только ошибку — считаем сообщение
	// доставленным, если ошибка не пришла за ACK_TIMEOUT_MS
	const pending = []
	function trackPending(row, clientId) {
		const entry = { row, clientId }
		entry.timer = setTimeout(() => {
			const i = pending.indexOf(entry)
			if (i !== -1) pending.splice(i, 1)
		}, ACK_TIMEOUT_MS)
		pending.push(entry)
	}
	// сервер подтвердил сообщение: подставляем его id и серверное время
	function onSent(ack) {
		const i = pending.findIndex(e => e.clientId === ack.clientId)
		if (i === -1) return
		const entry = pending.splice(i, 1)[0]
		clearTimeout(entry.timer)
		if (ack.id) entry.row.dataset.id = String(ack.id)
		entry.row.dataset.ts = ack.createdAt
		entry.row.dataset.time = timeFmt.format(new Date(ack.createdAt))
		if (ack.id) {
			renderedIds.add(ack.id)
			maxId = Math.max(maxId, ack.id)
		}
		updateReceipts()
	}
	// «Прочитано» — под последним сообщением посетителя, которое оператор уже видел
	function updateReceipts() {
		const readAt = adminReadAt ? Date.parse(adminReadAt) : null
		let lastRead = null
		for (const row of messagesEl.querySelectorAll('.row.visitor:not(.failed)')) {
			row.querySelector('.meta').textContent = row.dataset.time
			if (readAt && row.dataset.ts && Date.parse(row.dataset.ts) <= readAt) {
				lastRead = row
			}
		}
		if (lastRead) lastRead.querySelector('.meta').textContent += ' · Прочитано'
	}
	// clientId возвращает сервер; без него (старый сервер) — самое раннее из ожидающих
	function markFailed(clientId, reason) {
		let i = clientId ? pending.findIndex(e => e.clientId === clientId) : -1
		if (i === -1) i = 0
		const entry = pending.splice(i, 1)[0]
		if (!entry) return
		clearTimeout(entry.timer)
		entry.row.classList.add('failed')
		const meta = entry.row.querySelector('.meta')
		meta.textContent = 'Не отправлено'
		meta.title = reason || ''
	}

	// --- непрочитанные и превью ----------------------------------------------
	function updateBadge() {
		badge.hidden = unread === 0
		badge.textContent = unread > 99 ? '99+' : String(unread)
		launcher.setAttribute(
			'aria-label',
			unread ? `Открыть чат, новых сообщений: ${unread}` : 'Открыть чат'
		)
	}
	function markSeen() {
		if (maxId > lastSeenId) {
			lastSeenId = maxId
			try {
				localStorage.setItem('widget_last_seen', String(lastSeenId))
			} catch {}
		}
		unread = 0
		updateBadge()
		reportRead()
	}
	// посетитель видит ответы (панель открыта, вкладка на виду) — оператор покажет «Прочитано»
	function reportRead() {
		if (!isOpen || document.visibilityState !== 'visible' || !token) return
		if (maxAgentId <= readReported) return
		const prev = readReported
		readReported = maxAgentId
		fetch(`${API_URL}/widget/read`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` }
		}).catch(() => {
			readReported = prev // сеть недоступна — попробуем при следующем случае
		})
	}
	function hideToast() {
		clearTimeout(toastTimer)
		toast.hidden = true
	}

	// --- проактивное приглашение ------------------------------------------------
	function hideProactive() {
		clearTimeout(proactiveTimer)
		if (proactive) proactive.hidden = true
	}
	function dismissProactive() {
		hideProactive()
		try {
			sessionStorage.setItem(PROACTIVE_DISMISSED_KEY, '1')
		} catch {}
	}
	function maybeShowProactive() {
		if (hasOpenedChat || hadExistingSession) return
		try {
			if (sessionStorage.getItem(PROACTIVE_DISMISSED_KEY)) return
		} catch {}
		proactive.hidden = false
	}
	if (proactive) {
		proactiveTimer = setTimeout(maybeShowProactive, PROACTIVE_DELAY_MS)
		proactiveText.addEventListener('click', () => {
			hideProactive()
			openChat()
		})
		proactiveClose.addEventListener('click', dismissProactive)
	}

	function showToast(m) {
		$('.toast-title').textContent = TITLE
		$('.toast-text').textContent = m.text
		$('.toast-meta').textContent = `${AGENT} · Только что`
		toast.hidden = false
		clearTimeout(toastTimer)
		toastTimer = setTimeout(hideToast, TOAST_MS)
	}
	// новое сообщение от сотрудника
	function onAgentMessage(m, live) {
		if (isOpen) return markSeen()
		if (m.id <= lastSeenId) return
		unread++
		updateBadge()
		if (live) showToast(m)
	}

	// --- сеть -----------------------------------------------------------------
	function resetSession() {
		token = null
		localStorage.removeItem('widget_token')
	}

	async function ensureSession() {
		if (token) return token
		const res = await fetch(`${API_URL}/widget/session`, { method: 'POST' })
		if (!res.ok) throw new Error('session failed')
		const data = await res.json()
		token = data.token
		localStorage.setItem('widget_token', token)
		return token
	}

	function fetchHistoryPage(before) {
		const params = new URLSearchParams({ limit: PAGE_SIZE })
		if (before) params.set('before', before)
		return fetch(`${API_URL}/widget/messages?${params}`, {
			headers: { Authorization: `Bearer ${token}` }
		})
	}

	async function loadHistory() {
		const res = await fetchHistoryPage()
		if (res.status === 401) {
			// токен протух или не признан сервером — начинаем новую сессию
			resetSession()
			await ensureSession()
			return loadHistory()
		}
		if (!res.ok) throw new Error('history failed')
		const messages = await res.json()
		messagesEl.textContent = ''
		renderedIds.clear()
		maxId = 0
		unread = 0
		messages.forEach(m => renderMessage(m))
		if (isOpen) markSeen()
		else {
			messages.forEach(m => isAgent(m.sender) && onAgentMessage(m, false))
			updateBadge()
		}
		oldestId = messages[0]?.id ?? null
		hasMore = messages.length === PAGE_SIZE
		updateLoadMore()
		updateGreeting()
		updateReceipts()
	}

	// рабочий график: публичный эндпоинт, токен посетителя не нужен. Не блокирует
	// отправку сообщений — просто честно говорит, что ответ будет не сразу
	async function checkStatus() {
		try {
			const res = await fetch(`${API_URL}/widget/status`)
			if (!res.ok) return
			const { online, scheduleSummary } = await res.json()
			offlineBanner.hidden = online
			offlineBanner.textContent = online
				? ''
				: scheduleSummary
					? `Сейчас мы не в сети. Обычно отвечаем в рабочие часы: ${scheduleSummary}`
					: 'Сейчас мы не в сети.'
		} catch {
			// сбой — молчим, лучше ничего не показать, чем соврать про офлайн
		}
	}

	// случайное число в [min, max)
	const randomBetween = (min, max) => min + Math.random() * (max - min)

	// падающие снежинки поверх панели (тема Winter); рисуются один раз и просто
	// крутятся в CSS-анимации, пока панель открыта — скрыты вместе с panel при закрытии
	function renderSnow() {
		if (!snow || snow.childElementCount) return
		for (let i = 0; i < SNOW_COUNT; i++) {
			const flake = document.createElement('span')
			flake.className = 'flake'
			flake.textContent = SNOW_CHARS[i % SNOW_CHARS.length]
			flake.style.left = `${randomBetween(0, 95)}%`
			flake.style.fontSize = `${randomBetween(10, 20)}px`
			flake.style.animationDuration = `${randomBetween(7, 15)}s`
			// отрицательная задержка — снежинки стартуют в разных фазах, а не все разом сверху
			flake.style.animationDelay = `-${randomBetween(0, 15)}s`
			snow.appendChild(flake)
		}
	}

	// сосульки под тайлом-«логотипом» в шапке: ряд треугольных «спайков»,
	// высота каждого чуть гуляет — рисуются один раз как маленький inline SVG
	function buildIcicles() {
		const wrap = document.createElement('span')
		wrap.className = 'icicles'
		wrap.setAttribute('aria-hidden', 'true')
		const w = 36, h = 9, count = 5
		let paths = ''
		for (let i = 0; i < count; i++) {
			const seg = w / count
			const cx = seg * (i + 0.5)
			const spikeH = h * randomBetween(0.55, 0.95)
			const half = seg * 0.32
			paths += `<path d="M${(cx - half).toFixed(1)} 0 L${(cx + half).toFixed(1)} 0 L${cx.toFixed(1)} ${spikeH.toFixed(1)} Z" fill="#cdeeff"/>`
		}
		wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">${paths}</svg>`
		return wrap
	}

	// шапка Санты на уголке того же тайла — три слоя (колпак/кант/помпон), чистый CSS
	function buildSantaHat() {
		const el = document.createElement('span')
		el.className = 'santa-hat'
		el.setAttribute('aria-hidden', 'true')
		el.innerHTML = '<span class="cap"></span><span class="band"></span><span class="pompom"></span>'
		return el
	}

	// гирлянда лампочек над шапкой панели
	const GARLAND_COLORS = ['#dc2626', '#16a34a', '#facc15', '#2563eb']
	function buildGarland(count = 9) {
		const el = document.createElement('div')
		el.className = 'garland'
		el.setAttribute('aria-hidden', 'true')
		for (let i = 0; i < count; i++) {
			const bulb = document.createElement('span')
			bulb.className = 'bulb'
			const color = GARLAND_COLORS[i % GARLAND_COLORS.length]
			bulb.style.background = color
			bulb.style.color = color
			el.appendChild(bulb)
		}
		return el
	}

	// статичные зимние декорации (сосульки, шапка Санты, гирлянда); снег на поле
	// ввода — чистый CSS по классу .winter, без лишних элементов. Рисуются один раз
	let winterDecorRendered = false
	function renderWinterDecor() {
		if (winterDecorRendered) return
		winterDecorRendered = true
		rootEl.classList.add('winter')
		const avatar = $('.head .avatar')
		if (avatar) {
			avatar.appendChild(buildSantaHat())
			avatar.appendChild(buildIcicles())
		}
		const head = $('.head')
		if (head) head.prepend(buildGarland())
	}

	// тема виджета (Winter — снежинки и статичные зимние декорации); публичный
	// эндпоинт, без токена. Запрашивается один раз при загрузке страницы
	async function checkConfig() {
		try {
			const res = await fetch(`${API_URL}/widget/config`)
			if (!res.ok) return
			const { theme } = await res.json()
			if (theme === 'winter' && snow) {
				renderSnow()
				snow.hidden = false
				renderWinterDecor()
			}
		} catch {
			// сбой — тему просто не включаем, обычный вид не хуже
		}
	}

	// скачать историю беседы .txt файлом; имя берём из Content-Disposition сервера
	async function exportHistory() {
		if (!token) return
		try {
			const res = await fetch(`${API_URL}/widget/export`, {
				headers: { Authorization: `Bearer ${token}` }
			})
			if (!res.ok) return
			const disposition = res.headers.get('content-disposition') || ''
			const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] || 'conversation.txt'
			const blob = await res.blob()
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = filename
			document.body.appendChild(a)
			a.click()
			a.remove()
			URL.revokeObjectURL(url)
		} catch {
			// сеть недоступна — молча ничего не скачиваем
		}
	}

	// когда оператор последний раз читал беседу (для «Прочитано»); сбой не критичен
	async function loadState() {
		try {
			const res = await fetch(`${API_URL}/widget/state`, {
				headers: { Authorization: `Bearer ${token}` }
			})
			if (!res.ok) return
			adminReadAt = (await res.json()).adminLastReadAt
			updateReceipts()
		} catch {}
	}

	async function loadOlder() {
		if (!hasMore || !oldestId) return
		loadMoreBtn.disabled = true
		try {
			const res = await fetchHistoryPage(oldestId)
			if (!res.ok) return
			const older = await res.json()
			const prevHeight = messagesEl.scrollHeight
			// вставляем с конца, чтобы порядок остался хронологическим
			for (let i = older.length - 1; i >= 0; i--) renderMessage(older[i], true)
			messagesEl.scrollTop += messagesEl.scrollHeight - prevHeight
			updateReceipts()
			oldestId = older[0]?.id ?? oldestId
			hasMore = older.length === PAGE_SIZE
			updateLoadMore()
		} catch (e) {
			console.error('widget load older failed', e)
		} finally {
			loadMoreBtn.disabled = false
		}
	}

	function scheduleRestart() {
		banner.hidden = false
		setTimeout(start, reconnectDelay)
		reconnectDelay = Math.min(reconnectDelay * 2, 15000)
	}

	function connectWs() {
		ws = new WebSocket(`${WS_URL}?token=${token}`)
		ws.onopen = () => {
			reconnectDelay = 1000
			banner.hidden = true
		}
		ws.onmessage = event => {
			let msg
			try {
				msg = JSON.parse(event.data)
			} catch {
				return
			}
			if (!msg || typeof msg !== 'object') return
			// служебные события
			if (msg.type === 'error') return markFailed(msg.clientId, msg.error)
			if (msg.type === 'sent') return onSent(msg)
			if (msg.type === 'typing') return msg.from === 'admin' && showTyping()
			if (msg.type === 'read') {
				if (msg.by === 'admin') {
					adminReadAt = msg.at
					updateReceipts()
				}
				return
			}
			// обычное сообщение
			if (!msg.sender || renderedIds.has(msg.id)) return
			// автоответ бота: сервер шлёт его сразу, без typing — имитируем задержку сами
			if (msg.sender === 'bot') {
				renderedIds.add(msg.id)
				showTyping()
				setTimeout(() => {
					hideTyping()
					renderMessage(msg)
					onAgentMessage(msg, true)
				}, BOT_TYPING_DELAY_MS)
				return
			}
			if (isAgent(msg.sender)) hideTyping()
			renderMessage(msg)
			if (isAgent(msg.sender)) onAgentMessage(msg, true)
		}
		ws.onerror = e => console.error('widget ws error', e)
		ws.onclose = () => {
			ws = null
			scheduleRestart()
		}
	}

	async function start() {
		if (starting || ws) return
		starting = true
		try {
			await ensureSession()
			await loadHistory()
			await loadState()
			connectWs()
		} catch (e) {
			console.error('widget start failed', e)
			scheduleRestart()
		} finally {
			starting = false
		}
	}

	// --- открытие/закрытие ----------------------------------------------------
	function setOpen(open) {
		isOpen = open
		rootEl.classList.toggle('open', open)
		launcher.setAttribute('aria-expanded', String(open))
		if (open) {
			hasOpenedChat = true
			hideProactive()
			hideToast()
			markSeen()
			messagesEl.scrollTop = messagesEl.scrollHeight
			// на сенсорных экранах не открываем клавиатуру сама по себе
			if (window.matchMedia('(hover: hover)').matches) input.focus()
		}
	}
	async function openChat() {
		setOpen(true)
		checkStatus() // не блокирует остальной старт
		await start()
	}
	function closeChat() {
		abortDictation()
		setOpen(false)
		launcher.focus()
	}

	// --- отправка -------------------------------------------------------------
	function autosize() {
		input.style.height = 'auto'
		input.style.height = Math.min(input.scrollHeight, MAX_INPUT_HEIGHT) + 'px'
		sendBtn.disabled = !input.value.trim()
	}

	function sendMessage() {
		const text = input.value.trim()
		if (text && sendText(text)) {
			input.value = ''
			autosize()
		}
	}

	// отправка от имени посетителя; false — нет соединения (черновик не трогаем)
	function sendText(text) {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			// нет соединения: не теряем текст, баннер уже объясняет причину
			banner.hidden = false
			return false
		}
		const clientId = `${Date.now().toString(36)}-${++sendSeq}`
		abortDictation()
		const replyToId = replyTarget?.id
		trackPending(renderMessage({ sender: 'visitor', text, replyTo: replyTarget }), clientId)
		ws.send(
			JSON.stringify({
				text,
				clientId,
				lang: BOT_LANG,
				...(replyToId ? { replyToId } : {})
			})
		)
		cancelReply()
		return true
	}

	// --- диктовка (речь → текст, распознаёт браузер) ----------------------------
	const DICTATION_ERRORS = {
		'not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера.',
		'service-not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера.',
		'audio-capture': 'Микрофон не найден.',
		network: 'Нет связи с сервисом распознавания речи.',
		'no-speech': 'Речь не распознана. Попробуйте ещё раз.',
		'language-not-supported': 'Этот язык не поддерживается браузером.'
	}
	const NOTICE_KEY = 'widget_dictation_notice'
	const PLACEHOLDER = input.placeholder
	let rec = null
	let noteTimer
	if (SpeechRec) micBtn.hidden = false

	function setNote(text, { error = false, ms = 6000 } = {}) {
		clearTimeout(noteTimer)
		note.textContent = text
		note.classList.toggle('error', error)
		note.hidden = !text
		if (text) noteTimer = setTimeout(() => (note.hidden = true), ms)
	}
	function setListening(on) {
		micBtn.classList.toggle('listening', on)
		micBtn.setAttribute('aria-pressed', String(on))
		micBtn.setAttribute('aria-label', on ? 'Остановить диктовку' : 'Надиктовать сообщение')
		input.placeholder = on ? 'Говорите…' : PLACEHOLDER
	}
	function startDictation() {
		if (!SpeechRec || rec) return
		// первое использование: честно говорим, куда уходит звук
		let seen = true
		try {
			seen = !!localStorage.getItem(NOTICE_KEY)
			localStorage.setItem(NOTICE_KEY, '1')
		} catch {}
		if (!seen) {
			setNote('Речь распознаёт ваш браузер: аудио передаётся на серверы Google или Apple.', { ms: 8000 })
		}
		// текст до и после курсора сохраняем, надиктованное вставляем между ними
		const from = input.selectionStart ?? input.value.length
		const to = input.selectionEnd ?? from
		let prefix = input.value.slice(0, from)
		let suffix = input.value.slice(to)
		if (prefix && !/\s$/.test(prefix)) prefix += ' '
		if (suffix && !/^\s/.test(suffix)) suffix = ' ' + suffix

		const r = new SpeechRec()
		r.lang = LANG
		r.continuous = true
		r.interimResults = true
		r.maxAlternatives = 1
		r.onresult = e => {
			if (rec !== r) return
			// собираем текст из всех результатов заново, а не дописываем кусками:
			// так не бывает дублей (известная проблема на части Android-устройств)
			let text = ''
			for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
			text = text.replace(/^\s+/, '')
			input.value = prefix + text + suffix
			const pos = (prefix + text).length
			input.setSelectionRange(pos, pos)
			input.dispatchEvent(new Event('input')) // размер поля, кнопка отправки, «печатаю»
		}
		r.onerror = e => {
			if (rec !== r || e.error === 'aborted') return
			setNote(DICTATION_ERRORS[e.error] || 'Не удалось распознать речь.', { error: true })
		}
		r.onend = () => {
			if (rec !== r) return
			rec = null
			setListening(false)
		}
		try {
			rec = r
			r.start()
			setListening(true)
		} catch {
			rec = null
			setListening(false)
			setNote('Не удалось включить голосовой ввод.', { error: true })
		}
	}
	// остановить и дождаться последних слов (кнопка «стоп»)
	function stopDictation() {
		rec?.stop()
	}
	// прервать сразу, поздние результаты игнорируем (отправка, закрытие чата)
	function abortDictation() {
		const r = rec
		if (!r) return
		rec = null
		setListening(false)
		try {
			r.abort()
		} catch {}
	}
	micBtn.addEventListener('click', () => (rec ? stopDictation() : startDictation()))

	// --- эмодзи ---------------------------------------------------------------
	let emojiCategory = 'smileys'
	const readRecent = () => {
		try {
			const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
			return Array.isArray(list) ? list.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : []
		} catch {
			return []
		}
	}
	function pushRecent(emoji) {
		const next = [emoji, ...readRecent().filter(e => e !== emoji)].slice(0, RECENT_MAX)
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(next))
		} catch {}
	}
	function renderEmoji() {
		const categories = [
			{ id: 'recent', label: 'Недавние', icon: '🕘', emojis: readRecent() },
			...EMOJI_CATEGORIES
		]
		if (emojiCategory === 'recent' && !categories[0].emojis.length) emojiCategory = 'smileys'
		emojiTabs.textContent = ''
		for (const c of categories) {
			if (c.id === 'recent' && !c.emojis.length) continue
			const tab = document.createElement('button')
			tab.type = 'button'
			tab.className = 'emoji-tab'
			tab.setAttribute('role', 'tab')
			tab.setAttribute('aria-label', c.label)
			tab.setAttribute('aria-selected', String(c.id === emojiCategory))
			tab.textContent = c.icon
			tab.addEventListener('click', () => {
				emojiCategory = c.id
				renderEmoji()
			})
			emojiTabs.appendChild(tab)
		}
		const current = categories.find(c => c.id === emojiCategory)
		emojiGrid.textContent = ''
		for (const emoji of current.emojis) {
			const b = document.createElement('button')
			b.type = 'button'
			b.className = 'emoji'
			b.textContent = emoji
			b.setAttribute('aria-label', emoji)
			emojiGrid.appendChild(b)
		}
	}
	function setEmojiOpen(open) {
		emojiPanel.hidden = !open
		rootEl.classList.toggle('emoji-open', open)
		emojiBtn.setAttribute('aria-expanded', String(open))
		if (open) renderEmoji()
	}
	function insertEmoji(emoji) {
		// вставка в позицию курсора (выделение сохраняется, даже если поле потеряло фокус)
		input.setRangeText(emoji, input.selectionStart, input.selectionEnd, 'end')
		input.dispatchEvent(new Event('input')) // размер поля, кнопка отправки, «печатаю»
		pushRecent(emoji)
		// на телефоне не поднимаем клавиатуру заново
		if (window.matchMedia('(hover: hover)').matches) input.focus()
	}
	emojiBtn.addEventListener('click', () => setEmojiOpen(emojiPanel.hidden))
	// кнопки не забирают фокус у поля ввода
	emojiPanel.addEventListener('pointerdown', e => e.preventDefault())
	emojiGrid.addEventListener('click', e => {
		const b = e.target.closest('.emoji')
		if (b) insertEmoji(b.textContent)
	})

	form.addEventListener('submit', e => {
		e.preventDefault()
		sendMessage()
		input.focus()
	})
	input.addEventListener('input', () => {
		autosize()
		// сообщаем оператору «печатаю» (не чаще раза в TYPING_EMIT_MS)
		const now = Date.now()
		if (
			input.value.trim() &&
			ws &&
			ws.readyState === WebSocket.OPEN &&
			now - lastTypingSent > TYPING_EMIT_MS
		) {
			lastTypingSent = now
			ws.send(JSON.stringify({ type: 'typing' }))
		}
	})
	document.addEventListener('visibilitychange', reportRead)
	input.addEventListener('keydown', e => {
		// Enter — отправить, Shift+Enter — новая строка; не мешаем IME-вводу
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault()
			sendMessage()
		}
	})
	root.addEventListener('keydown', e => {
		if (e.key !== 'Escape') return
		// Escape по очереди: панель эмодзи, ответ, чат
		if (!emojiPanel.hidden) {
			setEmojiOpen(false)
			emojiBtn.focus()
		} else if (replyTarget) cancelReply()
		else if (isOpen) closeChat()
	})
	$('.reply-cancel').addEventListener('click', () => {
		cancelReply()
		input.focus()
	})
	messagesEl.addEventListener('click', e => {
		const btn = e.target.closest('.reply-btn')
		if (btn) return startReply(btn.closest('.row'))
		const quote = e.target.closest('.quote')
		if (quote) scrollToMessage(Number(quote.dataset.target))
	})
	messagesEl.addEventListener('keydown', e => {
		if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('quote')) {
			e.preventDefault()
			scrollToMessage(Number(e.target.dataset.target))
		}
	})
	// долгое нажатие на сообщение (сенсорный экран) — ответить
	let pressTimer, pressX = 0, pressY = 0
	const cancelPress = () => clearTimeout(pressTimer)
	messagesEl.addEventListener('pointerdown', e => {
		if (e.pointerType !== 'touch') return
		const row = e.target.closest('.row.visitor, .row.agent')
		if (!row || e.target.closest('.quote')) return
		pressX = e.clientX
		pressY = e.clientY
		pressTimer = setTimeout(() => {
			startReply(row)
			if (navigator.vibrate) navigator.vibrate(15)
		}, LONG_PRESS_MS)
	})
	messagesEl.addEventListener('pointermove', e => {
		if (Math.abs(e.clientX - pressX) > 8 || Math.abs(e.clientY - pressY) > 8) cancelPress()
	})
	for (const type of ['pointerup', 'pointercancel', 'scroll']) {
		messagesEl.addEventListener(type, cancelPress)
	}
	launcher.addEventListener('click', () => (isOpen ? closeChat() : openChat()))
	closeBtn.addEventListener('click', closeChat)
	function setMenuOpen(open) {
		menuList.hidden = !open
		menuBtn.setAttribute('aria-expanded', String(open))
	}
	menuBtn.addEventListener('click', () => setMenuOpen(menuList.hidden))
	downloadItem.addEventListener('click', () => {
		setMenuOpen(false)
		exportHistory()
	})
	// клик вне меню или Escape — закрыть
	document.addEventListener('click', e => {
		if (!menuList.hidden && !e.composedPath().includes(menuWrap)) setMenuOpen(false)
	})
	root.addEventListener('keydown', e => {
		if (e.key === 'Escape' && !menuList.hidden) setMenuOpen(false)
	})
	toast.addEventListener('click', openChat)
	loadMoreBtn.addEventListener('click', loadOlder)

	function mount() {
		document.body.appendChild(host)
		checkConfig() // не блокирует остальной старт
		// вернувшийся посетитель: подключаемся в фоне, чтобы работали бейдж и превью.
		// Новым посетителям сессию не создаём, пока они не откроют чат.
		if (token) start()
	}
	if (document.body) mount()
	else document.addEventListener('DOMContentLoaded', mount)
})()
