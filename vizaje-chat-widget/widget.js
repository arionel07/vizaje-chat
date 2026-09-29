;(function () {
	const script = document.currentScript
	const API_URL = (
		script?.dataset.api || 'http://localhost:3001'
	).replace(/\/$/, '')
	const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws'

	const host = document.createElement('div')
	host.id = 'vizaje-chat-host'
	document.body.appendChild(host)
	const root = host.attachShadow({ mode: 'open' })

	root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, sans-serif; }
  #chat-bubble { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%; background: #111; color: #fff; border: none; font-size: 24px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.2); }
  #chat-panel { position: fixed; bottom: 96px; right: 24px; width: 360px; height: 520px; max-width: calc(100vw - 48px); background: #fff; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.15); display: none; flex-direction: column; overflow: hidden; }
  #chat-panel.open { display: flex; }
  #chat-header { padding: 16px; background: #111; color: #fff; display: flex; justify-content: space-between; align-items: center; }
  #chat-close { background: none; border: none; color: #fff; opacity: .8; cursor: pointer; font-size: 16px; }
  #chat-messages { flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .msg { max-width: 80%; padding: 10px 14px; border-radius: 14px; font-size: 14px; }
  .msg.visitor { align-self: flex-end; background: #111; color: #fff; }
  .msg.admin, .msg.bot { align-self: flex-start; background: #f1f1f1; color: #111; }
  .msg.system { align-self: center; background: none; color: #888; font-size: 12px; }
  #chat-input-row { display: flex; padding: 12px; border-top: 1px solid #eee; gap: 8px; }
  #chat-input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 10px 14px; font-size: 14px; outline: none; }
  #chat-send { width: 36px; height: 36px; border-radius: 50%; background: #111; color: #fff; border: none; cursor: pointer; }
</style>
<button id="chat-bubble" aria-label="Открыть чат">💬</button>
<div id="chat-panel" role="dialog" aria-label="Поддержка Vizaje-Nica">
  <div id="chat-header">
    <span>Поддержка Vizaje-Nica</span>
    <button id="chat-close" aria-label="Закрыть чат">✕</button>
  </div>
  <div id="chat-messages"></div>
  <div id="chat-input-row">
    <input id="chat-input" placeholder="Ваше сообщение..." aria-label="Сообщение">
    <button id="chat-send" aria-label="Отправить">↑</button>
  </div>
</div>`

	const $ = id => root.getElementById(id)
	const bubble = $('chat-bubble')
	const panel = $('chat-panel')
	const closeBtn = $('chat-close')
	const messagesEl = $('chat-messages')
	const input = $('chat-input')
	const sendBtn = $('chat-send')

	let token = localStorage.getItem('widget_token')
	let ws = null
	let starting = false
	let reconnectDelay = 1000

	function renderMessage(sender, text) {
		const div = document.createElement('div')
		div.className = `msg ${sender}`
		div.textContent = text
		messagesEl.appendChild(div)
		messagesEl.scrollTop = messagesEl.scrollHeight
	}

	function resetSession() {
		token = null
		localStorage.removeItem('widget_token')
	}

	async function ensureSession() {
		if (token) return token
		const res = await fetch(`${API_URL}/widget/session`, { method: 'POST' })
		const data = await res.json()
		token = data.token
		localStorage.setItem('widget_token', token)
		return token
	}

	async function loadHistory() {
		const res = await fetch(`${API_URL}/widget/messages`, {
			headers: { Authorization: `Bearer ${token}` }
		})
		if (res.status === 401) {
			// токен протух или не признан сервером — начинаем новую сессию
			resetSession()
			await ensureSession()
			return loadHistory()
		}
		const messages = await res.json()
		messagesEl.textContent = ''
		messages.forEach(m => renderMessage(m.sender, m.text))
	}

	function scheduleRestart() {
		setTimeout(start, reconnectDelay)
		reconnectDelay = Math.min(reconnectDelay * 2, 15000)
	}

	function connectWs() {
		ws = new WebSocket(`${WS_URL}?token=${token}`)
		ws.onopen = () => {
			reconnectDelay = 1000
		}
		ws.onmessage = event => {
			const msg = JSON.parse(event.data)
			if (!msg.sender) return // служебные сообщения (например, ошибки)
			renderMessage(msg.sender, msg.text)
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

	async function openChat() {
		panel.classList.add('open')
		await start()
	}

	function sendMessage() {
		const text = input.value.trim()
		if (!text || !ws || ws.readyState !== WebSocket.OPEN) return
		renderMessage('visitor', text)
		ws.send(JSON.stringify({ text }))
		input.value = ''
	}

	bubble.addEventListener('click', openChat)
	closeBtn.addEventListener('click', () => panel.classList.remove('open'))
	sendBtn.addEventListener('click', sendMessage)
	input.addEventListener('keydown', e => {
		if (e.key === 'Enter' && !e.isComposing) sendMessage()
	})
})()
