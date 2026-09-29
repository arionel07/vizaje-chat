import { useEffect, useRef, useState } from 'react'
import { fetchMessages, updateStatus } from '../lib/api'
import { connectAdminWs } from '../lib/ws'

type Message = {
	id: number
	conversationId?: number
	sender: string
	text: string
	createdAt: string
}

export function ChatWindow({
	token,
	conversationId
}: {
	token: string
	conversationId: number
}) {
	const [messages, setMessages] = useState<Message[]>([])
	const [input, setInput] = useState('')
	const wsRef = useRef<WebSocket | null>(null)
	const [status, setStatus] = useState<'open' | 'closed'>('open')

	useEffect(() => {
		fetchMessages(token, conversationId).then(setMessages)
	}, [conversationId, token])

	useEffect(() => {
		const ws = connectAdminWs(token, (msg: Message) => {
			if (msg.conversationId === conversationId) {
				setMessages(prev => [...prev, msg])
			}
		})
		wsRef.current = ws
		return () => ws.close()
	}, [token, conversationId])

	function sendMessage() {
		const text = input.trim()
		if (!text || !wsRef.current) return
		wsRef.current.send(JSON.stringify({ conversationId, text }))
		setMessages(prev => [
			...prev,
			{
				id: Date.now(),
				sender: 'admin',
				text,
				createdAt: new Date().toISOString()
			}
		]) // optimistic
		setInput('')
	}

	async function toggleStatus() {
		const newStatus = status === 'open' ? 'closed' : 'open'
		await updateStatus(token, conversationId, newStatus)
		setStatus(newStatus)
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			<div
				style={{
					padding: 12,
					borderBottom: '1px solid #eee',
					display: 'flex',
					justifyContent: 'space-between'
				}}
			>
				<span>Беседа #{conversationId}</span>
				<button onClick={toggleStatus}>
					{status === 'open' ? 'Закрыть беседу' : 'Открыть заново'}
				</button>
			</div>
			<div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
				{messages.map(m =>
					m.sender === 'system' ? (
						<div
							key={m.id}
							style={{
								textAlign: 'center',
								color: '#888',
								fontSize: 12,
								margin: '12px 0'
							}}
						>
							{m.text}
						</div>
					) : (
						<div
							key={m.id}
							style={{
								textAlign: m.sender === 'admin' ? 'right' : 'left',
								margin: '8px 0'
							}}
						>
							<span
								style={{
									display: 'inline-block',
									padding: '8px 12px',
									borderRadius: 12,
									background: m.sender === 'admin' ? '#111' : '#f1f1f1',
									color: m.sender === 'admin' ? '#fff' : '#111'
								}}
							>
								{m.text}
							</span>
						</div>
					)
				)}
			</div>
			{status === 'closed' && (
				<div
					style={{
						textAlign: 'center',
						color: '#888',
						fontSize: 12,
						margin: '12px 0'
					}}
				>
					Беседа закрыта
				</div>
			)}
			<div
				style={{
					display: 'flex',
					padding: 12,
					borderTop: '1px solid #eee',
					gap: 8
				}}
			>
				<input
					value={input}
					onChange={e => setInput(e.target.value)}
					onKeyDown={e => e.key === 'Enter' && sendMessage()}
					placeholder="Ответ..."
					style={{ flex: 1 }}
				/>
				<button onClick={sendMessage}>Отправить</button>
			</div>
		</div>
	)
}
