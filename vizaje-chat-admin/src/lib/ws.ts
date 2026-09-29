export function connectAdminWs(token: string, onMessage: (msg: any) => void) {
	const ws = new WebSocket(`ws://localhost:3001/ws?token=${token}`)
	ws.onmessage = event => onMessage(JSON.parse(event.data))
	return ws
}
