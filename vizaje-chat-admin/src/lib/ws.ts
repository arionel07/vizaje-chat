import { WS_URL } from './config'

export function connectAdminWs(token: string, onMessage: (msg: any) => void) {
	const ws = new WebSocket(`${WS_URL}?token=${token}`)
	ws.onmessage = event => onMessage(JSON.parse(event.data))
	return ws
}
