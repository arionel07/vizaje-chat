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
	refreshKey,
	onLogout
}: {
	token: string
	onSelect: (id: number) => void
	selectedId: number | null
	refreshKey: number
	onLogout: () => void
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
		<div className="w-[280px] [border-right:1px_solid_#eee] overflow-y-auto">
			<div className="p-[12px] [border-bottom:1px_solid_#eee] flex justify-between">
				<span>Беседы</span>
				<button onClick={onLogout}>Выйти</button>
			</div>
			{conversations.map(c => {
				const unread = c.id === selectedId ? 0 : c.unreadCount
				return (
					<div
						key={c.id}
						onClick={() => onSelect(c.id)}
						className={`p-[12px] cursor-pointer ${
							c.id === selectedId ? 'bg-[#f1f1f1]' : 'bg-transparent'
						}`}
					>
						<div
							className={`flex justify-between ${
								unread ? 'font-semibold' : 'font-normal'
							}`}
						>
							<span>
								Беседа #{c.id}{' '}
								<span className="text-[#888] text-[12px] font-normal">
									({c.status})
								</span>
							</span>
							{unread > 0 && (
								<span className="bg-[#e11d48] text-[#fff] rounded-[10px] px-[7px] py-0 text-[12px]">
									{unread}
								</span>
							)}
						</div>
						{c.lastMessageText && (
							<div className="text-[#888] text-[12px] mt-[4px] whitespace-nowrap overflow-hidden text-ellipsis">
								{c.lastMessageSender === 'admin' && 'Вы: '}
								{c.lastMessageText}
							</div>
						)}
					</div>
				)
			})}
			{hasMore && (
				<div className="text-center p-[12px]">
					<button onClick={loadMore} disabled={loadingMore}>
						{loadingMore ? 'Загрузка...' : 'Загрузить ещё'}
					</button>
				</div>
			)}
		</div>
	)
}
