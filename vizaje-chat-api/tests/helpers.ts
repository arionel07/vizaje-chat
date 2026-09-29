import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app'
import { createAdmin } from '../src/auth/service'
import { setPublisher } from '../src/chat/events'
import { resetRateLimits } from '../src/chat/rate-limit'
import { db } from '../src/db/client'
import { createSession } from '../src/widget/service'

export const ADMIN_EMAIL = 'admin@test.io'
export const ADMIN_PASSWORD = 'correct-password'

// один сервер на все тесты (файлы выполняются в одном процессе)
let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined

function getServer() {
	if (!server) {
		server = createApp().listen(0)
		setPublisher((room, payload) => server?.server?.publish(room, payload))
	}
	return server
}

export const baseUrl = () => `http://localhost:${getServer().server?.port}`
export const wsUrl = () => `ws://localhost:${getServer().server?.port}/ws`

export async function resetDb() {
	// id бесед после truncate начинаются с 1 — счётчики лимитов тоже обнуляем
	resetRateLimits()
	await db.execute(
		sql`truncate messages, conversations, admin_users restart identity cascade`
	)
}

// админ в БД + его токен (без /login, чтобы не упираться в rate-limit входа)
export async function makeAdmin(email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
	const [admin] = await createAdmin(email, password)
	if (!admin) throw new Error('admin was not created')
	const token = jwt.sign(
		{ type: 'admin', sub: admin.id, email },
		process.env.JWT_SECRET!,
		{ expiresIn: '1h' }
	)
	return { admin, token }
}

// посетитель через сервисную функцию (эндпоинт ограничен rate-limit по IP)
export function makeVisitor() {
	return createSession()
}

export async function api(
	path: string,
	{
		method = 'GET',
		token,
		body
	}: { method?: string; token?: string; body?: unknown } = {}
) {
	const res = await fetch(baseUrl() + path, {
		method,
		headers: {
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(body !== undefined ? { 'content-type': 'application/json' } : {})
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	})
	let json: any
	try {
		json = await res.json()
	} catch {
		json = undefined
	}
	return { status: res.status, body: json }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// WS-клиент: копит сообщения, умеет ждать нужное
export async function connectWs(token: string) {
	const ws = new WebSocket(`${wsUrl()}?token=${token}`)
	const messages: any[] = []
	let closed = false
	ws.onmessage = e => messages.push(JSON.parse(e.data as string))
	ws.onclose = () => (closed = true)
	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve()
		ws.onerror = () => reject(new Error('ws error'))
	})
	return {
		ws,
		messages,
		isClosed: () => closed,
		send: (data: unknown) =>
			ws.send(typeof data === 'string' ? data : JSON.stringify(data)),
		async waitFor(pred: (m: any) => boolean, ms = 2000) {
			const start = Date.now()
			while (Date.now() - start < ms) {
				const found = messages.find(pred)
				if (found) return found
				await sleep(25)
			}
			throw new Error(
				`WS: сообщение не пришло за ${ms} мс. Получено: ${JSON.stringify(messages)}`
			)
		},
		close: () => ws.close()
	}
}
