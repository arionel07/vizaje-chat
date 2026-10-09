import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { registerPushToken } from '../push-tokens/service'

export const pushTokensRoutes = new Elysia().post(
	'/admin/push-tokens',
	async ({ headers, body, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		await registerPushToken(admin.sub, body.token, body.platform)
		return { ok: true }
	},
	{
		body: t.Object({
			token: t.String(),
			platform: t.Union([t.Literal('ios'), t.Literal('android')])
		})
	}
)
