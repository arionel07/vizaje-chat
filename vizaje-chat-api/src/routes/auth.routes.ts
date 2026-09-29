import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { login } from '../auth/service'
import { getClientIp } from '../chat/client-ip'
import { allowLoginAttempt } from '../chat/rate-limit'

export const authRoutes = new Elysia()
	.post(
		'/admin/auth/login',
		async ({ body, set, request, server }) => {
			if (!allowLoginAttempt(getClientIp({ request, server }))) {
				set.status = 429
				return { error: 'Too many attempts, try again later' }
			}
			const result = await login(body.email, body.password)
			if (!result) {
				set.status = 401
				return { error: 'Invalid credentials' }
			}
			return result
		},
		{
			body: t.Object({ email: t.String(), password: t.String() })
		}
	)
	.get('/admin/auth/me', ({ headers, set }) => {
		const payload = verifyToken(headers.authorization)
		if (!payload) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return { email: payload.email }
	})
