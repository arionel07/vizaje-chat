import { API_URL } from './config'

export class UnauthorizedError extends Error {
	constructor() {
		super('Unauthorized')
	}
}

// токен протух или невалиден — сбрасываем и выкидываем на логин-форму
function handleUnauthorized(res: Response) {
	if (res.status !== 401) return
	localStorage.removeItem('admin_token')
	window.location.reload()
	throw new UnauthorizedError()
}

// не-2xx ответ (кроме 401, он обрабатывается отдельно) — ошибка, а не «данные»
function assertOk(res: Response) {
	if (!res.ok) throw new Error(`Request failed: ${res.status}`)
}

// ошибка входа с HTTP-статусом: 401 — неверные данные, 429 — слишком много попыток
export class LoginError extends Error {
	status: number
	constructor(status: number) {
		super(`Login failed: ${status}`)
		this.status = status
	}
}

export async function login(email: string, password: string) {
	const res = await fetch(`${API_URL}/admin/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})
	if (!res.ok) throw new LoginError(res.status)
	return res.json() as Promise<{ token: string }>
}
export type Conversation = {
	id: number
	sessionId: string
	status: 'open' | 'closed'
	createdAt: string
	lastMessageText: string | null
	lastMessageSender: string | null
	lastMessageAt: string | null
	unreadCount: number
}

export const CONVERSATIONS_PAGE_SIZE = 30

export async function fetchConversations(
	token: string,
	{ limit = CONVERSATIONS_PAGE_SIZE, offset = 0 } = {}
) {
	const params = new URLSearchParams({
		limit: String(limit),
		offset: String(offset)
	})
	const res = await fetch(`${API_URL}/admin/conversations?${params}`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	assertOk(res)
	return res.json() as Promise<Conversation[]>
}

// проверяет, что токен ещё действителен; при 401 — выход на логин.
// Сетевые ошибки (сервер недоступен) пробрасываются как есть
export async function checkSession(token: string) {
	const res = await fetch(`${API_URL}/admin/auth/me`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
}

export async function markRead(token: string, conversationId: number) {
	const res = await fetch(
		`${API_URL}/admin/conversations/${conversationId}/read`,
		{ method: 'POST', headers: { Authorization: `Bearer ${token}` } }
	)
	handleUnauthorized(res)
}

export const MESSAGES_PAGE_SIZE = 50

// before — id самого старого загруженного сообщения (подгрузка более ранних)
export async function fetchMessages(
	token: string,
	conversationId: number,
	before?: number
) {
	const params = new URLSearchParams({ limit: String(MESSAGES_PAGE_SIZE) })
	if (before) params.set('before', String(before))
	const res = await fetch(
		`${API_URL}/admin/conversations/${conversationId}/messages?${params}`,
		{
			headers: { Authorization: `Bearer ${token}` }
		}
	)
	handleUnauthorized(res)
	assertOk(res)
	return res.json() as Promise<
		Array<{ id: number; sender: string; text: string; createdAt: string }>
	>
}

export async function updateStatus(
	token: string,
	conversationId: number,
	status: 'open' | 'closed'
) {
	const res = await fetch(
		`${API_URL}/admin/conversations/${conversationId}/status`,
		{
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({ status })
		}
	)
	handleUnauthorized(res)
	return res.json()
}
