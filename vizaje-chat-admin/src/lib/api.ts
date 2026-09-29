const API_URL = 'http://localhost:3001'

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
	if (res.status === 401) {
		localStorage.removeItem('admin_token')
		window.location.reload() // выкинет на логин-форму
		throw new Error('Unauthorized')
	}
	return res.json()
}

export async function fetchMessages(token: string, conversationId: number) {
	const res = await fetch(
		`${API_URL}/admin/conversations/${conversationId}/messages`,
		{
			headers: { Authorization: `Bearer ${token}` }
		}
	)
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
	return res.json()
}
