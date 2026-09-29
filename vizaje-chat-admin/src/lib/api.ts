import { API_URL } from './config'

// токен протух или невалиден — сбрасываем и выкидываем на логин-форму
function handleUnauthorized(res: Response) {
	if (res.status !== 401) return
	localStorage.removeItem('admin_token')
	window.location.reload()
	throw new Error('Unauthorized')
}

export async function login(email: string, password: string) {
	const res = await fetch(`${API_URL}/admin/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	})
	if (!res.ok) throw new Error('Invalid credentials')
	return res.json() as Promise<{ token: string }>
}
export async function fetchConversations(token: string) {
	const res = await fetch(`${API_URL}/admin/conversations`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	handleUnauthorized(res)
	return res.json()
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
