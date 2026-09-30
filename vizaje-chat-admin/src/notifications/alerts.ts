// Оповещения оператора о новых сообщениях: звук, бейдж на favicon, заголовок вкладки
// и системное уведомление браузера. Внешних файлов не используется — звук
// синтезируется Web Audio API, бейдж рисуется поверх favicon.svg на canvas.

const SOUND_MUTED_KEY = 'admin_notif_muted'
const FAVICON_HREF = '/favicon.svg'
const BASE_TITLE = document.title

// --- разрешение на уведомления ---------------------------------------------

// спрашиваем один раз: если пользователь уже разрешил или отказал,
// Notification.permission больше не 'default' — повторно не спрашиваем
export async function ensureNotificationPermission() {
	if (!('Notification' in window) || Notification.permission !== 'default') return
	try {
		await Notification.requestPermission()
	} catch {
		// браузер не поддерживает промис-форму (старый Safari) — не критично
	}
}

// уведомление показываем только при неактивной вкладке (вызывающий код это проверяет);
// клик — фокусирует вкладку и открывает беседу
export function showBrowserNotification(
	title: string,
	body: string,
	tag: string,
	onClick: () => void
) {
	if (!('Notification' in window) || Notification.permission !== 'granted') return
	try {
		// renotify: чтобы повторное сообщение в той же беседе снова привлекло внимание
		// (в типах DOM lib его может не быть в зависимости от версии TS)
		const n = new Notification(title, { body, tag, renotify: true } as NotificationOptions)
		n.onclick = () => {
			window.focus()
			onClick()
			n.close()
		}
	} catch {
		// в части браузеров (мобильный Chrome) конструктор Notification недоступен
	}
}

// --- звук --------------------------------------------------------------

let audioCtx: AudioContext | null = null

export function isSoundMuted() {
	try {
		return localStorage.getItem(SOUND_MUTED_KEY) === '1'
	} catch {
		return false
	}
}

export function setSoundMuted(muted: boolean) {
	try {
		localStorage.setItem(SOUND_MUTED_KEY, muted ? '1' : '0')
	} catch {}
}

// короткий двухтональный сигнал; звучит независимо от активности вкладки
export function playChime() {
	if (isSoundMuted()) return
	try {
		const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
		if (!Ctx) return
		audioCtx ??= new Ctx()
		if (audioCtx.state === 'suspended') audioCtx.resume()
		const ctx = audioCtx
		const now = ctx.currentTime
		;[880, 660].forEach((freq, i) => {
			const osc = ctx.createOscillator()
			const gain = ctx.createGain()
			osc.type = 'sine'
			osc.frequency.value = freq
			const start = now + i * 0.09
			gain.gain.setValueAtTime(0, start)
			gain.gain.linearRampToValueAtTime(0.2, start + 0.01)
			gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16)
			osc.connect(gain)
			gain.connect(ctx.destination)
			osc.start(start)
			osc.stop(start + 0.18)
		})
	} catch {
		// автовоспроизведение звука браузер может заблокировать до первого жеста — не критично
	}
}

// --- favicon-бейдж -------------------------------------------------------

let faviconBase: HTMLImageElement | null = null
let faviconLink: HTMLLinkElement | null = null
let lastBadgeCount = 0

function getFaviconLink(): HTMLLinkElement | null {
	if (faviconLink) return faviconLink
	faviconLink = document.querySelector('link[rel="icon"]')
	return faviconLink
}

export function updateFaviconBadge(count: number) {
	lastBadgeCount = count
	const link = getFaviconLink()
	if (!link) return
	if (!count) {
		link.href = FAVICON_HREF
		link.type = 'image/svg+xml'
		return
	}
	if (!faviconBase) {
		faviconBase = new Image()
		// рисуем бейдж заново, когда базовая иконка загрузится — count к тому моменту мог измениться
		faviconBase.onload = () => updateFaviconBadge(lastBadgeCount)
		faviconBase.src = FAVICON_HREF
		return
	}
	const size = 64
	const canvas = document.createElement('canvas')
	canvas.width = size
	canvas.height = size
	const ctx = canvas.getContext('2d')
	if (!ctx) return
	ctx.drawImage(faviconBase, 0, 0, size, size)
	const label = count > 99 ? '99+' : String(count)
	const r = label.length > 2 ? 20 : 16
	ctx.beginPath()
	ctx.arc(size - r, r, r, 0, Math.PI * 2)
	ctx.fillStyle = '#dc2626'
	ctx.fill()
	ctx.fillStyle = '#fff'
	ctx.font = `bold ${label.length > 2 ? 20 : 24}px sans-serif`
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText(label, size - r, r + 1)
	link.type = 'image/png'
	link.href = canvas.toDataURL('image/png')
}

// --- заголовок вкладки ----------------------------------------------------

export function updateTitle(count: number) {
	document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${BASE_TITLE}` : BASE_TITLE
}
