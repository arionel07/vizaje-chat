/*
 * Виджет поддержки vizaje-chat.
 *
 *   <script src="widget.js" data-api="https://chat.example.com"></script>
 *
 * Необязательные атрибуты:
 *   data-theme  — auto (по умолчанию, системная тема посетителя) | light | dark
 *   data-title  — заголовок панели (по умолчанию «Поддержка Vizaje-Nica»)
 *   data-agent  — подпись сотрудника под сообщениями (по умолчанию «Поддержка»)
 */
;(function () {
	if (window.__vizajeChatLoaded) return
	window.__vizajeChatLoaded = true

	const script =
		document.currentScript || document.querySelector('script[data-api]')
	const cfg = script?.dataset || {}
	const API_URL = (cfg.api || 'http://localhost:3001').replace(/\/$/, '')
	const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws'
	const TITLE = cfg.title || 'Поддержка Vizaje-Nica'
	const AGENT = cfg.agent || 'Поддержка'
	const THEME = ['light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto'

	const PAGE_SIZE = 50
	const ACK_TIMEOUT_MS = 2000
	const TOAST_MS = 15000
	const MAX_INPUT_HEIGHT = 120

	// --- иконки (lucide, inline: виджет без сборки и зависимостей) -----------
	const svg = (body, size = 24, extra = '') =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`
	const ICON_BUBBLE = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9.5L5.8 21.4A.6.6 0 0 1 5 21v-3a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path fill="none" stroke="var(--launcher-bg)" stroke-width="1.8" stroke-linecap="round" d="M8.5 10.6c.8 1.2 2 1.8 3.5 1.8s2.7-.6 3.5-1.8"/></svg>`
	const ICON_CHEVRON = svg('<path d="m6 9 6 6 6-6"/>', 26)
	const ICON_CLOSE = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 20)
	const ICON_SEND = svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 20)
	const ICON_AVATAR = svg(
		'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
		20
	)

	// --- разметка и стили (Shadow DOM: стили сайта и виджета не пересекаются) --
	const host = document.createElement('div')
	host.id = 'vizaje-chat-host'
	host.setAttribute('data-theme', THEME)
	const root = host.attachShadow({ mode: 'open' })

	root.innerHTML = `
<style>
  :host { all: initial;
    --bg: #ffffff; --fg: #18181b; --muted: #71717a; --surface: #f4f4f5; --border: #e4e4e7;
    --brand: #18181b; --brand-fg: #ffffff; --ring: #18181b; --danger: #dc2626;
    --launcher-bg: #ffffff; --launcher-fg: #18181b; --shadow: 0 12px 48px rgba(0,0,0,.22);
    color-scheme: light; }
  :host([data-theme="dark"]) {
    --bg: #17181c; --fg: #f4f4f5; --muted: #a1a1aa; --surface: #2a2b31; --border: #2e2f36;
    --brand: #f4f4f5; --brand-fg: #17181c; --ring: #f4f4f5; --danger: #f87171;
    --shadow: 0 12px 48px rgba(0,0,0,.6); color-scheme: dark; }
  @media (prefers-color-scheme: dark) {
    :host([data-theme="auto"]) {
      --bg: #17181c; --fg: #f4f4f5; --muted: #a1a1aa; --surface: #2a2b31; --border: #2e2f36;
      --brand: #f4f4f5; --brand-fg: #17181c; --ring: #f4f4f5; --danger: #f87171;
      --shadow: 0 12px 48px rgba(0,0,0,.6); color-scheme: dark; } }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; border: 0; background: none; padding: 0; }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

  .root { font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; color: var(--fg); }
  .launcher, .toast, .panel { position: fixed; z-index: 2147483000; }

  /* кнопка-лаунчер */
  .launcher { right: max(20px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom));
    width: 60px; height: 60px; border-radius: 50%; background: var(--launcher-bg); color: var(--launcher-fg);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.06); transition: transform .15s ease; }
  .launcher:hover { transform: scale(1.06); }
  .launcher .ic-close { display: none; }
  .root.open .launcher .ic-chat { display: none; }
  .root.open .launcher .ic-close { display: block; }
  .badge { position: absolute; top: -4px; right: -4px; min-width: 22px; height: 22px; padding: 0 6px;
    border-radius: 11px; background: #ef4444; color: #fff; font-size: 12px; font-weight: 600; line-height: 1;
    display: flex; align-items: center; justify-content: center; border: 2px solid var(--launcher-bg); }

  /* превью нового сообщения над лаунчером */
  .toast { right: max(20px, env(safe-area-inset-right)); bottom: calc(max(20px, env(safe-area-inset-bottom)) + 76px);
    width: 320px; max-width: calc(100vw - 32px); display: flex; gap: 12px; text-align: left;
    padding: 14px 16px; border-radius: 20px; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); box-shadow: var(--shadow); animation: pop .2s ease-out; }
  .toast-body { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .toast-title { font-weight: 600; }
  .toast-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; white-space: pre-wrap; }
  .toast-meta { font-size: 12px; color: var(--muted); }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--brand); color: var(--brand-fg);
    display: flex; align-items: center; justify-content: center; }

  /* панель */
  .panel { display: none; flex-direction: column; right: max(20px, env(safe-area-inset-right));
    bottom: calc(max(20px, env(safe-area-inset-bottom)) + 76px); width: 400px; max-width: calc(100vw - 32px);
    height: min(680px, calc(100dvh - 116px)); background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 24px; box-shadow: var(--shadow); overflow: hidden; }
  .root.open .panel { display: flex; animation: pop .2s ease-out; }
  .head { display: flex; align-items: center; gap: 12px; padding: 14px 12px 14px 16px; border-bottom: 1px solid var(--border); }
  .head-text { flex: 1; min-width: 0; }
  .title { font-weight: 600; font-size: 16px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 13px; color: var(--muted); }
  .icon-btn { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--muted); }
  .icon-btn:hover { background: var(--surface); color: var(--fg); }
  .banner { padding: 8px 16px; font-size: 13px; text-align: center; color: var(--danger); background: var(--surface); }

  .messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 6px; overscroll-behavior: contain; }
  .row { display: flex; flex-direction: column; max-width: 85%; }
  .row.visitor { align-self: flex-end; align-items: flex-end; }
  .row.agent { align-self: flex-start; align-items: flex-start; }
  .bubble { padding: 10px 14px; border-radius: 18px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; }
  .row.visitor .bubble { background: var(--brand); color: var(--brand-fg); border-bottom-right-radius: 6px; }
  .row.agent .bubble { background: var(--surface); border-bottom-left-radius: 6px; }
  .row.failed .bubble { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
  .meta { margin: 3px 4px 0; font-size: 11px; color: var(--muted); }
  .row.failed .meta { color: var(--danger); }
  .row.system { align-self: center; max-width: 100%; margin: 8px 0; font-size: 12px; color: var(--muted); text-align: center; }
  .load-more { align-self: center; margin-bottom: 8px; padding: 6px 14px; border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 12px; }
  .load-more:disabled { opacity: .6; cursor: default; }

  .composer { display: flex; align-items: flex-end; gap: 8px; padding: 12px 12px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--border); }
  .input { flex: 1; min-width: 0; resize: none; max-height: ${MAX_INPUT_HEIGHT}px; min-height: 42px; padding: 10px 16px;
    border: 1px solid var(--border); border-radius: 21px; background: var(--bg); color: var(--fg); font-size: 16px; line-height: 1.35; outline: none; }
  .input::placeholder { color: var(--muted); }
  .input:focus { border-color: var(--ring); }
  .send { flex: none; width: 42px; height: 42px; border-radius: 50%; background: var(--brand); color: var(--brand-fg);
    display: flex; align-items: center; justify-content: center; transition: opacity .15s; }
  .send:disabled { opacity: .35; cursor: default; }

  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .toast, .root.open .panel { animation: none; } .launcher { transition: none; } }

  /* телефон: панель на весь экран, лаунчер скрыт (закрытие — в шапке) */
  @media (max-width: 480px) {
    .panel { inset: 0; width: auto; max-width: none; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
    .root.open .launcher { display: none; }
    .head { padding-top: calc(14px + env(safe-area-inset-top)); }
  }
</style>
<div class="root">
  <button class="toast" type="button" hidden>
    <span class="avatar">${ICON_AVATAR}</span>
    <span class="toast-body">
      <span class="toast-title"></span>
      <span class="toast-text"></span>
      <span class="toast-meta"></span>
    </span>
  </button>
  <section class="panel" role="dialog" aria-label="${TITLE.replace(/"/g, '&quot;')}">
    <header class="head">
      <span class="avatar">${ICON_AVATAR}</span>
      <div class="head-text"><div class="title"></div><div class="sub">Задайте вопрос — мы ответим здесь</div></div>
      <button class="icon-btn close" type="button" aria-label="Свернуть чат">${ICON_CLOSE}</button>
    </header>
    <div class="banner" role="status" hidden>Нет соединения. Переподключаемся…</div>
    <div class="messages" role="log" aria-live="polite"></div>
    <form class="composer">
      <textarea class="input" rows="1" placeholder="Задать вопрос…" aria-label="Сообщение"></textarea>
      <button class="send" type="submit" aria-label="Отправить" disabled>${ICON_SEND}</button>
    </form>
  </section>
  <button class="launcher" type="button" aria-label="Открыть чат" aria-expanded="false">
    <span class="ic-chat">${ICON_BUBBLE}</span><span class="ic-close">${ICON_CHEVRON}</span>
    <span class="badge" hidden></span>
  </button>
</div>`

	const $ = sel => root.querySelector(sel)
	const rootEl = $('.root')
	const launcher = $('.launcher')
	const badge = $('.badge')
	const toast = $('.toast')
	const panel = $('.panel')
	const closeBtn = $('.close')
	const banner = $('.banner')
	const messagesEl = $('.messages')
	const form = $('.composer')
	const input = $('.input')
	const sendBtn = $('.send')
	$('.title').textContent = TITLE

	// --- состояние ------------------------------------------------------------
	let token = localStorage.getItem('widget_token')
	let ws = null
	let starting = false
	let reconnectDelay = 1000
	let isOpen = false
	let oldestId = null
	let maxId = 0
	let hasMore = false
	let unread = 0
	let toastTimer
	let lastSeenId = Number(localStorage.getItem('widget_last_seen')) || 0
	const renderedIds = new Set()
	let sendSeq = 0

	const timeFmt = new Intl.DateTimeFormat('ru-RU', {
		hour: '2-digit',
		minute: '2-digit'
	})
	const isAgent = sender => sender === 'admin' || sender === 'bot'

	// --- сообщения ------------------------------------------------------------
	const greeting = document.createElement('div')
	greeting.className = 'row agent'
	greeting.innerHTML = '<div class="bubble">Привет! 👋 Чем мы можем помочь?</div>'
	function updateGreeting() {
		// приветствие — только локальная заглушка, пока в беседе нет сообщений
		if (renderedIds.size === 0 && !messagesEl.querySelector('.row.visitor')) {
			if (!greeting.isConnected) messagesEl.appendChild(greeting)
		} else {
			greeting.remove()
		}
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

	// message: { id?, sender, text, createdAt? }
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
			bubble.textContent = m.text
			const meta = document.createElement('div')
			meta.className = 'meta'
			const time = timeFmt.format(m.createdAt ? new Date(m.createdAt) : new Date())
			meta.textContent = mine ? time : `${AGENT} · ${time}`
			row.append(bubble, meta)
		}
		if (prepend) {
			// старые сообщения идут сразу под кнопкой «Загрузить ещё»
			messagesEl.insertBefore(
				row,
				loadMoreBtn.isConnected ? loadMoreBtn.nextSibling : messagesEl.firstChild
			)
		} else {
			messagesEl.appendChild(row)
			messagesEl.scrollTop = messagesEl.scrollHeight
		}
		if (m.id) {
			renderedIds.add(m.id)
			maxId = Math.max(maxId, m.id)
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
	}
	function hideToast() {
		clearTimeout(toastTimer)
		toast.hidden = true
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
			if (msg.type === 'error') return markFailed(msg.clientId, msg.error)
			if (!msg.sender || renderedIds.has(msg.id)) return
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
			hideToast()
			markSeen()
			messagesEl.scrollTop = messagesEl.scrollHeight
			// на сенсорных экранах не открываем клавиатуру сама по себе
			if (window.matchMedia('(hover: hover)').matches) input.focus()
		}
	}
	async function openChat() {
		setOpen(true)
		await start()
	}
	function closeChat() {
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
		if (!text) return
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			// нет соединения: не теряем текст, баннер уже объясняет причину
			banner.hidden = false
			return
		}
		const clientId = `${Date.now().toString(36)}-${++sendSeq}`
		trackPending(renderMessage({ sender: 'visitor', text }), clientId)
		ws.send(JSON.stringify({ text, clientId }))
		input.value = ''
		autosize()
	}

	form.addEventListener('submit', e => {
		e.preventDefault()
		sendMessage()
		input.focus()
	})
	input.addEventListener('input', autosize)
	input.addEventListener('keydown', e => {
		// Enter — отправить, Shift+Enter — новая строка; не мешаем IME-вводу
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault()
			sendMessage()
		}
	})
	root.addEventListener('keydown', e => {
		if (e.key === 'Escape' && isOpen) closeChat()
	})
	launcher.addEventListener('click', () => (isOpen ? closeChat() : openChat()))
	closeBtn.addEventListener('click', closeChat)
	toast.addEventListener('click', openChat)
	loadMoreBtn.addEventListener('click', loadOlder)

	function mount() {
		document.body.appendChild(host)
		// вернувшийся посетитель: подключаемся в фоне, чтобы работали бейдж и превью.
		// Новым посетителям сессию не создаём, пока они не откроют чат.
		if (token) start()
	}
	if (document.body) mount()
	else document.addEventListener('DOMContentLoaded', mount)
})()
