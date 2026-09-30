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
	visitorLastReadAt: string | null // когда посетитель видел сообщения — для «Прочитано»
	assigneeId: number | null
	assigneeEmail: string | null
	lastMessageText: string | null
	lastMessageSender: string | null
	lastMessageAt: string | null
	unreadCount: number
}

export type Operator = { id: number; email: string }

export const CONVERSATIONS_PAGE_SIZE = 30

export type ConversationFilter = 'all' | 'mine' | 'open' | 'closed' | 'unread'

export type ConversationCounts = {
	open: number
	closed: number
	unread: number
	mine: number
}

export async function fetchConversations(
	token: string,
	{
		limit = CONVERSATIONS_PAGE_SIZE,
		offset = 0,
		filter = 'all',
		q
	}: {
		limit?: number
		offset?: number
		filter?: ConversationFilter
		q?: string // поиск по тексту сообщений (вся история) и sessionId
	} = {}
) {
	const params = new URLSearchParams({
		limit: String(limit),
		offset: String(offset)
	})
	if (filter === 'open' || filter === 'closed') params.set('status', filter)
	if (filter === 'unread') params.set('unread', 'true')
	if (filter === 'mine') params.set('assignee', 'me')
	if (q?.trim()) params.set('q', q.trim())
	const res = await fetch(`${API_URL}/admin/conversations?${params}`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	assertOk(res)
	return res.json() as Promise<Conversation[]>
}

export async function fetchCounts(token: string) {
	const res = await fetch(`${API_URL}/admin/conversations/counts`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	assertOk(res)
	return res.json() as Promise<ConversationCounts>
}

export async function fetchOperators(token: string) {
	const res = await fetch(`${API_URL}/admin/operators`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	assertOk(res)
	return res.json() as Promise<Operator[]>
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

export async function updateAssignee(
	token: string,
	conversationId: number,
	assigneeId: number | null
) {
	const res = await fetch(
		`${API_URL}/admin/conversations/${conversationId}/assignee`,
		{
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({ assigneeId })
		}
	)
	handleUnauthorized(res)
	assertOk(res)
	return res.json() as Promise<{ assigneeId: number | null; assigneeEmail: string | null }>
}

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type DaySchedule = { enabled: boolean; start: string; end: string } // start/end — "HH:MM"
export type Schedule = { timezone: string; days: Record<DayKey, DaySchedule> }

export async function fetchSchedule(token: string) {
	const res = await fetch(`${API_URL}/admin/settings/schedule`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	assertOk(res)
	return res.json() as Promise<Schedule>
}

// сервер сам проверяет формат времени и что начало раньше конца — при ошибке
// (422) кидает Error с текстом для показа в форме
export async function updateSchedule(token: string, days: Schedule['days']) {
	const res = await fetch(`${API_URL}/admin/settings/schedule`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ days })
	})
	handleUnauthorized(res)
	if (!res.ok) {
		const body = await res.json().catch(() => null)
		throw new Error(body?.error || `Request failed: ${res.status}`)
	}
	return res.json() as Promise<Schedule>
}

export type CannedResponse = {
	id: number
	title: string
	textRu: string
	textRo: string
	createdAt: string
}
export type CannedResponseInput = { title: string; textRu: string; textRo: string }

// сервер отдаёт текст ошибки (пустое поле и т.п.) — пробрасываем как Error для формы
async function parseOrThrow<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const body = await res.json().catch(() => null)
		throw new Error(body?.error || `Request failed: ${res.status}`)
	}
	return res.json() as Promise<T>
}

export async function fetchCannedResponses(token: string) {
	const res = await fetch(`${API_URL}/admin/canned-responses`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	return parseOrThrow<CannedResponse[]>(res)
}

export async function createCannedResponse(token: string, input: CannedResponseInput) {
	const res = await fetch(`${API_URL}/admin/canned-responses`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(input)
	})
	handleUnauthorized(res)
	return parseOrThrow<CannedResponse>(res)
}

export async function updateCannedResponse(
	token: string,
	id: number,
	input: Partial<CannedResponseInput>
) {
	const res = await fetch(`${API_URL}/admin/canned-responses/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify(input)
	})
	handleUnauthorized(res)
	return parseOrThrow<CannedResponse>(res)
}

export async function deleteCannedResponse(token: string, id: number) {
	const res = await fetch(`${API_URL}/admin/canned-responses/${id}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	await parseOrThrow<{ ok: true }>(res)
}
