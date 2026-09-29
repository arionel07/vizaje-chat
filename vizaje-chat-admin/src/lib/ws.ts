import { checkSession, UnauthorizedError } from './api'
import { WS_URL } from './config'

export type AdminWs = {
	// false — соединения сейчас нет, сообщение не отправлено
	send(data: string): boolean
	close(): void
}

const MAX_DELAY = 15000

// WS с автопереподключением. onReconnect вызывается после восстановления
// соединения: за время обрыва сообщения могли быть пропущены — перезагрузите данные
export function connectAdminWs(
	token: string,
	onMessage: (msg: any) => void,
	onReconnect?: () => void
): AdminWs {
	let ws: WebSocket | null = null
	let closed = false
	let everClosed = false
	let delay = 1000
	let timer: ReturnType<typeof setTimeout> | undefined

	function connect() {
		ws = new WebSocket(`${WS_URL}?token=${token}`)
		ws.onopen = () => {
			delay = 1000
			if (everClosed) onReconnect?.()
		}
		ws.onmessage = event => {
			let msg: unknown
			try {
				msg = JSON.parse(event.data)
			} catch {
				return // не JSON — игнорируем
			}
			if (typeof msg !== 'object' || msg === null) return
			if ((msg as { type?: string }).type === 'error') return // ответ сервера об ошибке
			onMessage(msg)
		}
		ws.onclose = () => {
			ws = null
			if (closed) return
			everClosed = true
			timer = setTimeout(async () => {
				// сервер закрывает сокет и при протухшем токене: если токен не
				// действителен, checkSession выкинет на логин, а не будет переподключаться вечно
				try {
					await checkSession(token)
				} catch (e) {
					if (e instanceof UnauthorizedError) return
					// сервер недоступен — пробуем подключиться, сработает следующий backoff
				}
				if (!closed) connect()
			}, delay)
			delay = Math.min(delay * 2, MAX_DELAY)
		}
	}

	connect()

	return {
		send(data) {
			if (ws?.readyState !== WebSocket.OPEN) return false
			ws.send(data)
			return true
		},
		close() {
			closed = true
			clearTimeout(timer)
			ws?.close()
		}
	}
}
