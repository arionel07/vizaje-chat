import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import {
	createCannedResponse,
	deleteCannedResponse,
	listCannedResponses,
	updateCannedResponse
} from '../canned-responses/service'

const createBody = t.Object({
	title: t.String(),
	textRu: t.String(),
	textRo: t.String()
})

const updateBody = t.Object({
	title: t.Optional(t.String()),
	textRu: t.Optional(t.String()),
	textRo: t.Optional(t.String())
})

export const cannedResponsesRoutes = new Elysia()
	.get('/admin/canned-responses', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return listCannedResponses()
	})
	.post(
		'/admin/canned-responses',
		async ({ headers, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				set.status = 201
				return await createCannedResponse(body)
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid canned response' }
			}
		},
		{ body: createBody }
	)
	.patch(
		'/admin/canned-responses/:id',
		async ({ headers, params, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				const updated = await updateCannedResponse(Number(params.id), body)
				if (!updated) {
					set.status = 404
					return { error: 'Canned response not found' }
				}
				return updated
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid canned response' }
			}
		},
		{ body: updateBody }
	)
	.delete('/admin/canned-responses/:id', async ({ headers, params, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const deleted = await deleteCannedResponse(Number(params.id))
		if (!deleted) {
			set.status = 404
			return { error: 'Canned response not found' }
		}
		return { ok: true }
	})
