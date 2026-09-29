import { useEffect, useState } from 'react'
import { fetchConversations } from '../lib/api'

type Conversation = {
	id: number
	sessionId: string
	status: string
	createdAt: string
}

export function ConversationList({
	token,
	onSelect,
	selectedId
}: {
	token: string
	onSelect: (id: number) => void
	selectedId: number | null
}) {
	const [conversations, setConversations] = useState<Conversation[]>([])

	useEffect(() => {
		fetchConversations(token).then(setConversations)
	}, [token])

	return (
		<div
			style={{ width: 240, borderRight: '1px solid #eee', overflowY: 'auto' }}
		>
			{conversations.map(c => (
				<div
					key={c.id}
					onClick={() => onSelect(c.id)}
					style={{
						padding: 12,
						cursor: 'pointer',
						background: c.id === selectedId ? '#f1f1f1' : 'transparent'
					}}
				>
					Беседа #{c.id}{' '}
					<span style={{ color: '#888', fontSize: 12 }}>({c.status})</span>
				</div>
			))}
		</div>
	)
}
