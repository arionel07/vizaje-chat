import { Elysia, t } from 'elysia'
import { getClientIp } from '../chat/client-ip'
import { publishMessage } from '../chat/events'
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
			const msg = await addMessage(session.conversationId, 'visitor', body.text)
			publishMessage(session.conversationId, msg)
			return msg
		},
		{
			body: t.Object({ text: t.String() })
		}
	)
	.get(
		'/widget/messages',
		async ({ headers, query, set }) => {
			const session = verifySessionToken(headers.authorization)
			if (!session) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			return getMessages(session.conversationId, query)
		},
		{
			query: t.Object({
				limit: t.Optional(t.Numeric()),
				before: t.Optional(t.Numeric())
			})
		}
	)
