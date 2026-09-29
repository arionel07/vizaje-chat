import { Elysia, t } from 'elysia'
import { getClientIp } from '../chat/client-ip'
import { allowSessionCreate, allowVisitorMessage } from '../chat/rate-limit'
import { addMessage, getMessages } from '../chat/service'
import { createSession, verifySessionToken } from '../widget/service'

export const widgetRoutes = new Elysia()
	.post('/widget/session', async ({ set, request, server }) => {
		if (!allowSessionCreate(getClientIp({ request, server }))) {
			set.status = 429
			return { error: 'Too many sessions, try again later' }
		}
		return createSession()
	})
	.post(
		'/widget/messages',
		async ({ headers, body, set }) => {
			const session = verifySessionToken(headers.authorization)
			if (!session) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			if (!allowVisitorMessage(session.conversationId)) {
				set.status = 429
				return { error: 'Too many messages' }
			}
			return addMessage(session.conversationId, 'visitor', body.text)
		},
		{
			body: t.Object({ text: t.String() })
		}
	)
	.get('/widget/messages', async ({ headers, set }) => {
		const session = verifySessionToken(headers.authorization)
		if (!session) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return getMessages(session.conversationId)
	})
