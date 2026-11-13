import { TRUST_PROXY } from '../config'

type Ctx = {
	request: Request
	server: { requestIP(req: Request): { address: string } | null } | null
}

export function getClientIp({ request, server }: Ctx): string {
	if (TRUST_PROXY) {
		const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
		if (forwarded) return forwarded
	}
	return server?.requestIP(request)?.address ?? 'unknown'
}
