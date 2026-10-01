import { Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { isSoundMuted, setSoundMuted } from './alerts'

// Звук новых сообщений включён по умолчанию; кнопка — на случай, если сообщений
// приходит слишком много и звук начинает раздражать
export function SoundToggle({ className = '' }: { className?: string }) {
	const [muted, setMuted] = useState(isSoundMuted)

	function toggle() {
		setSoundMuted(!muted)
		setMuted(!muted)
	}

	return (
		<button
			type="button"
			onClick={toggle}
			aria-label={muted ? 'Включить звук уведомлений' : 'Выключить звук уведомлений'}
			title={muted ? 'Звук выключен' : 'Звук включён'}
			className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30 ${className}`}
		>
			{muted ? (
				<VolumeX aria-hidden="true" className="h-5 w-5" />
			) : (
				<Volume2 aria-hidden="true" className="h-5 w-5" />
			)}
		</button>
	)
}
