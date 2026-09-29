import { useCallback, useEffect, useRef, useState } from 'react'
import {
	fetchMessages,
	markRead,
	MESSAGES_PAGE_SIZE,
	updateStatus
} from '../lib/api'
import { connectAdminWs, type AdminWs } from '../lib/ws'

type Message = {
	id: number
	conversationId?: number
	sender: string
	text: string
	createdAt: string
}

export function ChatWindow({
	token,
	conversationId,
	onActivity
}: {
	token: string
	conversationId: number
	onActivity?: () => void // сообщение отправлено или беседа прочитана — обновить список
}) {
	const [messages, setMessages] = useState<Message[]>([])
	const [input, setInput] = useState('')
	const wsRef = useRef<AdminWs | null>(null)
	const [status, setStatus] = useState<'open' | 'closed'>('open')
	const [hasMore, setHasMore] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const listRef = useRef<HTMLDivElement | null>(null)

	// onActivity — новая функция на каждый рендер App; держим свежую в ref,
	// чтобы не переподключать WS и не перезапускать эффекты
	const onActivityRef = useRef(onActivity)
	useEffect(() => {
		onActivityRef.current = onActivity
	}, [onActivity])

	// помечает беседу прочитанной и просит обновить список; сбой сети не критичен
	const syncRead = useCallback(() => {
		markRead(token, conversationId)
			.then(() => onActivityRef.current?.())
			.catch(() => {})
	}, [token, conversationId])

	// беседа открыта — считаем прочитанной
	useEffect(() => {
		syncRead()
	}, [syncRead])

	// последняя страница истории; заменяет показанные сообщения
	const applyLatest = useCallback((page: Message[]) => {
		setMessages(page)
		setHasMore(page.length === MESSAGES_PAGE_SIZE)
	}, [])

	const loadLatest = useCallback(
		() => fetchMessages(token, conversationId).then(applyLatest),
		[token, conversationId, applyLatest]
	)

	useEffect(() => {
		fetchMessages(token, conversationId).then(applyLatest).catch(() => {})
	}, [token, conversationId, applyLatest])

	async function loadOlder() {
		// самое старое сообщение — первое; оптимистичные (Date.now()) добавляются в конец
		const oldest = messages[0]
		if (!oldest || loadingMore) return
		setLoadingMore(true)
		try {
			const older = await fetchMessages(token, conversationId, oldest.id)
			const list = listRef.current
			const prevHeight = list?.scrollHeight ?? 0
			setMessages(prev => [...older, ...prev])
			setHasMore(older.length === MESSAGES_PAGE_SIZE)
			// после рендера сохраняем позицию прокрутки, чтобы список не «прыгал»
			requestAnimationFrame(() => {
				if (list) list.scrollTop += list.scrollHeight - prevHeight
			})
		} finally {
			setLoadingMore(false)
		}
	}

	useEffect(() => {
		const ws = connectAdminWs(
			token,
			(msg: Message) => {
				if (msg.conversationId === conversationId) {
					setMessages(prev => [...prev, msg])
					// открытая беседа: новое сообщение посетителя сразу считаем прочитанным
					if (msg.sender === 'visitor') {
						syncRead()
					}
				}
			},
			// после обрыва могли быть пропущены сообщения — подтягиваем историю заново
			() => {
				loadLatest().catch(() => {})
				syncRead()
			}
		)
		wsRef.current = ws
		return () => ws.close()
	}, [token, conversationId, loadLatest, syncRead])

	function sendMessage() {
		const text = input.trim()
		if (!text || !wsRef.current) return
		// нет соединения — не теряем текст и не рисуем «отправленное» сообщение
		if (!wsRef.current.send(JSON.stringify({ conversationId, text }))) return
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
		onActivityRef.current?.()
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
			<div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
				{hasMore && (
					<div style={{ textAlign: 'center', marginBottom: 8 }}>
						<button onClick={loadOlder} disabled={loadingMore}>
							{loadingMore ? 'Загрузка...' : 'Загрузить ещё'}
						</button>
					</div>
				)}
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
