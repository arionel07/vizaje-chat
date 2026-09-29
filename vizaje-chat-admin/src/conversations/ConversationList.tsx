import { useCallback, useEffect, useRef, useState } from 'react'
import {
	CONVERSATIONS_PAGE_SIZE,
	fetchConversations,
	type Conversation
} from '../lib/api'
import { connectAdminWs } from '../lib/ws'

const MAX_RELOAD = 100 // максимум, который отдаёт API за один запрос

export function ConversationList({
	token,
	onSelect,
	selectedId,
	refreshKey
}: {
	token: string
	onSelect: (id: number) => void
	selectedId: number | null
	refreshKey: number
}) {
	const [conversations, setConversations] = useState<Conversation[]>([])
	const [hasMore, setHasMore] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const countRef = useRef(0)
	const requestRef = useRef(0)
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	// перезагружает уже показанные беседы; устаревшие ответы игнорируются
	const reload = useCallback(async () => {
		const requestId = ++requestRef.current
		const limit = Math.min(
			Math.max(countRef.current, CONVERSATIONS_PAGE_SIZE),
			MAX_RELOAD
		)
		const page = await fetchConversations(token, { limit })
		if (requestId !== requestRef.current) return
		countRef.current = page.length
		setConversations(page)
		setHasMore(page.length === limit)
	}, [token])

	// несколько событий подряд (или отправка своего сообщения) — одна перезагрузка
	const scheduleReload = useCallback(() => {
		clearTimeout(timerRef.current)
		timerRef.current = setTimeout(() => reload().catch(() => {}), 250)
	}, [reload])

	useEffect(() => {
		reload().catch(() => {})
	}, [reload, refreshKey])

	// любое новое сообщение (admin:global) обновляет превью и счётчики
	useEffect(() => {
		const ws = connectAdminWs(token, scheduleReload, scheduleReload)
		return () => {
			clearTimeout(timerRef.current)
			ws.close()
		}
	}, [token, scheduleReload])

	async function loadMore() {
		setLoadingMore(true)
		try {
			const page = await fetchConversations(token, {
				offset: countRef.current
			})
			countRef.current += page.length
			setConversations(prev => [...prev, ...page])
			setHasMore(page.length === CONVERSATIONS_PAGE_SIZE)
		} finally {
			setLoadingMore(false)
		}
	}

	return (
		<div
			style={{ width: 280, borderRight: '1px solid #eee', overflowY: 'auto' }}
		>
			{conversations.map(c => {
				const unread = c.id === selectedId ? 0 : c.unreadCount
				return (
					<div
						key={c.id}
						onClick={() => onSelect(c.id)}
						style={{
							padding: 12,
							cursor: 'pointer',
							background: c.id === selectedId ? '#f1f1f1' : 'transparent'
						}}
					>
						<div
							style={{
								display: 'flex',
								justifyContent: 'space-between',
								fontWeight: unread ? 600 : 400
							}}
						>
							<span>
								Беседа #{c.id}{' '}
								<span style={{ color: '#888', fontSize: 12, fontWeight: 400 }}>
									({c.status})
								</span>
							</span>
							{unread > 0 && (
								<span
									style={{
										background: '#e11d48',
										color: '#fff',
										borderRadius: 10,
										padding: '0 7px',
										fontSize: 12
									}}
								>
									{unread}
								</span>
							)}
						</div>
						{c.lastMessageText && (
							<div
								style={{
									color: '#888',
									fontSize: 12,
									marginTop: 4,
									whiteSpace: 'nowrap',
									overflow: 'hidden',
									textOverflow: 'ellipsis'
								}}
							>
								{c.lastMessageSender === 'admin' && 'Вы: '}
								{c.lastMessageText}
							</div>
						)}
					</div>
				)
			})}
			{hasMore && (
				<div style={{ textAlign: 'center', padding: 12 }}>
					<button onClick={loadMore} disabled={loadingMore}>
						{loadingMore ? 'Загрузка...' : 'Загрузить ещё'}
					</button>
				</div>
			)}
		</div>
	)
}
