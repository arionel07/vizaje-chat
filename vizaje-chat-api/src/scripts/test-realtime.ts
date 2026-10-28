const API_URL = 'http://localhost:3001'
const WS_URL = 'ws://localhost:3001/ws'

// учётные данные админа (созданного через create-admin.ts) — из окружения, не из кода:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... bun run src/scripts/test-realtime.ts
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
	console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env variables')
	process.exit(1)
}

async function main() {
	// 1. Создаём widget-сессию (посетитель)
	const sessionRes = await fetch(`${API_URL}/widget/session`, {
		method: 'POST'
	})
	const { token: visitorToken, conversationId } = (await sessionRes.json()) as {
		token: string
		conversationId: number
	}
	console.log('✅ visitor session created, conversationId:', conversationId)

	// 2. Логинимся как админ
	const loginRes = await fetch(`${API_URL}/admin/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD
		})
	})
	const { token: adminToken } = (await loginRes.json()) as {
		token: string
	}
	console.log('✅ admin logged in')

	// 3. Коннектим оба сокета
	const visitorWs = new WebSocket(`${WS_URL}?token=${visitorToken}`)
	const adminWs = new WebSocket(`${WS_URL}?token=${adminToken}`)

	visitorWs.onopen = () => console.log('🔌 visitor ws open')
	adminWs.onopen = () => console.log('🔌 admin ws open')

	visitorWs.onmessage = e => console.log('📩 VISITOR received:', e.data)
	adminWs.onmessage = e => console.log('📩 ADMIN received:', e.data)

	visitorWs.onerror = e => console.log('❌ visitor ws error', e)
	adminWs.onerror = e => console.log('❌ admin ws error', e)

	// ждём, пока оба откроются
	await new Promise(resolve => setTimeout(resolve, 1000))

	// 4. Админ пишет — визитор должен получить сразу
	console.log('--- admin sends message ---')
	adminWs.send(JSON.stringify({ conversationId, text: 'Привет от админа' }))

	await new Promise(resolve => setTimeout(resolve, 1000))

	// 5. Визитор пишет — админ должен получить сразу
	console.log('--- visitor sends message ---')
	visitorWs.send(JSON.stringify({ text: 'Привет от визитора' }))

	await new Promise(resolve => setTimeout(resolve, 1000))

	console.log('done, closing')
	visitorWs.close()
	adminWs.close()
	process.exit(0)
}

main()
